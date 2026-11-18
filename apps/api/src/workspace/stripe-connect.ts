import { createHmac } from 'node:crypto';
import { and, desc, eq, or, isNull, sql } from 'drizzle-orm';
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

  return {
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
        .where(eq(sales.id, id));
      return result ?? null;
    },
    async checkout(id: string) {
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
        const session = await stripe.createCheckout({
          orderId: order.id,
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
                const email = session.customer_details?.email
                  ?.trim()
                  .toLowerCase();
                const customerKey = email
                  ? createHmac('sha256', options.identityKey ?? options.secret)
                      .update(
                        'stripe-customer\0' +
                          seller.businessId +
                          '\0' +
                          event.account +
                          '\0' +
                          email,
                      )
                      .digest('hex')
                  : null;
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
