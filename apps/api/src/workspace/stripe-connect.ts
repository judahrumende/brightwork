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
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { verifyStripeSignature } from './stripe-client';
import {
  accountId,
  currency,
  sessionId,
  stripeConnectProvider,
} from './stripe-connect-provider';

const sellers = pgTable('stripe_sellers', {
  businessId: uuid('business_id').primaryKey(),
  accountId: text('account_id').notNull(),
  chargesEnabled: boolean('charges_enabled').notNull().default(false),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  detailsSubmitted: boolean('details_submitted').notNull().default(false),
});
const sales = pgTable('stripe_sales', {
  id: uuid().primaryKey(),
  businessId: uuid('business_id').notNull(),
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
const events = pgTable('stripe_connect_events', {
  id: text().primaryKey(),
});
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
  livemode: z.literal(false),
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
    origin: string;
    identityKey?: string;
  },
  transport?: typeof fetch,
) {
  const stripe = stripeConnectProvider(options.key, options.origin, transport);
  const sellerScope = (id: string) => eq(sellers.businessId, id);
  const accountFields = (
    account: Awaited<ReturnType<typeof stripe.account>>,
  ) => ({
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  });
  const scopedOrder = (id: string, account: string) =>
    and(eq(sales.id, id), eq(sales.accountId, account));

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
        returning site_id, id
      )
      update generated_store_products products
      set stock = products.stock + lines.quantity, revision = products.revision + 1
      from generated_store_order_lines lines
      join cancelled on cancelled.site_id = lines.site_id and cancelled.id = lines.order_id
      where products.site_id = lines.site_id and products.id = lines.product_id
    `);
    return true;
  }

  async function recoverSale(id: string) {
    const [sale] = await db.select().from(sales).where(eq(sales.id, id));
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
        where direct_checkout and closed_at is null and paid_at is null
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
          .where(eq(sales.businessId, id))
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
                sql`exists (select 1 from ${sellers} where ${sellers.businessId} = ${businessId} and ${sellers.accountId} = ${seller.accountId})`,
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
        .values({ ...input, businessId: id, accountId: seller.accountId })
        .onConflictDoNothing();
      const [sale] = await db
        .select()
        .from(sales)
        .where(and(eq(sales.id, input.id), eq(sales.businessId, id)));
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
          .where(eq(sales.id, sale.id));
        return true;
      });
    },
    async publicOrder(id: string) {
      const [result] = await db
        .select({
          id: sales.id,
          title: sales.title,
          currency: sales.currency,
          amount: sales.amount,
          paidAt: sales.paidAt,
          amountRefunded: sales.amountRefunded,
        })
        .from(sales)
        .where(and(eq(sales.id, id), isNull(sales.closedAt)));
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
            isNull(sales.closedAt),
            isNull(sales.paidAt),
            eq(sales.amountRefunded, 0),
            sql`exists (select 1 from stripe_sellers as seller
            where seller.business_id = ${sales.businessId} and seller.account_id = ${sales.accountId}
            and seller.details_submitted and seller.charges_enabled and seller.payouts_enabled)`,
          ),
        )
        .returning({ id: sales.id });
      if (!attempt) return null;
      return db.transaction(async (tx) => {
        const [record] = await tx
          .select({ order: sales, seller: sellers })
          .from(sales)
          .innerJoin(sellers, eq(sales.businessId, sellers.businessId))
          .where(eq(sales.id, id))
          .for('update', { of: sales });
        if (
          !record ||
          record.order.paidAt ||
          record.order.closedAt ||
          record.order.amountRefunded > 0 ||
          record.seller.accountId !== record.order.accountId ||
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
          .where(eq(sales.id, id));
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
          '/api/webhooks/stripe-connect',
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
            const objectId = event.data.object.id;
            await db.transaction(async (tx) => {
              const [claimed] = await tx
                .insert(events)
                .values({ id: event.id })
                .onConflictDoNothing()
                .returning();
              if (!claimed || !event.account) return;
              const [seller] = await tx
                .select()
                .from(sellers)
                .where(eq(sellers.accountId, event.account))
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
                await tx
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
                  );
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
                await tx
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
                  );
              }
            });
            return res.code(204).send();
          },
        );
      });
    },
  };
}
