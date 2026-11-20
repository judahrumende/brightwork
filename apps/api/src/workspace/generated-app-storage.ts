import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database';
import { generatedAppFiles as files } from '../db/schema';
import type { AppUser } from './generated-app-records';
import type { creditLedger } from './credits';
import { creditDecimal, creditUnits } from './credit-amount';

const fileInput = z.strictObject({
  name: z.string().trim().min(1).max(180),
  mime: z
    .string()
    .regex(
      /^(?:image\/(?:png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf|text\/plain)$/iu,
    ),
  data: z
    .string()
    .min(4)
    .max(1_398_104)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
});
const maxBytes = 1_048_576;
const mib = 1_048_576n;
export class AppStorageCreditsRequired extends Error {
  constructor() {
    super(
      'The workspace owner needs more Foundable credits for this app upload.',
    );
  }
}
export class AppStorageBillingUnavailable extends Error {
  constructor() {
    super('App storage billing is unavailable for this workspace.');
  }
}
function storageCharge(rate: string, bytes: number) {
  const perMib = creditUnits(rate);
  if (perMib <= 0n) return creditDecimal(0n);
  return creditDecimal((perMib * BigInt(bytes) + mib - 1n) / mib);
}
const metadata = (row: typeof files.$inferSelect) => ({
  id: row.id,
  name: row.name,
  mime: row.mime,
  size: row.bytes.byteLength,
  createdAt: row.createdAt,
});

export function generatedAppStorage(
  db: Database,
  credits?: ReturnType<typeof creditLedger>,
  creditsPerMib = '0.0000000000',
) {
  const authorized = (row: { ownerEmail: string }, user: AppUser) =>
    user.role === 'admin' || row.ownerEmail === user.email;
  return {
    async listForWorkspace(
      businessId: string,
      siteId: string,
      cursor?: { createdAt: string; id: string },
      limit = 100,
      includeCursor = false,
    ) {
      return db.execute(sql`
        select file.id, file.name, file.mime, octet_length(file.bytes)::int as size,
          file.owner_email as "ownerEmail", file.created_at as "createdAt"
          ${includeCursor ? sql`, to_char(file.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt"` : sql.empty()}
        from generated_app_files file
        join workspace_artifacts site on site.id = file.site_id
        where site.business_id = ${businessId}::uuid and site.id = ${siteId}::uuid
          and site.kind = 'website' and file.environment = 'live' and file.data_revision = 0
          and (${cursor?.createdAt ?? null}::timestamptz is null or
            (file.created_at, file.id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by file.created_at desc, file.id desc limit ${Math.min(Math.max(limit, 1), 101)}`);
    },
    async removeForWorkspace(businessId: string, siteId: string, id: string) {
      return db.transaction(async (tx) => {
        const rows = await tx.execute(sql`
        delete from generated_app_files file using workspace_artifacts site
        where file.site_id = ${siteId}::uuid and file.id = ${id}::uuid
          and file.environment = 'live' and file.data_revision = 0
          and site.id = file.site_id and site.business_id = ${businessId}::uuid
          and site.kind = 'website'
        returning file.id`);
        if (rows[0]) await credits?.refundStorage(tx, String(rows[0].id));
        return rows.length > 0;
      });
    },
    async readForWorkspace(businessId: string, siteId: string, id: string) {
      const [row] = await db.execute(sql`
        select file.name, file.mime, encode(file.bytes, 'base64') as data
        from generated_app_files file
        join workspace_artifacts site on site.id = file.site_id
        where site.business_id = ${businessId}::uuid and site.id = ${siteId}::uuid
          and site.kind = 'website' and file.environment = 'live'
          and file.data_revision = 0 and file.id = ${id}::uuid`);
      return row ?? null;
    },
    async list(
      siteId: string,
      user: AppUser,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      const rows = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.siteId, siteId),
            eq(files.environment, environment),
            eq(files.dataRevision, dataRevision),
            user.role === 'admin'
              ? undefined
              : eq(files.ownerEmail, user.email),
          ),
        )
        .orderBy(desc(files.createdAt))
        .limit(100);
      return rows.map(metadata);
    },
    async put(
      siteId: string,
      user: AppUser,
      input: unknown,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      const parsed = fileInput.parse(input);
      const bytes = Buffer.from(parsed.data, 'base64');
      if (
        !bytes.length ||
        bytes.length > maxBytes ||
        bytes.toString('base64') !== parsed.data
      )
        throw new Error('File data must be valid base64 of at most 1 MiB.');
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from workspace_artifacts where id = ${siteId}::uuid for update`,
        );
        const [quota] = await tx.execute<{ count: number; bytes: number }>(sql`
          select count(*)::int as count, coalesce(sum(octet_length(bytes)), 0)::int as bytes
          from generated_app_files where site_id = ${siteId}::uuid
            and environment = ${environment} and data_revision = ${dataRevision}
            and owner_email = ${user.email}`);
        if (
          !quota ||
          quota.count >= 100 ||
          quota.bytes + bytes.length > 10 * maxBytes
        )
          return null;
        const id = randomUUID();
        const charge =
          environment === 'live'
            ? storageCharge(creditsPerMib, bytes.length)
            : creditDecimal(0n);
        if (creditUnits(charge) > 0n) {
          if (!credits) throw new AppStorageBillingUnavailable();
          const [owner] = await tx.execute<{ accountId: string }>(sql`
            select member.account_id as "accountId"
            from workspace_artifacts site
            join business_members member on member.business_id = site.business_id
            where site.id = ${siteId}::uuid and site.kind = 'website'
              and member.role = 'owner'
            limit 1`);
          if (!owner) throw new AppStorageBillingUnavailable();
          if (!(await credits.chargeStorage(tx, owner.accountId, id, charge)))
            throw new AppStorageCreditsRequired();
        }
        const [row] = await tx
          .insert(files)
          .values({
            id,
            siteId,
            environment,
            dataRevision,
            ownerEmail: user.email,
            name: parsed.name,
            mime: parsed.mime,
            bytes,
          })
          .returning();
        return row ? metadata(row) : null;
      });
    },
    async read(
      siteId: string,
      id: string,
      user: AppUser,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      const [row] = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.siteId, siteId),
            eq(files.environment, environment),
            eq(files.dataRevision, dataRevision),
            eq(files.id, id),
          ),
        );
      return row && authorized(row, user)
        ? { ...metadata(row), data: row.bytes.toString('base64') }
        : null;
    },
    async remove(
      siteId: string,
      id: string,
      user: AppUser,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ ownerEmail: files.ownerEmail })
          .from(files)
          .where(
            and(
              eq(files.siteId, siteId),
              eq(files.environment, environment),
              eq(files.dataRevision, dataRevision),
              eq(files.id, id),
            ),
          )
          .for('update');
        if (!row || !authorized(row, user)) return false;
        const deleted = await tx
          .delete(files)
          .where(
            and(
              eq(files.siteId, siteId),
              eq(files.environment, environment),
              eq(files.dataRevision, dataRevision),
              eq(files.id, id),
            ),
          )
          .returning({ id: files.id });
        if (deleted[0]) await credits?.refundStorage(tx, deleted[0].id);
        return deleted.length > 0;
      });
    },
  };
}
