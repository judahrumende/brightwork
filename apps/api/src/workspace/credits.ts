import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database';
import {
  accounts,
  agentTurns,
  businessRuns,
  creditEntries,
} from '../db/schema';
import { creditDecimal, creditUnits } from './credit-amount';

const rate = z.string().regex(/^\d{1,14}(?:\.\d{1,10})?$/u);
export const creditConfig = z.object({
  STARTER_CREDITS: rate.default('10.0000000000'),
  MODEL_CREDITS_PER_CALL: rate.default('0.1000000000'),
  TOOL_CREDITS_PER_CALL: rate.default('0.0100000000'),
  APP_STORAGE_CREDITS_PER_MIB: rate.default('0.0000000000'),
});

export function parseCreditConfig(env: NodeJS.ProcessEnv) {
  const config = creditConfig.parse(env);
  if (
    env.NODE_ENV === 'production' &&
    env.APP_STORAGE_CREDITS_PER_MIB === undefined
  ) {
    throw new Error(
      'APP_STORAGE_CREDITS_PER_MIB must be explicitly set in production (use 0 to disable storage charges).',
    );
  }
  return config;
}

type CreditConfig = z.infer<typeof creditConfig>;
type CreditReader = Pick<Database, 'select' | 'insert'>;

export function creditLedger(db: Database, config: CreditConfig) {
  async function grantStarter(tx: CreditReader, accountId: string) {
    await tx
      .insert(creditEntries)
      .values({
        accountId,
        kind: 'starter',
        operationKey: 'starter',
        amount: creditDecimal(creditUnits(config.STARTER_CREDITS)),
      })
      .onConflictDoNothing();
  }
  async function balance(tx: CreditReader, accountId: string) {
    const [row] = await tx
      .select({
        amount: sql<string>`coalesce(sum(${creditEntries.amount}), 0)::text`,
      })
      .from(creditEntries)
      .where(eq(creditEntries.accountId, accountId));
    return creditDecimal(creditUnits(row?.amount ?? '0'));
  }

  type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
  async function lockAccount(tx: Transaction, id: string) {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, id))
      .for('no key update');
    return Boolean(row);
  }
  return {
    async open(accountId: string) {
      await grantStarter(db, accountId);
      return { userId: accountId, available: await balance(db, accountId) };
    },
    async history(accountId: string) {
      const entries = await db
        .select({
          id: creditEntries.id,
          kind: creditEntries.kind,
          amount: creditEntries.amount,
          createdAt: creditEntries.createdAt,
        })
        .from(creditEntries)
        .where(eq(creditEntries.accountId, accountId))
        .orderBy(desc(creditEntries.createdAt))
        .limit(50);
      return { entries };
    },
    async reserveMedia(
      tx: Transaction,
      accountId: string,
      jobId: string,
      kind: 'image' | 'video' | 'voice',
      amount: string,
    ) {
      const reserved = creditUnits(amount);
      if (reserved < 0n || !(await lockAccount(tx, accountId))) return false;
      await grantStarter(tx, accountId);
      if (creditUnits(await balance(tx, accountId)) < reserved) return false;
      await tx.insert(creditEntries).values({
        accountId,
        kind,
        operationKey: 'media:' + jobId,
        amount: creditDecimal(-reserved),
      });
      return true;
    },
    async refundMedia(
      tx: Transaction,
      accountId: string,
      jobId: string,
      amount: string,
    ) {
      if (!(await lockAccount(tx, accountId))) return;
      await tx
        .insert(creditEntries)
        .values({
          accountId,
          kind: 'refund',
          operationKey: 'refund:media:' + jobId,
          amount: creditDecimal(creditUnits(amount)),
        })
        .onConflictDoNothing();
    },
    async debit(
      accountId: string,
      turnId: string,
      suffix: string,
      kind: 'model' | 'tool',
    ) {
      const charge = creditUnits(
        kind === 'model'
          ? config.MODEL_CREDITS_PER_CALL
          : config.TOOL_CREDITS_PER_CALL,
      );
      return db.transaction(async (tx) => {
        if (!(await lockAccount(tx, accountId))) return false;
        await grantStarter(tx, accountId);
        const operationKey = turnId + ':' + suffix;
        const [existing] = await tx
          .select({ id: creditEntries.id })
          .from(creditEntries)
          .where(
            and(
              eq(creditEntries.accountId, accountId),
              eq(creditEntries.operationKey, operationKey),
            ),
          );
        if (existing) return true;
        if (creditUnits(await balance(tx, accountId)) < charge) return false;
        const [turn] = await tx
          .select({
            runId: agentTurns.runId,
            businessId: agentTurns.businessId,
          })
          .from(agentTurns)
          .where(
            and(
              eq(agentTurns.id, turnId),
              eq(agentTurns.creatorId, accountId),
              eq(agentTurns.state, 'running'),
            ),
          );
        if (!turn) return false;
        if (turn.runId) {
          const amount = creditDecimal(charge);
          const spent = sql`${businessRuns.creditsUsed} + ${amount}::numeric`;
          const [budget] = await tx
            .update(businessRuns)
            .set({ creditsUsed: spent })
            .where(
              and(
                eq(businessRuns.id, turn.runId),
                eq(businessRuns.businessId, turn.businessId),
                eq(businessRuns.creatorId, accountId),
                sql`${businessRuns.state} in ('active', 'paused')`,
                sql`${spent} <= ${businessRuns.creditLimit}`,
              ),
            )
            .returning({ id: businessRuns.id });
          if (!budget) return false;
        }
        await tx.insert(creditEntries).values({
          accountId,
          turnId,
          operationKey,
          kind,
          amount: creditDecimal(-charge),
        });
        return true;
      });
    },
    async chargeStorage(
      tx: Transaction,
      accountId: string,
      fileId: string,
      amount: string,
    ) {
      const charge = creditUnits(amount);
      if (charge <= 0n) return true;
      if (!(await lockAccount(tx, accountId))) return false;
      await grantStarter(tx, accountId);
      const operationKey = 'storage:' + fileId;
      const [existing] = await tx
        .select({ id: creditEntries.id })
        .from(creditEntries)
        .where(
          and(
            eq(creditEntries.accountId, accountId),
            eq(creditEntries.operationKey, operationKey),
          ),
        );
      if (existing) return true;
      if (creditUnits(await balance(tx, accountId)) < charge) return false;
      await tx.insert(creditEntries).values({
        accountId,
        operationKey,
        kind: 'storage',
        amount: creditDecimal(-charge),
      });
      return true;
    },
    async refundStorage(tx: Transaction, fileId: string) {
      const operationKey = 'storage:' + fileId;
      const [charge] = await tx
        .select({
          accountId: creditEntries.accountId,
          amount: creditEntries.amount,
        })
        .from(creditEntries)
        .where(
          and(
            eq(creditEntries.operationKey, operationKey),
            eq(creditEntries.kind, 'storage'),
          ),
        );
      if (!charge || !(await lockAccount(tx, charge.accountId))) return;
      await tx
        .insert(creditEntries)
        .values({
          accountId: charge.accountId,
          operationKey: 'refund:' + operationKey,
          kind: 'refund',
          amount: creditDecimal(-creditUnits(charge.amount)),
        })
        .onConflictDoNothing();
    },
  };
}
