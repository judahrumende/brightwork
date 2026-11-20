import { z } from 'zod';
import { stripeClient } from './stripe-client';
import type { StripeMode } from './stripe-client';

export const accountId = z.string().regex(/^acct_[a-z0-9]+$/iu);
export const sessionId = z.string().regex(/^cs_(?:test|live)_[a-z0-9]+$/iu);
export const paymentId = z.string().regex(/^pi_[a-z0-9]+$/iu);
export const currency = z.string().regex(/^[a-z]{3}$/u);
export const moneyAmount = z.int().nonnegative();
const account = z.object({
  id: accountId,
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
});
const checkoutSession = (mode: StripeMode) =>
  z.object({
    id: z.string().regex(new RegExp('^cs_' + mode + '_[a-z0-9]+$', 'iu')),
    livemode: z.literal(mode === 'live'),
    payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
    status: z.enum(['open', 'complete', 'expired']),
    amount_total: moneyAmount.nullable(),
    currency: currency.nullable(),
    payment_intent: paymentId.nullable(),
    client_reference_id: z.string().max(200).nullable(),
    created: z.int().nonnegative().max(4_102_444_800),
    metadata: z.record(z.string(), z.string()),
    customer_details: z
      .object({ email: z.string().max(320).nullish() })
      .nullish(),
  });
const hostedUrl = (hostname: string) =>
  z
    .url({
      protocol: /^https$/u,
      hostname: new RegExp('^' + hostname.replaceAll('.', '\\.') + '$', 'u'),
    })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.port;
    });

