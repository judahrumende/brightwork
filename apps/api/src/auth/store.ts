import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import {
  accounts,
  attempts,
  businesses,
  identities,
  members,
  sessions,
} from '../db/schema';
import {
  challengeAttempts,
  challengeLifetimeSeconds,
  digest,
  randomCode,
  randomToken,
  sameToken,
  sessionLifetimeSeconds,
} from './tokens';

export type SocialIdentity = {
  provider: string;
  subject: string;
  email: string;
  name: string | null;
};
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type Account = typeof accounts.$inferSelect;
export type ProfileUpdate = Partial<
  Pick<
    Account,
    | 'name'
    | 'language'
    | 'timezone'
    | 'appearance'
    | 'background'
    | 'reduceEffects'
    | 'showPredictions'
    | 'showNotificationBadges'
  >
>;

export function authStore(db: Database, secret: string) {
  async function issueSession(
    tx: Transaction,
    accountId: string,
    provider: string,
    subject: string,
  ) {
    const token = randomToken();
    await tx.insert(sessions).values({
      digest: digest(secret, 'session', token),
      accountId,
      provider,
      subject,
      expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000),
    });
    return token;
  }

  async function emailSession(tx: Transaction, email: string) {
    const [account] = await tx
      .insert(accounts)
      .values({ email })
      .onConflictDoUpdate({
        target: accounts.email,
        set: { email },
      })
      .returning({ id: accounts.id });
    if (!account) throw new Error('Could not create account');
    return issueSession(tx, account.id, 'email', account.id);
  }

  async function createSocialSession(request: SocialIdentity) {
    return db.transaction(async (tx) => {
      const key = and(
        eq(identities.provider, request.provider),
        eq(identities.subject, request.subject),
      );
      const [existing] = await tx
        .select({ id: identities.accountId })
        .from(identities)
        .where(key);
      if (existing)
        return issueSession(tx, existing.id, request.provider, request.subject);
      const [account] = await tx
        .insert(accounts)
        .values({ email: request.email, name: request.name })
        .onConflictDoNothing()
        .returning({ id: accounts.id });
      if (!account) {
        const [concurrent] = await tx
          .select({ id: identities.accountId })
          .from(identities)
          .where(key);
        return concurrent
          ? issueSession(tx, concurrent.id, request.provider, request.subject)
          : null;
      }
      await tx.insert(identities).values({
        provider: request.provider,
        subject: request.subject,
        accountId: account.id,
      });
      return issueSession(tx, account.id, request.provider, request.subject);
    });
  }

  return {
    async beginEmail(email: string) {
      const id = randomUUID();
      const code = randomCode();
      const link = randomToken();
      const [record] = await db
        .insert(attempts)
        .values({
          id,
          email,
          codeHash: digest(secret, 'code', email + ':' + id + ':' + code),
          linkHash: digest(secret, 'link', link),
          expiresAt: new Date(Date.now() + challengeLifetimeSeconds * 1000),
        })
        .returning({ id: attempts.id });
      if (!record) throw new Error('Could not create email challenge');
      return { id: record.id, code, link };
    },

    async cancelAttempt(id: string) {
      await db.delete(attempts).where(eq(attempts.id, id));
    },

    async verifyCode(id: string, email: string, code: string) {
      return db.transaction(async (tx) => {
        const [record] = await tx
          .select()
          .from(attempts)
          .where(
            and(
              eq(attempts.id, id),
              eq(attempts.email, email),
              gt(attempts.expiresAt, new Date()),
            ),
          )
          .for('update');
        if (!record || record.tries >= challengeAttempts) return null;
        if (
          !sameToken(
            record.codeHash,
            digest(secret, 'code', email + ':' + id + ':' + code),
          )
        ) {
          await tx
            .update(attempts)
            .set({ tries: sql`${attempts.tries} + 1` })
            .where(eq(attempts.id, id));
          return null;
        }
        await tx.delete(attempts).where(eq(attempts.id, id));
        return emailSession(tx, email);
      });
    },

    async verifyLink(token: string) {
      return db.transaction(async (tx) => {
        const [record] = await tx
          .delete(attempts)
          .where(
            and(
              eq(attempts.linkHash, digest(secret, 'link', token)),
              gt(attempts.expiresAt, new Date()),
            ),
          )
          .returning({ email: attempts.email });
        return record ? emailSession(tx, record.email) : null;
      });
    },

    fromSocial: createSocialSession,

    async readSession(token: string) {
      const [active] = await db
        .select({ session: sessions, account: accounts })
        .from(sessions)
        .innerJoin(accounts, eq(accounts.id, sessions.accountId))
        .where(
          and(
            eq(sessions.digest, digest(secret, 'session', token)),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      return active;
    },

    async revokeSession(token: string) {
      await db
        .delete(sessions)
        .where(eq(sessions.digest, digest(secret, 'session', token)));
    },

    async updateAccount(
      id: string,
      patch:
        ProfileUpdate | Pick<Account, 'browserLanguage' | 'browserTimezone'>,
    ) {
      const [account] = await db
        .update(accounts)
        .set(patch)
        .where(eq(accounts.id, id))
        .returning();
      if (!account) throw new Error('Account disappeared');
      return account;
    },

    async companyList(accountId: string) {
      const rows = await db
        .select({ business: businesses, role: members.role })
        .from(members)
        .innerJoin(businesses, eq(businesses.id, members.businessId))
        .where(eq(members.accountId, accountId))
        .orderBy(desc(members.openedAt));
      return {
        userId: accountId,
        companies: rows.map(({ business, role }) => ({
          id: business.id,
          name: business.name,
          role,
          onboardingCompletedAt: business.createdAt.toISOString(),
          planUpdatedAt: business.createdAt.toISOString(),
        })),
        owned: rows.filter(({ role }) => role === 'owner').length,
        lastOpened: rows[0]?.business.id ?? null,
      };
    },

    async createBusiness(accountId: string, name: string, idea: string) {
      return db.transaction(async (tx) => {
        const [business] = await tx
          .insert(businesses)
          .values({ name, idea })
          .returning();
        if (!business) throw new Error('Could not create business');
        await tx
          .insert(members)
          .values({ businessId: business.id, accountId, role: 'owner' });
        return business;
      });
    },

    async openBusiness(accountId: string, id: string) {
      const [business] = await db
        .select({
          name: businesses.name,
          id: businesses.id,
          role: members.role,
        })
        .from(members)
        .innerJoin(businesses, eq(businesses.id, members.businessId))
        .where(
          and(eq(members.businessId, id), eq(members.accountId, accountId)),
        );
      if (business)
        await db
          .update(members)
          .set({ openedAt: new Date() })
          .where(
            and(eq(members.businessId, id), eq(members.accountId, accountId)),
          );
      return business;
    },
  };
}
