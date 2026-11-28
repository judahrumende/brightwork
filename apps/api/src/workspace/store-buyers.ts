import { storeOrderRows } from './store-order-rows';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database';
import {
  challengeAttempts,
  challengeLifetimeSeconds,
  digest,
  randomCode,
  randomToken,
  sameToken,
  sessionLifetimeSeconds,
} from '../auth/tokens';
import type { StoreOrder } from '@brightwork/shared';

const tokenInput = z.string().regex(/^[a-zA-Z0-9_-]{43}$/u);

export function storeBuyers(db: Database, secret: string) {
  const codeDigest = (siteId: string, challenge: string, code: string) =>
    digest(
      secret,
      'store-signin-code',
      siteId + '\0' + challenge + '\0' + code,
    );
  const sessionDigest = (siteId: string, token: string) =>
    digest(secret, 'store-buyer-session', siteId + '\0' + token);

  return {
    async challenge(siteId: string, email: string) {
      const id = randomUUID();
      const code = randomCode();
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`delete from generated_store_signins where site_id = ${siteId} and expires_at <= now()`,
        );
        await tx.execute(
          sql`delete from generated_store_buyer_sessions where site_id = ${siteId} and expires_at <= now()`,
        );
        await tx.execute(sql`
          insert into generated_store_signins(site_id, id, email, code_digest, expires_at)
          values (${siteId}, ${id}, ${email}, ${codeDigest(siteId, id, code)}, now() + ${challengeLifetimeSeconds} * interval '1 second')
        `);
      });
      return { id, code };
    },
    async discard(siteId: string, id: string) {
      await db.execute(
        sql`delete from generated_store_signins where site_id = ${siteId} and id = ${id}`,
      );
    },
    async verify(siteId: string, id: string, code: string, previous?: string) {
      return db.transaction(async (tx) => {
        const [challenge] = await tx.execute<{
          email: string;
          code_digest: string;
        }>(sql`
          select email, code_digest from generated_store_signins
          where site_id = ${siteId} and id = ${id} and expires_at > now() and attempts < ${challengeAttempts}
          for update
        `);
        if (!challenge) return null;
        if (!sameToken(challenge.code_digest, codeDigest(siteId, id, code))) {
          await tx.execute(
            sql`update generated_store_signins set attempts = attempts + 1 where site_id = ${siteId} and id = ${id}`,
          );
          return null;
        }
        await tx.execute(
          sql`delete from generated_store_signins where site_id = ${siteId} and id = ${id}`,
        );
        await tx.execute(
          sql`insert into generated_store_buyers(site_id, email) values (${siteId}, ${challenge.email}) on conflict do nothing`,
        );
        if (previous && tokenInput.safeParse(previous).success) {
          await tx.execute(
            sql`delete from generated_store_buyer_sessions where site_id = ${siteId} and token_digest = ${sessionDigest(siteId, previous)}`,
          );
        }
        const token = randomToken();
        await tx.execute(sql`
          insert into generated_store_buyer_sessions(site_id, email, token_digest, expires_at)
          values (${siteId}, ${challenge.email}, ${sessionDigest(siteId, token)}, now() + ${sessionLifetimeSeconds} * interval '1 second')
        `);
        return token;
      });
    },
    async buyer(siteId: string, token: string | undefined) {
      if (!tokenInput.safeParse(token).success || !token) return null;
      const [session] = await db.execute<{ email: string }>(sql`
        select email from generated_store_buyer_sessions
        where site_id = ${siteId} and token_digest = ${sessionDigest(siteId, token)} and expires_at > now()
      `);
      return session?.email ?? null;
    },
    async signOut(siteId: string, token: string | undefined) {
      if (token && tokenInput.safeParse(token).success)
        await db.execute(
          sql`delete from generated_store_buyer_sessions where site_id = ${siteId} and token_digest = ${sessionDigest(siteId, token)}`,
        );
    },
    async orders(
      siteId: string,
      email: string,
      before?: { id: string; createdAt: string },
    ) {
      return db.execute<StoreOrder>(
        storeOrderRows(
          sql`
        orders.site_id = ${siteId} and orders.email = ${email}
        ${before ? sql`and (orders.created_at, orders.id) < (${before.createdAt}::timestamptz, ${before.id}::uuid)` : sql.empty()}
      `,
          21,
        ),
      );
    },
  };
}
