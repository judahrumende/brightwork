import { stripeClient, verifyStripeSignature } from './stripe-client';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import {
  accounts,
  billingCustomers,
  billingEvents,
  creditEntries,
} from '../db/schema';
import { creditDecimal, creditUnits } from './credit-amount';
import { reconcileReferral, referralInvoice } from './referrals';

const subscriptionSchema = z.object({
  id: z.string().startsWith('sub_'),
  created: z.number(),
  status: z.string(),
  current_period_end: z.number().int().positive(),
  cancel_at_period_end: z.boolean(),
  items: z.object({
    data: z.array(z.object({ price: z.object({ id: z.string() }) })),
  }),
  latest_invoice: z
    .object({
      id: z.string().startsWith('in_'),
      status: z.string().nullable(),
      amount_paid: z.number().int().nonnegative(),
      charge: z.object({ refunded: z.boolean() }).nullish(),
    })
    .nullable(),
});
const paidStatus = (state: string) =>
  state === 'active' || state === 'trialing';
const subscribedEvents = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
]);

const invoiceId = z.string().regex(/^in_[a-z0-9_]+$/iu);
const invoiceLines = z.object({
  has_more: z.boolean(),
  data: z.array(
    z.object({ id: z.string(), price: z.object({ id: z.string() }).nullish() }),
  ),
});
const referralPayment = z.object({
  id: invoiceId,
  livemode: z.literal(false),
  customer: z.string(),
  status: z.string().nullable(),
  subscription: z.string().startsWith('sub_').nullish(),
  amount_paid: z.int().nonnegative(),
  status_transitions: z.object({ paid_at: z.int().nullable() }),
  charge: z.object({ paid: z.boolean(), refunded: z.boolean() }).nullish(),
  lines: invoiceLines,
});

