import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database';
import { workspaceDomains } from '../db/schema';

export const domainName = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((text) => domainToASCII(text.toLowerCase().replace(/\.$/u, '')))
  .pipe(
    z
      .string()
      .max(230)
      .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u,
      ),
  );
const resolver = new Resolver({ timeout: 1500, tries: 2 });

export function domainStore(
  db: Database,
  readTXT = (record: string) => resolver.resolveTxt(record),
) {
  const records = workspaceDomains;
  const scope = (businessId: string, id: string) =>
    and(eq(records.businessId, businessId), eq(records.id, id));
  return {
    list: (businessId: string) =>
      db
        .select()
        .from(records)
        .where(eq(records.businessId, businessId))
        .orderBy(asc(records.hostname))
        .limit(50),
    async add(businessId: string, hostname: string) {
      await db
        .insert(records)
        .values({
          businessId,
          hostname,
          challenge: 'brightwork=' + randomBytes(24).toString('base64url'),
        })
        .onConflictDoNothing();
    },
    async verify(businessId: string, id: string) {
      const [record] = await db
        .select()
        .from(records)
        .where(scope(businessId, id));
      if (!record) return 'missing';
      const txt = await readTXT(
        '_brightwork-verification.' + record.hostname,
      ).catch(() => []);
      if (!txt.some((parts) => parts.join('') === record.challenge))
        return 'unverified';
      const [verified] = await db
        .update(records)
        .set({ verifiedAt: new Date() })
        .where(
          and(scope(businessId, id), eq(records.challenge, record.challenge)),
        )
        .returning({ id: records.id });
      return verified ? 'verified' : 'missing';
    },
    async remove(businessId: string, id: string) {
      const [record] = await db
        .delete(records)
        .where(scope(businessId, id))
        .returning({ id: records.id });
      return Boolean(record);
    },
  };
}
