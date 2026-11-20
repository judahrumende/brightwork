import { createHmac } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  or,
  isNull,
  isNotNull,
  sql,
} from 'drizzle-orm';
import {
  boolean,
  integer,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { verifyStripeSignature } from './stripe-client';
import type { StripeMode } from './stripe-client';
import {
  accountId,
  currency,
  sessionId,
  stripeConnectProvider,
} from './stripe-connect-provider';

const sellers = pgTable(
  'stripe_sellers',
  {
    businessId: uuid('business_id').notNull(),
    mode: text({ enum: ['test', 'live'] })
      .notNull()
      .default('test'),
    accountId: text('account_id').notNull(),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.mode] })],
);
const sales = pgTable('stripe_sales', {
  id: uuid().primaryKey(),
  businessId: uuid('business_id').notNull(),
  mode: text({ enum: ['test', 'live'] })
    .notNull()
    .default('test'),
  accountId: text('account_id').notNull(),
  title: text().notNull(),
  currency: text().notNull(),
  amount: integer().notNull(),
  amountRefunded: integer('amount_refunded').notNull().default(0),
  checkoutId: text('checkout_id'),
  directCheckout: boolean('direct_checkout').notNull().default(false),
  checkoutHoldUntil: timestamp('checkout_hold_until', {
    withTimezone: true,
    mode: 'date',
  }),
  checkoutAttemptedAt: timestamp('checkout_attempted_at', {
    withTimezone: true,
    mode: 'date',
  }),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
  paymentId: text('payment_id'),
  customerKey: text('customer_key'),
  paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
});
const refundRequests = pgTable('stripe_store_refund_requests', {
  id: uuid().primaryKey(),
  saleId: uuid('sale_id').notNull(),
  amount: integer().notNull(),
  status: text({ enum: ['pending', 'succeeded', 'failed'] })
    .notNull()
    .default('pending'),
});
const events = pgTable(
  'stripe_connect_events',
  {
    id: text().notNull(),
    mode: text({ enum: ['test', 'live'] })
      .notNull()
      .default('test'),
  },
  (t) => [primaryKey({ columns: [t.mode, t.id] })],
);
export const saleInput = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  currency,
  amount: z.int().min(1).max(99_999_999),
});
const eventInput = z.object({
  id: z.string().regex(/^evt_[a-z0-9]+$/iu),
  type: z.string(),
  account: accountId.optional(),
  livemode: z.boolean(),
  created: z.int().nonnegative().max(4_102_444_800),
  data: z.object({ object: z.object({ id: z.string().max(200) }) }),
});
const ready = (seller: typeof sellers.$inferSelect) =>
  seller.detailsSubmitted && seller.chargesEnabled && seller.payoutsEnabled;

