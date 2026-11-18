import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripeConnectProvider } from '../src/workspace/stripe-connect-provider';

const workspace = '52580bc5-eee8-4a2d-b16c-d92c7908b415';
const order = '115401a6-ad54-451c-9def-45ab400adf61';

test('Stripe Connect separates seller onboarding and connected checkout', async () => {
  const account = {
    id: 'acct_Fixture',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  };
  const session = {
    id: 'cs_test_Example',
    livemode: false,
    payment_status: 'unpaid',
    status: 'open',
    amount_total: 1999,
    currency: 'aud',
    payment_intent: null,
    client_reference_id: order,
    created: Math.floor(Date.now() / 1000),
    metadata: { brightwork_sale: order },
    url: 'https://checkout.stripe.com/c/pay/fixture',
  };
  let hosted = session.url;
  const checkout = {
    orderId: order,
    accountId: account.id,
    amount: 1999,
    currency: 'aud',
    title: 'Fixture sale',
  };
  const requests: string[] = [];
  const provider = stripeConnectProvider(
    'sk_test_fixture',
    'https://brightwork.example.test',
    async (target, options) => {
      const path = new URL(String(target)).pathname;
      const headers = new Headers(options?.headers);
      const body = options?.body;
      requests.push(path);
      assert.equal(headers.get('authorization'), 'Bearer sk_test_fixture');
      if (path === '/v1/accounts') {
        assert.equal(headers.has('stripe-account'), false);
        assert.equal(
          headers.get('idempotency-key'),
          'brightwork-connected-account-' + workspace,
        );
        assert.ok(body instanceof URLSearchParams);
        assert.equal(body.get('metadata[brightwork_workspace]'), workspace);
        return Response.json(account);
      }
      if (path === '/v1/accounts/' + account.id) return Response.json(account);
      if (path === '/v1/account_links') {
        assert.ok(body instanceof URLSearchParams);
        assert.equal(body.get('account'), account.id);
        assert.equal(
          body.get('return_url'),
          'https://brightwork.example.test/f/' + workspace + '/settings',
        );
        return Response.json({
          url: 'https://connect.stripe.com/setup/fixture',
        });
      }
      assert.equal(headers.get('stripe-account'), account.id);
      if (path === '/v1/checkout/sessions') {
        assert.ok(body instanceof URLSearchParams);
        assert.equal(
          body.get('line_items[0][price_data][unit_amount]'),
          '1999',
        );
        assert.equal(body.get('client_reference_id'), order);
        assert.equal(
          body.get('payment_intent_data[metadata][brightwork_order]'),
          order,
        );
        assert.equal(body.get('metadata[brightwork_sale]'), order);
        assert.equal(
          headers.get('idempotency-key'),
          'brightwork-sale-' + order,
        );
        return Response.json({ ...session, url: hosted });
      }
      if (path === '/v1/charges/ch_Fixture')
        return Response.json({
          id: 'ch_Fixture',
          livemode: false,
          payment_intent: 'pi_Fixture',
          paid: true,
          amount: 1999,
          amount_refunded: 500,
          currency: 'aud',
          metadata: { brightwork_order: order },
        });
      assert.equal(path, '/v1/checkout/sessions/' + session.id);
      return Response.json({
        ...session,
        payment_status: 'paid',
        status: 'complete',
        payment_intent: 'pi_Fixture',
      });
    },
  );
  assert.deepEqual(await provider.createAccount(workspace), account);
  assert.deepEqual(await provider.account(account.id), account);
  assert.equal(
    await provider.onboarding(workspace, account.id),
    'https://connect.stripe.com/setup/fixture',
  );
  assert.deepEqual(await provider.createCheckout(checkout), session);
  assert.equal(
    (await provider.checkout(account.id, session.id)).payment_status,
    'paid',
  );
  assert.equal(
    (await provider.charge(account.id, 'ch_Fixture')).amount_refunded,
    500,
  );
  hosted = 'https://checkout.stripe.com.example.test/fake';
  await assert.rejects(provider.createCheckout(checkout));
  await assert.rejects(provider.checkout(account.id, '../accounts'));
  assert.equal(requests.length, 7);
  assert.throws(() =>
    stripeConnectProvider('sk_live_fixture', 'https://brightwork.example.test'),
  );
});