export function stripeBilling(
  db: Database,
  config: {
    key: string;
    webhook: string;
    price: string;
    origin: string;
    renewalCredits: string;
    referralCredits?: string;
  },
  transport: typeof fetch = fetch,
) {
  if (!config.key.startsWith('sk_test_') && !config.key.startsWith('rk_test_'))
    throw new Error('Stripe billing requires a test-mode key');
  const planCredits = creditUnits(config.renewalCredits);
  const referralCredits = creditUnits(config.referralCredits ?? '0');
  const stripe = stripeClient(config.key, transport);
  async function firstReferralPayment(customerId: string) {
    let first: z.infer<typeof referralPayment> | undefined;
    let cursor: string | undefined;
    for (;;) {
      const query = new URLSearchParams({
        customer: customerId,
        status: 'paid',
        limit: '100',
        'expand[]': 'data.charge',
      });
      if (cursor) query.set('starting_after', cursor);
      const page = z
        .object({ data: z.array(referralPayment), has_more: z.boolean() })
        .parse(await stripe('invoices?' + query));
      for (const invoice of page.data) {
        if (
          invoice.customer !== customerId ||
          invoice.status !== 'paid' ||
          !invoice.charge?.paid ||
          !invoice.subscription ||
          !invoice.amount_paid ||
          invoice.status_transitions.paid_at === null
        )
          continue;
        let lines = invoice.lines;
        while (
          !lines.data.some((line) => line.price?.id === config.price) &&
          lines.has_more
        ) {
          const last = lines.data.at(-1);
          if (!last) throw new Error('Stripe invoice lines are incomplete.');
          const lineQuery = new URLSearchParams({
            limit: '100',
            starting_after: last.id,
          });
          lines = invoiceLines.parse(
            await stripe('invoices/' + invoice.id + '/lines?' + lineQuery),
          );
          if (lines.data.at(-1)?.id === last.id)
            throw new Error('Stripe repeated an invoice line page.');
        }
        if (!lines.data.some((line) => line.price?.id === config.price))
          continue;
        const firstTime = first?.status_transitions.paid_at;
        if (
          firstTime == null ||
          invoice.status_transitions.paid_at < firstTime ||
          (invoice.status_transitions.paid_at === firstTime &&
            first &&
            invoice.id < first.id)
        )
          first = invoice;
      }
      if (!page.has_more) return first;
      const next = page.data.at(-1)?.id;
      if (!next || next === cursor)
        throw new Error('Stripe invoice history is incomplete.');
      cursor = next;
    }
  }
  const customerFor = async (accountId: string) => {
    const [row] = await db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.accountId, accountId));
    return row;
  };
  async function customer(accountId: string, email: string) {
    const existing = await customerFor(accountId);
    if (existing) return existing;
    const created = z
      .object({
        id: z.string().regex(/^cus_[a-z0-9_]+$/iu),
        livemode: z.literal(false),
      })
      .parse(
        await stripe(
          'customers',
          { email, 'metadata[brightwork_account_id]': accountId },
          'brightwork-customer-' + accountId,
        ),
      );
    await db
      .insert(billingCustomers)
      .values({ accountId, customerId: created.id })
      .onConflictDoNothing();
    const stored = await customerFor(accountId);
    if (!stored) throw new Error('Could not store the Stripe customer');
    return stored;
  }
  function redirectFrom(response: unknown, host: string) {
    const { url } = z
      .object({
        url: z.url({
          protocol: /^https$/u,
          hostname: new RegExp('^' + host.replaceAll('.', '\\.') + '$', 'u'),
        }),
      })
      .parse(response);
    return { url };
  }
  return {
    async read(accountId: string) {
      const row = await customerFor(accountId);
      const paid = Boolean(
        row &&
        paidStatus(row.state) &&
        row.periodEnd &&
        row.periodEnd.getTime() > Date.now(),
      );
      return {
        enabled: true,
        testMode: true,
        state: row?.state ?? 'free',
        paid,
        periodEnd: row?.periodEnd ?? null,
        canOpenPortal: Boolean(row),
        canCheckout:
          !row?.subscriptionId ||
          row.state === 'canceled' ||
          row.state === 'incomplete_expired',
        cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
      };
    },
    async checkout(accountId: string, email: string) {
      const row = await customer(accountId, email);
      if (
        row.subscriptionId &&
        row.state !== 'canceled' &&
        row.state !== 'incomplete_expired'
      )
        return null;
      const response = await stripe(
        'checkout/sessions',
        {
          mode: 'subscription',
          customer: row.customerId,
          'line_items[0][price]': config.price,
          'line_items[0][quantity]': '1',
          success_url: new URL('/home', config.origin).href,
          cancel_url: new URL('/home', config.origin).href,
        },
        'brightwork-checkout-' +
          accountId +
          '-' +
          Math.floor(Date.now() / 3_600_000),
      );
      return redirectFrom(response, 'checkout.stripe.com');
    },
    async portal(accountId: string) {
      const row = await customerFor(accountId);
      if (!row) return null;
      return redirectFrom(
        await stripe('billing_portal/sessions', {
          customer: row.customerId,
          return_url: new URL('/home', config.origin).href,
        }),
        'billing.stripe.com',
      );
    },
    register(app: FastifyInstance) {
      app.register(async (hook) => {
        hook.removeContentTypeParser('application/json');
        hook.addContentTypeParser(
          'application/json',
          { parseAs: 'buffer', bodyLimit: 256_000 },
          (_request, raw, done) => done(null, raw),
        );
        hook.post('/api/webhooks/stripe', async (request, reply) => {
          if (
            !Buffer.isBuffer(request.body) ||
            !verifyStripeSignature(
              config.webhook,
              request.body,
              request.headers['stripe-signature'],
            )
          )
            return reply
              .code(401)
              .send({ message: 'Invalid Stripe signature.' });
          let payload: unknown;
          try {
            payload = JSON.parse(request.body.toString('utf8'));
          } catch {
            return reply.code(400).send({ message: 'Invalid Stripe event.' });
          }
          const result = z
            .object({
              id: z.string().regex(/^evt_[a-z0-9_]+$/iu),
              livemode: z.boolean(),
              type: z.string(),
              data: z.object({
                object: z.object({
                  customer: z
                    .string()
                    .regex(/^cus_[a-z0-9_]+$/iu)
                    .nullish(),
                }),
              }),
            })
            .safeParse(payload);
          if (!result.success)
            return reply.code(400).send({ message: 'Invalid Stripe event.' });
          const event = result.data;
          const customerId = event.data.object.customer;
          if (
            event.livemode ||
            !subscribedEvents.has(event.type) ||
            !customerId
          )
            return { received: true };

          try {
            await db.transaction(async (tx) => {
              const [row] = await tx
                .select()
                .from(billingCustomers)
                .where(eq(billingCustomers.customerId, customerId))
                .for('update');
              if (!row) return;
              const [seen] = await tx
                .insert(billingEvents)
                .values({ id: event.id })
                .onConflictDoNothing()
                .returning({ id: billingEvents.id });
              if (!seen) return;
              if (
                event.type === 'invoice.paid' ||
                event.type === 'charge.refunded'
              ) {
                const bound = await referralInvoice(tx, row.accountId);
                const payment = bound
                  ? referralPayment.parse(
                      await stripe(
                        'invoices/' +
                          invoiceId.parse(bound) +
                          '?expand[]=charge',
                      ),
                    )
                  : bound === null && referralCredits > 0n
                    ? await firstReferralPayment(customerId)
                    : undefined;
                if (
                  payment?.customer === customerId &&
                  payment.status === 'paid' &&
                  payment.charge?.paid &&
                  payment.amount_paid > 0
                )
                  await reconcileReferral(
                    tx,
                    row.accountId,
                    payment.id,
                    referralCredits,
                    payment.charge.refunded,
                  );
              }
              const query = new URLSearchParams({
                customer: customerId,
                status: 'all',
                limit: '25',
                'expand[]': 'data.latest_invoice.charge',
              });
              const listed = z
                .object({ data: z.array(subscriptionSchema) })
                .parse(await stripe('subscriptions?' + query));
              const eligible = listed.data
                .filter((subscription) =>
                  subscription.items.data.some(
                    (item) => item.price.id === config.price,
                  ),
                )
                .sort(
                  (a, b) =>
                    Number(paidStatus(b.status)) -
                      Number(paidStatus(a.status)) || b.created - a.created,
                );
              const subscription = eligible[0];
              const invoice = subscription?.latest_invoice;
              const refunded = Boolean(invoice?.charge?.refunded);
              await tx
                .update(billingCustomers)
                .set({
                  subscriptionId: subscription?.id ?? null,
                  state:
                    refunded && subscription && paidStatus(subscription.status)
                      ? 'refunded'
                      : (subscription?.status ?? 'free'),
                  periodEnd: subscription
                    ? new Date(subscription.current_period_end * 1000)
                    : null,
                  cancelAtPeriodEnd:
                    subscription?.cancel_at_period_end ?? false,
                })
                .where(eq(billingCustomers.accountId, row.accountId));
              if (
                !invoice ||
                invoice.status !== 'paid' ||
                invoice.amount_paid <= 0
              )
                return;
              const operation = 'stripe:invoice:' + invoice.id;
              await tx
                .select({ id: accounts.id })
                .from(accounts)
                .where(eq(accounts.id, row.accountId))
                .for('no key update');
              if (refunded) {
                const [grant] = await tx
                  .select({ amount: creditEntries.amount })
                  .from(creditEntries)
                  .where(
                    and(
                      eq(creditEntries.accountId, row.accountId),
                      eq(creditEntries.operationKey, operation),
                    ),
                  );
                if (grant)
                  await tx
                    .insert(creditEntries)
                    .values({
                      accountId: row.accountId,
                      kind: 'refund',
                      operationKey: 'refund:' + operation,
                      amount: creditDecimal(-creditUnits(grant.amount)),
                    })
                    .onConflictDoNothing();
              } else if (planCredits > 0n) {
                await tx
                  .insert(creditEntries)
                  .values({
                    accountId: row.accountId,
                    kind: 'subscription',
                    operationKey: operation,
                    amount: creditDecimal(planCredits),
                  })
                  .onConflictDoNothing();
              }
            });
            return { received: true };
          } catch {
            request.log.warn(
              { eventId: event.id },
              'Stripe billing reconciliation deferred',
            );
            return reply
              .code(503)
              .send({ message: 'Stripe billing reconciliation will retry.' });
          }
        });
      });
    },
  };
}
