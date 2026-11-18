import { and, count, eq, isNotNull } from 'drizzle-orm';
import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Database } from '../db/database';
import { accounts, creditEntries } from '../db/schema';
import { creditDecimal, creditUnits } from './credit-amount';

const codes = pgTable('referral_codes', {
  accountId: uuid('account_id').primaryKey(),
  code: uuid().defaultRandom().notNull(),
});
const referrals = pgTable('referrals', {
  referredId: uuid('referred_id').primaryKey(),
  referrerId: uuid('referrer_id').notNull(),
  invoiceId: text('invoice_id'),
  refunded: boolean().notNull().default(false),
});
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function attributeReferral(
  tx: Transaction,
  account: string,
  code?: string,
) {
  if (!code) return;
  const [referrer] = await tx
    .select({ id: codes.accountId })
    .from(codes)
    .where(eq(codes.code, code));
  if (!referrer || referrer.id === account) return;
  await tx
    .insert(referrals)
    .values({ referredId: account, referrerId: referrer.id })
    .onConflictDoNothing();
}

export function referralProgram(db: Database) {
  return {
    async valid(code: string) {
      const [record] = await db
        .select({ code: codes.code })
        .from(codes)
        .where(eq(codes.code, code));
      return Boolean(record);
    },
    async status(account: string) {
      await db
        .insert(codes)
        .values({ accountId: account })
        .onConflictDoNothing();
      const [[code], [total], [converted]] = await Promise.all([
        db
          .select({ code: codes.code })
          .from(codes)
          .where(eq(codes.accountId, account)),
        db
          .select({ count: count() })
          .from(referrals)
          .where(eq(referrals.referrerId, account)),
        db
          .select({ count: count() })
          .from(referrals)
          .where(
            and(
              eq(referrals.referrerId, account),
              isNotNull(referrals.invoiceId),
              eq(referrals.refunded, false),
            ),
          ),
      ]);
      if (!code || !total || !converted)
        throw new Error('Referral program is unavailable.');
      return {
        code: code.code,
        signups: total.count,
        conversions: converted.count,
      };
    },
  };
}

export async function referralInvoice(tx: Transaction, account: string) {
  const [record] = await tx
    .select({ invoiceId: referrals.invoiceId })
    .from(referrals)
    .where(eq(referrals.referredId, account));
  return record?.invoiceId ?? (record ? null : undefined);
}

export async function reconcileReferral(
  tx: Transaction,
  referredId: string,
  invoiceId: string,
  grant: bigint,
  fullyRefunded: boolean,
) {
  const [referral] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.referredId, referredId))
    .for('update');
  if (!referral || (referral.invoiceId && referral.invoiceId !== invoiceId))
    return;
  if (!fullyRefunded && (grant <= 0n || referral.refunded)) return;
  const operation = 'referral:' + invoiceId;
  const accountId = referral.referrerId;
  await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .for('no key update');
  if (!referral.invoiceId || fullyRefunded)
    await tx
      .update(referrals)
      .set({ invoiceId, refunded: fullyRefunded })
      .where(eq(referrals.referredId, referredId));
  if (fullyRefunded) {
    const [previous] = await tx
      .select({ amount: creditEntries.amount })
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.accountId, accountId),
          eq(creditEntries.operationKey, operation),
        ),
      );
    if (previous)
      await tx
        .insert(creditEntries)
        .values({
          accountId,
          kind: 'refund',
          operationKey: 'refund:' + operation,
          amount: creditDecimal(-creditUnits(previous.amount)),
        })
        .onConflictDoNothing();
  } else {
    await tx
      .insert(creditEntries)
      .values({
        accountId,
        kind: 'referral',
        operationKey: operation,
        amount: creditDecimal(grant),
      })
      .onConflictDoNothing();
  }
}
