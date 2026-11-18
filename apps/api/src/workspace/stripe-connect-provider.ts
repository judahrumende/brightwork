import { z } from 'zod';
import { stripeClient } from './stripe-client';

export const accountId = z.string().regex(/^acct_[a-z0-9]+$/iu);
export const sessionId = z.string().regex(/^cs_test_[a-z0-9]+$/iu);
export const paymentId = z.string().regex(/^pi_[a-z0-9]+$/iu);
export const currency = z.string().regex(/^[a-z]{3}$/u);
export const moneyAmount = z.int().nonnegative();
const account = z.object({
  id: accountId,
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
});
const checkoutSession = z.object({
  id: sessionId,
  livemode: z.literal(false),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  status: z.enum(['open', 'complete', 'expired']),
  amount_total: moneyAmount.nullable(),
  currency: currency.nullable(),
  payment_intent: paymentId.nullable(),
  client_reference_id: z.string().max(200).nullable(),
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
) {
  const stripe = stripeClient(key, transport);
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
          'brightwork-connected-account-' + id,
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
          success_url: new URL('/sale/' + order + '?result=returned', origin)
            .href,
          cancel_url: new URL('/sale/' + order, origin).href,
        },
        'brightwork-sale-' +
          order +
          (input.expiredSession
            ? '-' + sessionId.parse(input.expiredSession)
            : ''),
        connected,
      );
      return checkoutSession
        .extend({ url: hostedUrl('checkout.stripe.com') })
        .parse(result);
    },
    async checkout(connected: string, id: string) {
      return checkoutSession
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
      return checkoutSession.parse(
        await stripe(
          'checkout/sessions/' + sessionId.parse(id) + '/expire',
          {},
          'brightwork-expire-' + id,
          accountId.parse(connected),
        ),
      );
    },
    async charge(connected: string, id: string) {
      const chargeId = z
        .string()
        .regex(/^ch_[a-z0-9]+$/iu)
        .parse(id);
      return z
        .object({
          id: z.literal(chargeId),
          livemode: z.literal(false),
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