export function stripeConnect(
  db: Database,
  options: {
    key: string;
    secret: string;
    mode?: StripeMode;
    origin: string;
    identityKey?: string;
  },
  transport?: typeof fetch,
) {
  const mode = options.mode ?? 'test';
  const stripe = stripeConnectProvider(
    options.key,
    options.origin,
    transport,
    mode,
  );
  const sellerScope = (id: string) =>
    and(eq(sellers.businessId, id), eq(sellers.mode, mode));
  const accountFields = (
    account: Awaited<ReturnType<typeof stripe.account>>,
  ) => ({
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  });
  const scopedOrder = (id: string, account: string) =>
    and(eq(sales.id, id), eq(sales.accountId, account), eq(sales.mode, mode));

  function buyerKey(
    businessId: string,
    account: string,
    email?: string | null,
  ) {
    const normalized = email?.trim().toLowerCase();
    return normalized
      ? createHmac('sha256', options.identityKey ?? options.secret)
          .update(
            'stripe-customer\0' +
              mode +
              '\0' +
              businessId +
              '\0' +
              account +
              '\0' +
              normalized,
          )
          .digest('hex')
      : null;
  }

  type StripeSession = Awaited<ReturnType<typeof stripe.checkout>>;
  async function releaseDirectCheckout(
    tx: Pick<Database, 'execute' | 'update'>,
    saleId: string,
    account: string,
    expiredSession?: StripeSession,
  ) {
    const {
      amount_total: amount,
      currency,
      id: checkoutId,
    } = expiredSession ?? {};
    if (expiredSession && (!amount || !currency || !checkoutId)) return false;
    // Inventory edits and merchant cancellations take the store lock before the sale.
    const [order] = await tx.execute<{ site_id: string; id: string }>(sql`
      select orders.site_id, orders.id from generated_store_orders orders
      join generated_stores store on store.site_id = orders.site_id
      join stripe_sales sale on sale.id = orders.sale_id
      where sale.id = ${saleId} and sale.account_id = ${account}
        and sale.mode = ${mode}
        and sale.direct_checkout and orders.status = 'confirmed'
      for update of store
    `);
    if (!order) return false;
    const [closed] = await tx
      .update(sales)
      .set({ closedAt: new Date(), ...(checkoutId ? { checkoutId } : {}) })
      .where(
        and(
          scopedOrder(saleId, account),
          isNull(sales.paidAt),
          isNull(sales.paymentId),
          eq(sales.amountRefunded, 0),
          ...(amount && currency && checkoutId
            ? [
                eq(sales.amount, amount),
                eq(sales.currency, currency),
                or(isNull(sales.checkoutId), eq(sales.checkoutId, checkoutId)),
              ]
            : [
                isNull(sales.checkoutId),
                sql`coalesce(${sales.checkoutHoldUntil}, ${sales.createdAt} + interval '45 minutes') <= now()`,
              ]),
        ),
      )
      .returning({ id: sales.id });
    if (!closed) return false;
    await tx.execute(sql`
      with cancelled as (
        update generated_store_orders set status = 'cancelled'
        where site_id = ${order.site_id} and id = ${order.id} and status = 'confirmed'
        returning site_id, id, email
      ), restored as (
        update generated_store_products products
      set stock = products.stock + lines.quantity, revision = products.revision + 1
      from generated_store_order_lines lines
      join cancelled on cancelled.site_id = lines.site_id and cancelled.id = lines.order_id
      where products.site_id = lines.site_id and products.id = lines.product_id
        returning products.id
      )
      insert into generated_store_email_outbox(site_id, order_id, event_key, recipient, subject, body)
      select site_id, id, 'cancelled', email, 'Order cancelled · ' || left(id::text, 8),
        'Your order ' || id::text || ' could not be confirmed and has been cancelled. Any held stock has been released.'
      from cancelled on conflict (site_id, order_id, event_key) do nothing
    `);
    return true;
  }

  async function recoverSale(id: string) {
    const [sale] = await db
      .select()
      .from(sales)
      .where(and(eq(sales.id, id), eq(sales.mode, mode)));
    if (!sale || sale.paidAt || sale.closedAt) return false;
    if (!sale.checkoutAttemptedAt)
      return db.transaction((tx) =>
        releaseDirectCheckout(tx, sale.id, sale.accountId),
      );

    let session: StripeSession;
    if (sale.checkoutId) {
      session = await stripe.checkout(sale.accountId, sale.checkoutId);
    } else {
      const listed = await stripe.checkoutCandidates(
        sale.accountId,
        Math.floor(sale.checkoutAttemptedAt.getTime() / 1000) - 5,
        Math.floor(sale.checkoutAttemptedAt.getTime() / 1000) + 300,
      );
      if (!listed.complete) return false;
      const matches = listed.sessions.filter(
        (candidate) =>
          candidate.client_reference_id === sale.id &&
          candidate.metadata.brightwork_sale === sale.id,
      );
      if (!matches.length)
        return db.transaction((tx) =>
          releaseDirectCheckout(tx, sale.id, sale.accountId),
        );
      if (matches.length !== 1)
        throw new Error(
          'More than one Stripe checkout matches this store order.',
        );
      session = matches[0]!;
    }
    if (
      session.client_reference_id !== sale.id ||
      session.metadata.brightwork_sale !== sale.id ||
      session.amount_total !== sale.amount ||
      session.currency !== sale.currency
    )
      throw new Error('Store checkout details do not match Stripe.');

    if (session.status === 'open') {
      session = await stripe.expireCheckout(sale.accountId, session.id);
    }
    if (session.status === 'expired' && session.payment_status === 'unpaid')
      return db.transaction((tx) =>
        releaseDirectCheckout(tx, sale.id, sale.accountId, session),
      );
    if (
      session.status !== 'complete' ||
      session.payment_status !== 'paid' ||
      !session.payment_intent
    )
      return false;
    const intent = await stripe.capturedPayment(
      sale.accountId,
      session.payment_intent,
    );
    const charge = intent.latest_charge;
    if (
      intent.metadata.brightwork_order !== sale.id ||
      intent.amount_received !== sale.amount ||
      intent.currency !== sale.currency ||
      charge.currency !== sale.currency ||
      charge.amount_captured !== sale.amount ||
      charge.amount_refunded > sale.amount
    )
      throw new Error('Store payment details do not match Stripe.');
    const [paid] = await db
      .update(sales)
      .set({
        checkoutId: session.id,
        paidAt: new Date(charge.created * 1000),
        paymentId: intent.id,
        customerKey: sql`coalesce(${sales.customerKey}, ${buyerKey(sale.businessId, sale.accountId, session.customer_details?.email)})`,
        amountRefunded: sql`greatest(${sales.amountRefunded}, ${charge.amount_refunded})`,
      })
      .where(
        and(
          scopedOrder(sale.id, sale.accountId),
          isNull(sales.paidAt),
          isNull(sales.closedAt),
          or(isNull(sales.checkoutId), eq(sales.checkoutId, session.id)),
          or(isNull(sales.paymentId), eq(sales.paymentId, intent.id)),
        ),
      )
      .returning();
    return Boolean(paid);
  }

  async function recoverStoreCheckouts() {
    // Advance the next check before network I/O so replicas claim different sales.
    const batch = await db.execute<{ id: string }>(sql`
      with due as (
        select id from stripe_sales
        where mode = ${mode} and direct_checkout and closed_at is null and paid_at is null
          and checkout_recover_at <= now()
        order by checkout_recover_at, id limit 8 for update skip locked
      )
      update stripe_sales sales set checkout_recover_at = now() + interval '5 minutes'
      from due where sales.id = due.id returning sales.id
    `);
    const results = await Promise.allSettled(
      batch.map(({ id }) => recoverSale(id)),
    );
    return {
      checked: results.length,
      resolved: results.filter(
        (item) => item.status === 'fulfilled' && item.value,
      ).length,
      failed: results.filter((item) => item.status === 'rejected').length,
      errors: results.flatMap((item) =>
        item.status === 'rejected'
          ? [
              item.reason instanceof Error
                ? item.reason.message
                : 'Unknown checkout error',
            ]
          : [],
      ),
    };
  }

  return {
    recoverStoreCheckouts,
    async overview(id: string) {
      const [[seller], orders] = await Promise.all([
        db.select().from(sellers).where(sellerScope(id)),
        db
          .select({
            id: sales.id,
            title: sales.title,
            currency: sales.currency,
            amount: sales.amount,
            amountRefunded: sales.amountRefunded,
            paidAt: sales.paidAt,
          })
          .from(sales)
          .where(and(eq(sales.businessId, id), eq(sales.mode, mode)))
          .orderBy(desc(sales.createdAt))
          .limit(100),
      ]);
      return {
        seller: seller ? { ...seller, ready: ready(seller) } : null,
        orders,
      };
    },
    async repairHistory(businessId: string, after?: string) {
      const [seller] = await db
        .select()
        .from(sellers)
        .where(sellerScope(businessId));
      if (!seller) return null;
      const size = 4;
      const candidates = await db
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.businessId, businessId),
            eq(sales.mode, mode),
            eq(sales.accountId, seller.accountId),
            isNotNull(sales.paidAt),
            isNotNull(sales.checkoutId),
            isNull(sales.customerKey),
            after ? gt(sales.id, after) : undefined,
          ),
        )
        .orderBy(asc(sales.id))
        .limit(size + 1);
      const results = await Promise.allSettled(
        candidates.slice(0, size).map(async (sale) => {
          if (!sale.checkoutId) return false;
          const session = await stripe.checkout(
            seller.accountId,
            sale.checkoutId,
          );
          if (
            session.id !== sale.checkoutId ||
            session.status !== 'complete' ||
            session.payment_status !== 'paid' ||
            session.client_reference_id !== sale.id ||
            session.currency !== sale.currency ||
            session.amount_total !== sale.amount ||
            !session.payment_intent ||
            session.payment_intent !== sale.paymentId
          )
            return false;
          const key = buyerKey(
            businessId,
            seller.accountId,
            session.customer_details?.email,
          );
          if (!key) return false;
          const rows = await db
            .update(sales)
            .set({ customerKey: key })
            .where(
              and(
                scopedOrder(sale.id, seller.accountId),
                eq(sales.businessId, businessId),
                eq(sales.checkoutId, sale.checkoutId),
                isNull(sales.customerKey),
                sql`exists (select 1 from ${sellers} where ${sellers.businessId} = ${businessId} and ${sellers.mode} = ${mode} and ${sellers.accountId} = ${seller.accountId})`,
              ),
            )
            .returning({ id: sales.id });
          return rows.length > 0;
        }),
      );
      return {
        checked: results.length,
        refreshed: results.filter(
          (result) => result.status === 'fulfilled' && result.value,
        ).length,
        failed: results.filter((result) => result.status === 'rejected').length,
        next:
          candidates.length > size ? (candidates[size - 1]?.id ?? null) : null,
      };
    },
    async onboarding(id: string) {
      let [existing] = await db.select().from(sellers).where(sellerScope(id));
      if (!existing) {
        const account = await stripe.createAccount(id);
        await db
          .insert(sellers)
          .values({
            businessId: id,
            mode,
            accountId: account.id,
            ...accountFields(account),
          })
          .onConflictDoNothing();
        [existing] = await db.select().from(sellers).where(sellerScope(id));
      }
      if (!existing) throw new Error('Could not reserve a seller account.');
      return stripe.onboarding(id, existing.accountId);
    },
    async create(id: string, input: z.infer<typeof saleInput>) {
      const [seller] = await db.select().from(sellers).where(sellerScope(id));
      if (!seller || !ready(seller)) return false;
      await db
        .insert(sales)
        .values({ ...input, businessId: id, mode, accountId: seller.accountId })
        .onConflictDoNothing();
      const [sale] = await db
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.id, input.id),
            eq(sales.businessId, id),
            eq(sales.mode, mode),
          ),
        );
      return Boolean(
        sale &&
        sale.title === input.title &&
        sale.amount === input.amount &&
        sale.currency === input.currency,
      );
    },
    async readyForCheckout(businessId: string) {
      const [seller] = await db
        .select()
        .from(sellers)
        .where(sellerScope(businessId));
      return Boolean(seller && ready(seller));
    },
    async refundSale(
      businessId: string,
      saleId: string,
      amount: number,
      requestId: string,
      actorId?: string,
    ) {
      return db.transaction(async (tx) => {
        const [sale] = await tx
          .select()
          .from(sales)
          .where(
            and(
              eq(sales.id, saleId),
              eq(sales.businessId, businessId),
              eq(sales.mode, mode),
              sql`exists (select 1 from ${sellers} where ${sellers.businessId} = ${businessId}::uuid
                and ${sellers.mode} = ${mode} and ${sellers.accountId} = ${sales.accountId})`,
            ),
          )
          .for('update');
        if (!sale || !sale.paidAt || !sale.paymentId || sale.closedAt)
          return false;
        const [priorRequest] = await tx
          .select()
          .from(refundRequests)
          .where(eq(refundRequests.id, requestId));
        if (priorRequest)
          return (
            priorRequest.saleId === sale.id &&
            priorRequest.amount === amount &&
            priorRequest.status === 'succeeded'
          );
        if (
          !Number.isSafeInteger(amount) ||
          amount < 1 ||
          amount > sale.amount - sale.amountRefunded
        )
          return false;
        await tx.insert(refundRequests).values({
          id: requestId,
          saleId: sale.id,
          amount,
        });
        const payment = await stripe.capturedPayment(
          sale.accountId,
          sale.paymentId,
        );
        if (
          payment.id !== sale.paymentId ||
          payment.metadata.brightwork_order !== sale.id ||
          payment.amount_received !== sale.amount ||
          payment.currency !== sale.currency ||
          payment.latest_charge.payment_intent !== sale.paymentId ||
          payment.latest_charge.amount_captured !== sale.amount ||
          payment.latest_charge.currency !== sale.currency ||
          payment.latest_charge.amount_refunded > sale.amount
        )
          throw new Error('Store payment details do not match Stripe.');
        if (payment.latest_charge.amount_refunded !== sale.amountRefunded) {
          const matchingRefund =
            payment.latest_charge.amount_refunded > sale.amountRefunded
              ? await stripe.findRefundRequest(
                  sale.accountId,
                  sale.paymentId,
                  requestId,
                )
              : undefined;
          if (
            matchingRefund?.status === 'succeeded' &&
            matchingRefund.amount === amount &&
            matchingRefund.currency === sale.currency &&
            payment.latest_charge.amount_refunded ===
              sale.amountRefunded + amount
          ) {
            await tx
              .update(sales)
              .set({ amountRefunded: payment.latest_charge.amount_refunded })
              .where(eq(sales.id, sale.id));
            await tx
              .update(refundRequests)
              .set({ status: 'succeeded' })
              .where(eq(refundRequests.id, requestId));
            await tx.execute(sql`
              insert into generated_store_activity(site_id, actor_id, kind, summary, source_key)
              select orders.site_id, ${actorId ?? null}::uuid, 'payment.refund',
                'Refund recorded for order ' || left(orders.id::text, 8),
                ${`store-refund:${sale.id}:${payment.latest_charge.amount_refunded}`}
              from generated_store_orders orders where orders.sale_id = ${sale.id}
              on conflict do nothing
            `);
            return true;
          }
          if (payment.latest_charge.amount_refunded > sale.amountRefunded)
            await tx
              .update(sales)
              .set({ amountRefunded: payment.latest_charge.amount_refunded })
              .where(eq(sales.id, sale.id));
          await tx
            .update(refundRequests)
            .set({ status: 'failed' })
            .where(eq(refundRequests.id, requestId));
          return false;
        }
        const refund = await stripe.refundPayment(
          sale.accountId,
          sale.paymentId,
          amount,
          requestId,
        );
        if (
          refund.status !== 'succeeded' ||
          refund.amount !== amount ||
          refund.currency !== sale.currency
        ) {
          await tx
            .update(refundRequests)
            .set({ status: 'failed' })
            .where(eq(refundRequests.id, requestId));
          return false;
        }
        await tx
          .update(sales)
          .set({ amountRefunded: sale.amountRefunded + amount })
          .where(eq(sales.id, sale.id));
        await tx
          .update(refundRequests)
          .set({ status: 'succeeded' })
          .where(eq(refundRequests.id, requestId));
        await tx.execute(sql`
          insert into generated_store_activity(site_id, actor_id, kind, summary, source_key)
          select orders.site_id, ${actorId ?? null}::uuid, 'payment.refund',
            'Refund recorded for order ' || left(orders.id::text, 8),
            ${`store-refund:${sale.id}:${sale.amountRefunded + amount}`}
          from generated_store_orders orders where orders.sale_id = ${sale.id}
          on conflict do nothing
        `);
        return true;
      });
    },
    async closeStoreCheckout(
      businessId: string,
      siteId: string,
      orderId: string,
    ) {
      return db.transaction(async (tx) => {
        const [sale] = await tx
          .select()
          .from(sales)
          .where(
            and(
              eq(sales.businessId, businessId),
              eq(sales.mode, mode),
              sql`exists (
            select 1 from generated_store_orders where site_id = ${siteId}
              and id = ${orderId} and sale_id = ${sales.id} and status = 'confirmed'
          )`,
            ),
          )
          .for('update');
        if (!sale) return false;
        if (sale.closedAt) return true;
        if (sale.paidAt || sale.paymentId || sale.amountRefunded) return false;
        if (sale.checkoutId) {
          let session = await stripe.checkout(sale.accountId, sale.checkoutId);
          const matches = () =>
            session.id === sale.checkoutId &&
            session.client_reference_id === sale.id &&
            session.amount_total === sale.amount &&
            session.currency === sale.currency &&
            session.payment_status === 'unpaid';
          if (!matches() || session.status === 'complete') return false;
          if (session.status === 'open')
            session = await stripe.expireCheckout(
              sale.accountId,
              sale.checkoutId,
            );
          if (!matches() || session.status !== 'expired') return false;
        } else if (sale.checkoutAttemptedAt) {
          // A provider timeout can leave a session whose ID hasn't been recorded.
          return false;
        }
        await tx
          .update(sales)
          .set({ closedAt: new Date() })
          .where(and(eq(sales.id, sale.id), eq(sales.mode, mode)));
        return true;
      });
    },
    async publicOrder(id: string) {
      const [result] = await db
        .select({
          id: sales.id,
          mode: sales.mode,
          title: sales.title,
          currency: sales.currency,
          amount: sales.amount,
          paidAt: sales.paidAt,
          amountRefunded: sales.amountRefunded,
        })
        .from(sales)
        .where(
          and(eq(sales.id, id), eq(sales.mode, mode), isNull(sales.closedAt)),
        );
      return result ?? null;
    },
    async checkout(id: string) {
      // Record the attempt before the provider call so a lost response can't make
      // an order appear safe to cancel while a checkout might still be open.
      const [attempt] = await db
        .update(sales)
        .set({
          checkoutAttemptedAt: sql`coalesce(${sales.checkoutAttemptedAt}, now())`,
        })
        .where(
          and(
            eq(sales.id, id),
            eq(sales.mode, mode),
            isNull(sales.closedAt),
            isNull(sales.paidAt),
            eq(sales.amountRefunded, 0),
            sql`exists (select 1 from stripe_sellers as seller
            where seller.business_id = ${sales.businessId} and seller.account_id = ${sales.accountId}
            and seller.mode = ${mode}
            and seller.details_submitted and seller.charges_enabled and seller.payouts_enabled)`,
          ),
        )
        .returning({ id: sales.id });
      if (!attempt) return null;
      return db.transaction(async (tx) => {
        const [record] = await tx
          .select({ order: sales, seller: sellers })
          .from(sales)
          .innerJoin(
            sellers,
            and(
              eq(sales.businessId, sellers.businessId),
              eq(sales.mode, sellers.mode),
            ),
          )
          .where(and(eq(sales.id, id), eq(sales.mode, mode)))
          .for('update', { of: sales });
        if (
          !record ||
          record.order.paidAt ||
          record.order.closedAt ||
          record.order.amountRefunded > 0 ||
          record.seller.accountId !== record.order.accountId ||
          record.seller.mode !== mode ||
          !ready(record.seller)
        )
          return null;
        const { order } = record;
        if (order.checkoutId) {
          const current = await stripe.checkout(
            order.accountId,
            order.checkoutId,
          );
          if (
            current.id !== order.checkoutId ||
            current.client_reference_id !== id ||
            current.currency !== order.currency ||
            current.amount_total !== order.amount
          )
            return null;
          if (current.status !== 'expired')
            return current.status === 'open' &&
              current.payment_status === 'unpaid'
              ? (current.url ?? null)
              : null;
        }
        if (
          order.directCheckout &&
          (order.checkoutId ||
            (order.checkoutAttemptedAt &&
              Date.now() - order.checkoutAttemptedAt.getTime() >=
                23 * 60 * 60 * 1000))
        )
          return null;
        const expiresAt = order.checkoutHoldUntil?.getTime();
        if (expiresAt && expiresAt - Date.now() < 31 * 60 * 1000) return null;
        const session = await stripe.createCheckout({
          orderId: order.id,
          ...(expiresAt ? { expiresAt: expiresAt / 1000 } : {}),
          ...(order.checkoutId ? { expiredSession: order.checkoutId } : {}),
          accountId: order.accountId,
          title: order.title,
          amount: order.amount,
          currency: order.currency,
        });
        if (
          session.client_reference_id !== id ||
          session.currency !== order.currency ||
          session.amount_total !== order.amount ||
          order.checkoutId === session.id ||
          session.status !== 'open'
        )
          return null;
        await tx
          .update(sales)
          .set({ checkoutId: session.id })
          .where(and(eq(sales.id, id), eq(sales.mode, mode)));
        return session.url;
      });
    },
    register(app: FastifyInstance) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pending: Promise<void> | undefined;
      let closing = false;
      function schedule() {
        if (closing) return;
        timer = setTimeout(() => {
          pending = recoverStoreCheckouts()
            .then(({ failed, errors }) => {
              if (failed)
                app.log.warn(
                  { failed, errors },
                  'Some store checkouts could not be reconciled',
                );
            })
            .catch((error: unknown) => {
              app.log.warn(
                { error },
                'Store checkout reconciliation could not run',
              );
            })
            .finally(schedule);
        }, 30_000);
        timer.unref();
      }
      app.addHook('onReady', async () => {
        schedule();
      });
      app.addHook('preClose', async () => {
        closing = true;
        clearTimeout(timer);
        await pending;
      });
      app.register(async (hooks) => {
        hooks.removeContentTypeParser('application/json');
        hooks.addContentTypeParser(
          'application/json',
          { parseAs: 'buffer' },
          (_req, body, done) => done(null, body),
        );
        hooks.post(
          mode === 'test'
            ? '/api/webhooks/stripe-connect'
            : '/api/webhooks/stripe-connect/live',
          { bodyLimit: 256_000 },
          async (req, res) => {
            if (
              !Buffer.isBuffer(req.body) ||
              !verifyStripeSignature(
                options.secret,
                req.body,
                req.headers['stripe-signature'],
              )
            )
              return res.code(403).send();
            let raw: unknown;
            try {
              raw = JSON.parse(req.body.toString('utf8'));
            } catch {
              return res.code(400).send();
            }
            const parsed = eventInput.safeParse(raw);
            if (!parsed.success) return res.code(400).send();
            const event = parsed.data;
            if (event.livemode !== (mode === 'live'))
              return res.code(400).send();
            const objectId = event.data.object.id;
            await db.transaction(async (tx) => {
              const [claimed] = await tx
                .insert(events)
                .values({ id: event.id, mode })
                .onConflictDoNothing()
                .returning();
              if (!claimed || !event.account) return;
              const [seller] = await tx
                .select()
                .from(sellers)
                .where(
                  and(
                    eq(sellers.accountId, event.account),
                    eq(sellers.mode, mode),
                  ),
                )
                .for('update');
              if (!seller) return;
              if (
                event.type === 'account.updated' &&
                objectId === event.account
              ) {
                const canonical = await stripe.account(event.account);
                if (canonical.id === event.account)
                  await tx
                    .update(sellers)
                    .set(accountFields(canonical))
                    .where(sellerScope(seller.businessId));
              }
              if (
                event.type === 'checkout.session.completed' &&
                sessionId.safeParse(objectId).success
              ) {
                const session = await stripe.checkout(event.account, objectId);
                if (
                  session.id !== objectId ||
                  session.status !== 'complete' ||
                  session.payment_status !== 'paid' ||
                  !session.client_reference_id ||
                  !z.uuid().safeParse(session.client_reference_id).success ||
                  !session.payment_intent ||
                  !session.currency ||
                  !session.amount_total
                )
                  return;
                const customerKey = buyerKey(
                  seller.businessId,
                  event.account,
                  session.customer_details?.email,
                );
                const payment = await tx
                  .update(sales)
                  .set({
                    checkoutId: session.id,
                    customerKey: sql`coalesce(${sales.customerKey}, ${customerKey})`,
                    paymentId: session.payment_intent,
                    paidAt: sql`coalesce(${sales.paidAt}, ${new Date(event.created * 1000).toISOString()}::timestamptz)`,
                  })
                  .where(
                    and(
                      scopedOrder(session.client_reference_id, event.account),
                      isNull(sales.closedAt),
                      eq(sales.amount, session.amount_total),
                      eq(sales.currency, session.currency),
                      or(
                        isNull(sales.checkoutId),
                        eq(sales.checkoutId, session.id),
                      ),
                      or(
                        isNull(sales.paymentId),
                        eq(sales.paymentId, session.payment_intent),
                      ),
                    ),
                  )
                  .returning({ id: sales.id });
                for (const { id } of payment)
                  await tx.execute(sql`
                    insert into generated_store_activity(site_id, kind, summary, source_key)
                    select orders.site_id, 'payment.received',
                      'Payment received for order ' || left(orders.id::text, 8),
                      ${'store-payment:' + id}
                    from generated_store_orders orders where orders.sale_id = ${id}
                    on conflict do nothing
                  `);
              }
              if (
                event.type === 'checkout.session.expired' &&
                sessionId.safeParse(objectId).success
              ) {
                const session = await stripe.checkout(event.account, objectId);
                const reference = z
                  .uuid()
                  .safeParse(session.client_reference_id);
                if (
                  !reference.success ||
                  session.id !== objectId ||
                  session.status !== 'expired' ||
                  session.payment_status !== 'unpaid' ||
                  !session.amount_total ||
                  !session.currency
                )
                  return;
                await releaseDirectCheckout(
                  tx,
                  reference.data,
                  event.account,
                  session,
                );
              }
              if (
                event.type === 'charge.refunded' &&
                /^ch_[a-z0-9]+$/iu.test(objectId)
              ) {
                const charge = await stripe.charge(event.account, objectId);
                const orderId = charge.metadata.brightwork_order;
                if (
                  !orderId ||
                  !charge.payment_intent ||
                  !charge.paid ||
                  charge.amount_refunded > charge.amount
                )
                  return;
                const refunds = await tx
                  .update(sales)
                  .set({
                    paymentId: charge.payment_intent,
                    amountRefunded: sql`greatest(${sales.amountRefunded}, ${charge.amount_refunded})`,
                  })
                  .where(
                    and(
                      scopedOrder(orderId, event.account),
                      isNull(sales.closedAt),
                      eq(sales.amount, charge.amount),
                      eq(sales.currency, charge.currency),
                      or(
                        isNull(sales.paymentId),
                        eq(sales.paymentId, charge.payment_intent),
                      ),
                    ),
                  )
                  .returning({
                    id: sales.id,
                    amountRefunded: sales.amountRefunded,
                  });
                for (const sale of refunds)
                  await tx.execute(sql`
                    insert into generated_store_activity(site_id, kind, summary, source_key)
                    select orders.site_id, 'payment.refund',
                      'Refund recorded for order ' || left(orders.id::text, 8),
                      ${`store-refund:${sale.id}:${sale.amountRefunded}`}
                    from generated_store_orders orders where orders.sale_id = ${sale.id}
                    on conflict do nothing
                  `);
              }
            });
            return res.code(204).send();
          },
        );
      });
    },
  };
}

