import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import {
  customType,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../db/database';
import { members } from '../db/schema';
import { creditDecimal, creditUnits } from './credit-amount';
import type { creditLedger } from './credits';

const kinds = ['image', 'video', 'voice'] as const;
export const mediaKind = z.enum(kinds);
export type MediaKind = z.infer<typeof mediaKind>;
const mediaState = [
  'queued',
  'submitting',
  'processing',
  'completed',
  'failed',
  'needs_review',
] as const;
export const mediaInput = z.strictObject({
  id: z.uuid(),
  kind: mediaKind,
  prompt: z.string().trim().min(1).max(4000),
  quotedCredits: z.string().regex(/^\d{1,14}(?:\.\d{1,10})?$/u),
});
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const jobs = pgTable('media_jobs', {
  id: uuid().primaryKey(),
  businessId: uuid('business_id').notNull(),
  accountId: uuid('account_id').notNull(),
  kind: text({ enum: kinds }).notNull(),
  prompt: text().notNull(),
  credits: numeric({ precision: 24, scale: 10 }).notNull(),
  state: text({ enum: mediaState }).notNull().default('queued'),
  remoteId: text('remote_id'),
  lease: uuid(),
  claimAt: timestamp('claim_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  asset: bytea(),
  mime: text(),
});
export const mediaMime: Record<MediaKind, string> = {
  image: 'image/png',
  video: 'video/mp4',
  voice: 'audio/mpeg',
};
export const maxMediaBytes = 25_000_000;
export type MediaResult =
  | { state: 'completed'; bytes: Buffer }
  | { state: 'processing'; remoteId: string }
  | { state: 'failed' }
  | { state: 'needs_review'; remoteId?: string };

type Job = typeof jobs.$inferSelect;

export function mediaStore(
  db: Database,
  credits: ReturnType<typeof creditLedger>,
) {
  const scope = (businessId: string, id: string) =>
    and(eq(jobs.businessId, businessId), eq(jobs.id, id));
  return {
    async enqueue(
      businessId: string,
      accountId: string,
      input: z.infer<typeof mediaInput>,
      configuredRate: string,
    ) {
      const rate = creditDecimal(creditUnits(configuredRate));
      return db.transaction(async (tx) => {
        const find = () =>
          tx
            .select({
              account: jobs.accountId,
              kind: jobs.kind,
              prompt: jobs.prompt,
              rate: jobs.credits,
            })
            .from(jobs)
            .where(scope(businessId, input.id));
        const matches = (
          row: Awaited<ReturnType<typeof find>>[number] | undefined,
        ) =>
          row?.account === accountId &&
          row.kind === input.kind &&
          row.prompt === input.prompt &&
          row.rate === creditDecimal(creditUnits(input.quotedCredits));
        const [existing] = await find();
        if (existing) return matches(existing) ? 'accepted' : 'conflict';
        if (creditUnits(input.quotedCredits) !== creditUnits(rate))
          return 'price_changed';
        const [created] = await tx
          .insert(jobs)
          .values({
            id: input.id,
            businessId,
            accountId,
            kind: input.kind,
            prompt: input.prompt,
            credits: rate,
          })
          .onConflictDoNothing()
          .returning({ id: jobs.id });
        if (!created)
          return matches((await find())[0]) ? 'accepted' : 'conflict';
        if (
          !(await credits.reserveMedia(
            tx,
            accountId,
            input.id,
            input.kind,
            rate,
          ))
        ) {
          await tx.delete(jobs).where(eq(jobs.id, input.id));
          return 'insufficient_credits';
        }
        return 'accepted';
      });
    },
    async list(businessId: string) {
      return db
        .select({
          id: jobs.id,
          kind: jobs.kind,
          state: jobs.state,
          prompt: jobs.prompt,
          credits: jobs.credits,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(eq(jobs.businessId, businessId))
        .orderBy(desc(jobs.createdAt))
        .limit(50);
    },
    async asset(businessId: string, id: string) {
      const [record] = await db
        .select({ bytes: jobs.asset, mime: jobs.mime, kind: jobs.kind })
        .from(jobs)
        .where(and(scope(businessId, id), eq(jobs.state, 'completed')));
      return record ?? null;
    },
    async claim(kinds: MediaKind[], now = new Date()) {
      if (!kinds.length) return null;
      return db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            businessId: jobs.businessId,
            accountId: jobs.accountId,
            kind: jobs.kind,
            prompt: jobs.prompt,
            credits: jobs.credits,
            state: jobs.state,
            remoteId: jobs.remoteId,
          })
          .from(jobs)
          .where(
            and(
              inArray(jobs.kind, kinds),
              inArray(jobs.state, ['queued', 'submitting', 'processing']),
              lte(jobs.claimAt, now),
            ),
          )
          .orderBy(asc(jobs.claimAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!job) return null;
        if (job.state === 'submitting') {
          await tx
            .update(jobs)
            .set({ state: 'needs_review' })
            .where(eq(jobs.id, job.id));
          return null;
        }
        if (job.state === 'queued') {
          const [member] = await tx
            .select({ role: members.role })
            .from(members)
            .where(
              and(
                eq(members.businessId, job.businessId),
                eq(members.accountId, job.accountId),
              ),
            );
          if (!member || member.role === 'viewer') {
            await tx
              .update(jobs)
              .set({ state: 'failed' })
              .where(eq(jobs.id, job.id));
            await credits.refundMedia(tx, job.accountId, job.id, job.credits);
            return null;
          }
        }
        const lease = randomUUID();
        await tx
          .update(jobs)
          .set({
            state: job.state === 'queued' ? 'submitting' : 'processing',
            lease,
            claimAt: new Date(now.getTime() + 5 * 60_000),
          })
          .where(eq(jobs.id, job.id));
        return { ...job, lease };
      });
    },
    async record(
      claim: Pick<Job, 'id' | 'lease'>,
      outcome: MediaResult,
      now = new Date(),
    ) {
      if (!claim.lease) return false;
      return db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            accountId: jobs.accountId,
            kind: jobs.kind,
            credits: jobs.credits,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.id, claim.id),
              eq(jobs.lease, claim.lease!),
              inArray(jobs.state, ['submitting', 'processing', 'needs_review']),
            ),
          )
          .for('update');
        if (!job) return false;
        const result =
          outcome.state === 'completed' &&
          (outcome.bytes.length === 0 || outcome.bytes.length > maxMediaBytes)
            ? { state: 'needs_review' as const }
            : outcome;
        await tx
          .update(jobs)
          .set({
            state: result.state,
            lease: null,
            claimAt: new Date(now.getTime() + 10_000),
            ...('remoteId' in result && result.remoteId
              ? { remoteId: result.remoteId }
              : {}),
            ...(result.state === 'completed'
              ? { asset: result.bytes, mime: mediaMime[job.kind] }
              : {}),
          })
          .where(eq(jobs.id, job.id));
        if (result.state === 'failed')
          await credits.refundMedia(tx, job.accountId, job.id, job.credits);
        return true;
      });
    },
  };
}
