import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { observedContracts } from '../../../packages/shared/src/api-contracts.gen';
import { authEnv } from '../src/auth/config';
import { registerAuth } from '../src/auth/routes';
import { registerPublicPlans } from '../src/auth/public-plans';

test('public marketing contracts work without account or Stripe configuration', async (t) => {
  assert.equal(authEnv.parse({}).STRIPE_LIVE_CHECKOUT_ENABLED, false);
  const app = Fastify();
  t.after(() => app.close());
  registerAuth(app, authEnv.parse({}));
  const landing = await app.inject('/api/landing-test');
  assert.equal(landing.statusCode, 200);
  assert.deepEqual(
    observedContracts['GET /api/landing-test'].response.parse(landing.json()),
    { arm: 'control' },
  );
  const plans = await app.inject('/api/billing/plans');
  assert.equal(plans.statusCode, 200);
  const { free, offers } = observedContracts[
    'GET /api/billing/plans'
  ].response.parse(plans.json());
  assert.ok(Number(free.welcomeCredits) >= 0);
  assert.deepEqual(offers, []);
});

test('live seller checkout requires an explicit release enablement flag', () => {
  assert.equal(
    authEnv.parse({
      STRIPE_LIVE_KEY: 'sk_live_fixture',
      STRIPE_CONNECT_LIVE_WEBHOOK_SECRET: 'whsec_fixture',
    }).STRIPE_LIVE_CHECKOUT_ENABLED,
    false,
  );
  assert.throws(() => authEnv.parse({ STRIPE_LIVE_CHECKOUT_ENABLED: 'true' }));
  assert.throws(() =>
    authEnv.parse({
      STRIPE_LIVE_KEY: 'sk_live_fixture',
      STRIPE_CONNECT_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture',
      STRIPE_LIVE_CHECKOUT_ENABLED: 'true',
    }),
  );
  assert.throws(() =>
    authEnv.parse({
      STRIPE_TEST_KEY: 'sk_test_fixture',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_shared_fixture',
      STRIPE_LIVE_KEY: 'sk_live_fixture',
      STRIPE_CONNECT_LIVE_WEBHOOK_SECRET: 'whsec_shared_fixture',
      STRIPE_LIVE_CHECKOUT_ENABLED: 'true',
    }),
  );
  assert.equal(
    authEnv.parse({
      STRIPE_TEST_KEY: 'sk_test_fixture',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_test_fixture',
      STRIPE_LIVE_KEY: 'sk_live_fixture',
      STRIPE_CONNECT_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture',
      STRIPE_LIVE_CHECKOUT_ENABLED: 'true',
    }).STRIPE_LIVE_CHECKOUT_ENABLED,
    true,
  );
});

test('the catalogue publishes the configured recurring test price and shares provider reads', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let reads = 0;
  const env = authEnv.parse({
    DATABASE_URL: 'postgres://fixture',
    REDIS_URL: 'redis://fixture',
    AUTH_SECRET: 'synthetic-account-secret-for-fixtures',
    STRIPE_TEST_KEY: 'sk_test_fixture',
    STRIPE_TEST_PRICE: 'price_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_RENEWAL_CREDITS: '25',
  });
  registerPublicPlans(app, env, '10', async (url, init) => {
    reads++;
    assert.equal(url, 'https://api.stripe.com/v1/prices/price_fixture');
    assert.equal(init?.method, 'GET');
    return Response.json({
      active: true,
      livemode: false,
      billing_scheme: 'per_unit',
      currency: 'aud',
      unit_amount: 2400,
      recurring: {
        interval: 'month',
        interval_count: 3,
        usage_type: 'licensed',
      },
    });
  });
  const [a, b] = await Promise.all([
    app.inject('/api/billing/plans'),
    app.inject('/api/billing/plans'),
  ]);
  for (const response of [a, b]) {
    assert.equal(response.statusCode, 200);
    const { offers } = observedContracts[
      'GET /api/billing/plans'
    ].response.parse(response.json());
    assert.equal(offers[0]?.amountMinor, 2400);
    assert.equal(offers[0]?.currency, 'aud');
    assert.equal(offers[0]?.cadence, '3 months');
    assert.equal(offers[0]?.credits, '25');
  }
  assert.equal(reads, 1);
});