type StripeCredentials = { key: string; secret: string };

export function stripeConnectModes(
  db: Database,
  credentials: Partial<Record<StripeMode, StripeCredentials>>,
  options: { origin: string; identityKey?: string },
  transport?: typeof fetch,
) {
  const modes = {
    test: credentials.test
      ? stripeConnect(
          db,
          { ...credentials.test, ...options, mode: 'test' },
          transport,
        )
      : undefined,
    live: credentials.live
      ? stripeConnect(
          db,
          { ...credentials.live, ...options, mode: 'live' },
          transport,
        )
      : undefined,
  };
  async function saleMode(id: string) {
    const [sale] = await db.execute<{ mode: StripeMode }>(sql`
      select mode from stripe_sales where id = ${id}::uuid
    `);
    return sale?.mode;
  }
  return {
    forMode(mode: StripeMode) {
      return modes[mode];
    },
    availableModes() {
      return (Object.keys(modes) as StripeMode[]).filter((mode) =>
        Boolean(modes[mode]),
      );
    },
    register(app: FastifyInstance) {
      modes.test?.register(app);
      modes.live?.register(app);
    },
    async readyForCheckout(businessId: string, mode: StripeMode = 'test') {
      return (await modes[mode]?.readyForCheckout(businessId)) ?? false;
    },
    async checkout(id: string) {
      const mode = await saleMode(id);
      return mode ? (modes[mode]?.checkout(id) ?? null) : null;
    },
    async publicOrder(id: string) {
      const mode = await saleMode(id);
      return mode ? (modes[mode]?.publicOrder(id) ?? null) : null;
    },
    async closeStoreCheckout(
      businessId: string,
      siteId: string,
      orderId: string,
    ) {
      const [order] = await db.execute<{ mode: StripeMode }>(sql`
        select sale.mode from generated_store_orders orders
        join stripe_sales sale on sale.id = orders.sale_id
        where orders.site_id = ${siteId}::uuid and orders.id = ${orderId}::uuid
          and orders.status in ('confirmed', 'fulfilled')
          and sale.business_id = ${businessId}::uuid
      `);
      return order
        ? (modes[order.mode]?.closeStoreCheckout(businessId, siteId, orderId) ??
            false)
        : false;
    },
    async refundStoreOrder(
      businessId: string,
      siteId: string,
      orderId: string,
      amount: number,
      requestId: string,
      actorId?: string,
    ) {
      const [order] = await db.execute<{ id: string; mode: StripeMode }>(sql`
        select sale.id, sale.mode from generated_store_orders orders
        join stripe_sales sale on sale.id = orders.sale_id
        where orders.site_id = ${siteId}::uuid and orders.id = ${orderId}::uuid
          and sale.business_id = ${businessId}::uuid
      `);
      return order
        ? (modes[order.mode]?.refundSale(
            businessId,
            order.id,
            amount,
            requestId,
            actorId,
          ) ?? false)
        : false;
    },
  };
}

export type StripeConnectModes = ReturnType<typeof stripeConnectModes>;
