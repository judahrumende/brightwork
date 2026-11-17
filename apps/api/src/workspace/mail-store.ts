import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import { artifacts, members, outboundEmails } from '../db/schema';
import { canLeadRun } from './run-store';
import { emailOutcome, mayAttemptEmail } from './mail-policy';
import type { EmailResult } from './mail-policy';
export type { EmailResult } from './mail-policy';

export type EmailAttempt = {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
  firstAttemptAt: Date;
};

export function mailStore(db: Database) {
  return {
    async queue(input: {
      businessId: string;
      artifactId: string;
      revision: number;
      actorId: string;
      sender: string;
      recipient: string;
    }) {
      return db.transaction(async (tx) => {
        const [draft] = await tx
          .select({ subject: artifacts.title, body: artifacts.body })
          .from(artifacts)
          .where(
            and(
              eq(artifacts.businessId, input.businessId),
              eq(artifacts.id, input.artifactId),
              eq(artifacts.kind, 'email'),
              eq(artifacts.state, 'approved'),
              eq(artifacts.revision, input.revision),
            ),
          )
          .for('no key update');
        if (!draft) return null;
        const [created] = await tx
          .insert(outboundEmails)
          .values({
            artifactId: input.artifactId,
            actorId: input.actorId,
            revision: input.revision,
            sender: input.sender,
            recipient: input.recipient,
            subject: draft.subject,
            body: draft.body,
          })
          .onConflictDoNothing()
          .returning({ id: outboundEmails.id, state: outboundEmails.state });
        if (created) return created;
        const [existing] = await tx
          .select({
            id: outboundEmails.id,
            state: outboundEmails.state,
          })
          .from(outboundEmails)
          .where(
            and(
              eq(outboundEmails.artifactId, input.artifactId),
              eq(outboundEmails.revision, input.revision),
              eq(outboundEmails.recipient, input.recipient),
            ),
          );
        return existing ?? null;
      });
    },

    async claim(now = new Date()): Promise<EmailAttempt | null> {
      return db.transaction(async (tx) => {
        const [record] = await tx
          .select({
            email: outboundEmails,
            company: artifacts.businessId,
            revision: artifacts.revision,
            draftState: artifacts.state,
          })
          .from(outboundEmails)
          .innerJoin(artifacts, eq(artifacts.id, outboundEmails.artifactId))
          .where(
            and(
              sql`${outboundEmails.state} in ('queued', 'sending')`,
              lte(outboundEmails.nextCheckAt, now),
            ),
          )
          .orderBy(asc(outboundEmails.nextCheckAt), asc(outboundEmails.id))
          .limit(1)
          .for('no key update', { of: outboundEmails, skipLocked: true });
        if (!record) return null;
        const { email } = record;
        const scope = eq(outboundEmails.id, email.id);
        const [actor] = email.actorId
          ? await tx
              .select({ role: members.role })
              .from(members)
              .where(
                and(
                  eq(members.accountId, email.actorId),
                  eq(members.businessId, record.company),
                ),
              )
              .for('share')
          : [];
        if (
          !actor ||
          !canLeadRun(actor.role) ||
          record.draftState !== 'approved' ||
          record.revision !== email.revision
        ) {
          await tx
            .update(outboundEmails)
            .set({
              state: email.attempts === 0 ? 'failed' : 'needs_review',
              note: 'Check the draft revision and the sender’s workspace permissions.',
            })
            .where(scope);
          return null;
        }
        if (!mayAttemptEmail(email.attempts, email.firstAttemptAt, now)) {
          await tx
            .update(outboundEmails)
            .set({
              state: 'needs_review',
              note: 'Verify this email in the provider dashboard.',
            })
            .where(scope);
          return null;
        }
        const firstAttemptAt = email.firstAttemptAt ?? now;
        const attempts = email.attempts + 1;
        await tx
          .update(outboundEmails)
          .set({
            state: 'sending',
            attempts,
            firstAttemptAt,
            nextCheckAt: new Date(now.getTime() + 120_000),
          })
          .where(scope);
        return {
          id: email.id,
          sender: email.sender,
          recipient: email.recipient,
          subject: email.subject,
          body: email.body,
          attempts,
          firstAttemptAt,
        };
      });
    },

    async record(attempt: EmailAttempt, result: EmailResult, now = new Date()) {
      await db
        .update(outboundEmails)
        .set(
          emailOutcome(result, attempt.attempts, attempt.firstAttemptAt, now),
        )
        .where(
          and(
            eq(outboundEmails.id, attempt.id),
            eq(outboundEmails.state, 'sending'),
            eq(outboundEmails.attempts, attempt.attempts),
          ),
        );
    },
  };
}