export function stripeConnectProvider(
  key: string,
  origin: string,
  transport: typeof fetch = fetch,
  mode: StripeMode = 'test',
) {
  const stripe = stripeClient(key, transport, mode);
  const session = checkoutSession(mode);
  const idempotencyKey = (value: string) =>
    mode === 'test' ? value : 'brightwork-live-' + value;
  const settingsUrl = (businessId: string) =>
    new URL('/f/' + z.uuid().parse(businessId) + '/settings', origin).href;
  return {
    async createAccount(businessId: string) {
      const id = z.uuid().parse(businessId);
      return account.parse(
        await stripe(
          'accounts',
          {
            type: 'express',
            'capabilities[card_payments][requested]': 'true',
            'capabilities[transfers][requested]': 'true',
            'metadata[brightwork_workspace]': id,
          },
          idempotencyKey('brightwork-connected-account-' + id),
        ),
      );
    },
    async account(id: string) {
      return account.parse(await stripe('accounts/' + accountId.parse(id)));
    },
    async onboarding(businessId: string, id: string) {
      const returnUrl = settingsUrl(businessId);
      const result = await stripe('account_links', {
        account: accountId.parse(id),
        type: 'account_onboarding',
        refresh_url: returnUrl,
        return_url: returnUrl,
      });
      return z.object({ url: hostedUrl('connect.stripe.com') }).parse(result)
        .url;
    },
    async createCheckout(input: {
      accountId: string;
      orderId: string;
      expiredSession?: string;
      expiresAt?: number;
      title: string;
      amount: number;
      currency: string;
    }) {
      const order = z.uuid().parse(input.orderId);
      const connected = accountId.parse(input.accountId);
      const result = await stripe(
        'checkout/sessions',
        {
          mode: 'payment',
          ...(input.expiresAt ? { expires_at: String(input.expiresAt) } : {}),
          'adaptive_pricing[enabled]': 'false',
          'payment_method_types[0]': 'card',
          client_reference_id: order,
          'line_items[0][price_data][currency]': currency.parse(input.currency),
          'line_items[0][price_data][unit_amount]': String(
            moneyAmount.min(1).parse(input.amount),
          ),
          'line_items[0][price_data][product_data][name]': z
            .string()
            .trim()
            .min(1)
            .max(200)
            .parse(input.title),
          'line_items[0][quantity]': '1',
          'payment_intent_data[metadata][brightwork_order]': order,
          'metadata[brightwork_sale]': order,
          success_url: new URL('/sale/' + order + '?result=returned', origin)
            .href,
          cancel_url: new URL('/sale/' + order, origin).href,
        },
        idempotencyKey(
          'brightwork-sale-' +
            order +
            (input.expiredSession
              ? '-' + sessionId.parse(input.expiredSession)
              : ''),
        ),
        connected,
      );
      return session
        .extend({ url: hostedUrl('checkout.stripe.com') })
        .parse(result);
    },
    async checkoutCandidates(connected: string, from: number, through: number) {
      const sessions: z.infer<ReturnType<typeof checkoutSession>>[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const params = new URLSearchParams({
          limit: '100',
          'created[gte]': String(from),
          'created[lte]': String(through),
          ...(cursor ? { starting_after: cursor } : {}),
        });
        const result = z
          .object({
            data: z.array(session),
            has_more: z.boolean(),
          })
          .parse(
            await stripe(
              'checkout/sessions?' + params,
              undefined,
              undefined,
              accountId.parse(connected),
            ),
          );
        sessions.push(...result.data);
        if (!result.has_more) return { sessions, complete: true };
        cursor = result.data.at(-1)?.id;
        if (!cursor) break;
      }
      return { sessions, complete: false };
    },
    async checkout(connected: string, id: string) {
      return session
        .extend({ url: hostedUrl('checkout.stripe.com').nullish() })
        .parse(
          await stripe(
            'checkout/sessions/' + sessionId.parse(id),
            undefined,
            undefined,
            accountId.parse(connected),
          ),
        );
    },
    async expireCheckout(connected: string, id: string) {
      return session.parse(
        await stripe(
          'checkout/sessions/' + sessionId.parse(id) + '/expire',
          {},
          idempotencyKey('brightwork-expire-' + id),
          accountId.parse(connected),
        ),
      );
    },
    async capturedPayment(connected: string, id: string) {
      const intentId = paymentId.parse(id);
      return z
        .object({
          id: z.literal(intentId),
          livemode: z.literal(mode === 'live'),
          status: z.literal('succeeded'),
          amount_received: moneyAmount,
          currency,
          metadata: z.object({ brightwork_order: z.uuid() }),
          latest_charge: z.object({
            payment_intent: z.literal(intentId),
            paid: z.literal(true),
            captured: z.literal(true),
            created: z.int().nonnegative().max(4_102_444_800),
            amount_captured: moneyAmount,
            amount_refunded: moneyAmount,
            currency,
          }),
        })
        .parse(
          await stripe(
            'payment_intents/' + intentId + '?expand%5B%5D=latest_charge',
            undefined,
            undefined,
            accountId.parse(connected),
          ),
        );
    },
    async refundPayment(
      connected: string,
      paymentIntent: string,
      amount: number,
      requestId: string,
    ) {
      const intentId = paymentId.parse(paymentIntent);
      const request = z.uuid().parse(requestId);
      return z
        .object({
          id: z.string().regex(/^re_[a-z0-9]+$/iu),
          amount: moneyAmount,
          currency,
          payment_intent: z.literal(intentId),
          status: z.enum([
            'pending',
            'requires_action',
            'succeeded',
            'failed',
            'canceled',
          ]),
          livemode: z.literal(mode === 'live'),
        })
        .parse(
          await stripe(
            'refunds',
            {
              payment_intent: intentId,
              amount: String(moneyAmount.min(1).parse(amount)),
              'metadata[brightwork_refund_request]': request,
            },
            idempotencyKey('brightwork-store-refund-' + request),
            accountId.parse(connected),
          ),
        );
    },
    async findRefundRequest(
      connected: string,
      paymentIntent: string,
      requestId: string,
    ) {
      const intentId = paymentId.parse(paymentIntent);
      const request = z.uuid().parse(requestId);
      let startingAfter: string | undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({
          payment_intent: intentId,
          limit: '100',
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        const result = z
          .object({
            data: z.array(
              z.object({
                id: z.string().regex(/^re_[a-z0-9]+$/iu),
                amount: moneyAmount,
                currency,
                payment_intent: z.literal(intentId),
                status: z.enum([
                  'pending',
                  'requires_action',
                  'succeeded',
                  'failed',
                  'canceled',
                ]),
                livemode: z.literal(mode === 'live'),
                metadata: z.record(z.string(), z.string()),
              }),
            ),
            has_more: z.boolean(),
          })
          .parse(
            await stripe(
              'refunds?' + query,
              undefined,
              undefined,
              accountId.parse(connected),
            ),
          );
        const found = result.data.find(
          (refund) => refund.metadata.brightwork_refund_request === request,
        );
        if (found) return found;
        const last = result.data.at(-1);
        if (!result.has_more || !last) return undefined;
        startingAfter = last.id;
      }
      return undefined;
    },
    async charge(connected: string, id: string) {
      const chargeId = z
        .string()
        .regex(/^ch_[a-z0-9]+$/iu)
        .parse(id);
      return z
        .object({
          id: z.literal(chargeId),
          livemode: z.literal(mode === 'live'),
          payment_intent: paymentId.nullable(),
          paid: z.boolean(),
          amount: moneyAmount,
          amount_refunded: moneyAmount,
          currency,
          metadata: z.object({ brightwork_order: z.uuid().optional() }),
        })
        .parse(
          await stripe(
            'charges/' + chargeId,
            undefined,
            undefined,
            accountId.parse(connected),
          ),
        );
    },
  };
}
