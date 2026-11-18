import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { stripeClient } from '../workspace/stripe-client';
import type { AuthEnv } from './config';

const publishedPrice = z.object({
  active: z.literal(true),
  livemode: z.literal(false),
  billing_scheme: z.literal('per_unit'),
  currency: z.string().regex(/^[a-z]{3}$/u),
  unit_amount: z.number().int().nonnegative(),
  recurring: z.object({
    interval: z.enum(['day', 'week', 'month', 'year']),
    interval_count: z.number().int().positive(),
    usage_type: z.literal('licensed'),
  }),
});

export const planCompanyLimit = 1;

export function registerPublicPlans(
  app: FastifyInstance,
  env: AuthEnv,
  starterCredits: string,
  transport?: typeof fetch,
) {
  const free = {
    welcomeCredits: starterCredits,
    dailyCredits: '0',
    dailyCreditsPerMonth: '0',
    companyLimit: planCompanyLimit,
    firstWebsiteFree: false,
  };
  const priceId = env.STRIPE_TEST_PRICE;
  const stripe =
    env.DATABASE_URL &&
    env.REDIS_URL &&
    env.AUTH_SECRET &&
    env.STRIPE_TEST_KEY &&
    env.STRIPE_WEBHOOK_SECRET &&
    priceId
      ? stripeClient(env.STRIPE_TEST_KEY, transport)
      : null;

  async function readOffer() {
    if (!stripe || !priceId) return [];
    const result = publishedPrice.safeParse(await stripe('prices/' + priceId));
    if (!result.success) return [];
    const price = result.data;
    return [
      {
        id: priceId,
        name: 'Brightwork subscription (test mode)',
        catalogVersion: priceId,
        termsVersion: '1',
        cadence:
          price.recurring.interval_count === 1
            ? price.recurring.interval
            : String(price.recurring.interval_count) +
              ' ' +
              price.recurring.interval +
              's',
        interval: price.recurring.interval,
        intervalCount: price.recurring.interval_count,
        currency: price.currency,
        amountMinor: price.unit_amount,
        credits: env.STRIPE_RENEWAL_CREDITS,
        companyLimit: planCompanyLimit,
        perks: [],
        features: [],
        creditsRollOver: true,
        dailyCredits: '0',
      },
    ];
  }

  let cached:
    { expires: number; offers: ReturnType<typeof readOffer> } | undefined;
  app.get('/api/billing/plans', async (_request, reply) => {
    if (!cached || cached.expires <= Date.now()) {
      cached = {
        expires: Date.now() + 60_000,
        offers: readOffer().catch(() => []),
      };
    }
    return reply
      .header('Cache-Control', 'public, max-age=60')
      .send({ free, offers: await cached.offers });
  });
}
