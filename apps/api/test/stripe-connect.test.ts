import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import {
  accounts,
  agentTurns,
  artifacts,
  businesses,
  creditEntries,
  publications,
  websiteVersions,
} from '../src/db/schema';
import {
  fulfillmentTracking,
  generatedStores,
} from '../src/workspace/generated-store';
import { commerceInsights } from '../src/workspace/commerce-insights';
import {
  stripeConnect,
  stripeConnectModes,
} from '../src/workspace/stripe-connect';
import { registerStorefront } from '../src/workspace/storefront';
import { storeEmailOutbox } from '../src/workspace/store-email-outbox';

const url = process.env.TEST_DATABASE_URL;
test(
  'Stripe sellers and signed sale reconciliation stay scoped',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_connect_' + randomUUID().replaceAll('-', '');
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    const connection = postgres(url, {
      max: 5,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    const db = drizzle(connection);
    const app = Fastify();
    t.after(async () => {
      await app.close();
      await connection.end();
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    });
    await admin`create schema ${admin(schema)}`;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      migrationsSchema: schema,
    });
    const [owner, other, refundOwner] = await db
      .insert(businesses)
      .values([
        { name: 'Stripe fixture' },
        { name: 'Separate business' },
        { name: 'Refund fixture' },
      ])
      .returning();
    assert.ok(owner && other && refundOwner);
    assert.equal(
      fulfillmentTracking.safeParse({
        carrier: 'Courier',
        number: 'PKG-1',
        url: 'http://track.example.test/PKG-1',
      }).success,
      false,
    );
    assert.equal(
      fulfillmentTracking.parse({
        carrier: ' Courier ',
        number: ' PKG-1 ',
        url: 'HTTPS://TRACK.EXAMPLE.TEST/PKG-1',
      }).url,
      'https://track.example.test/PKG-1',
    );

    const accountId = 'acct_Fixture';
    const liveAccountId = 'acct_LiveFixture';
    const secret = 'synthetic-stripe-hook-secret';
    const order = {
      id: randomUUID(),
      title: 'Test sale',
      currency: 'aud',
      amount: 1999,
    };
    const origin = 'https://brightwork.example.test';
    const link = 'https://checkout.stripe.com/c/pay/test';
    let active = false;
    let refund = 0;
    let failures = 0;
    let lookups = 0;
    let capturedAmount = order.amount;
    let checkoutStatus = 'open';
    let session = 'cs_test_Sale';
    let submissions = 0;
    let checkoutOrder = order;
    let paymentIntent = 'pi_Sale';
    let storeFixture = false;
    let failCheckoutCreation = false;
    let loseCheckoutResponse = false;
    let listedSessions = true;
    let directFixture = false;
    const refundSaleId = randomUUID();
    const refundAccountId = 'acct_Refundfixture';
    const recoveredRefundId = randomUUID();
    const partialRefundId = randomUUID();
    const finalRefundId = randomUUID();
    const concurrentRefundId = randomUUID();
    let refundedAmount = 0;
    let refundRequests = 0;
    let reflectedRefund: {
      id: string;
      amount: number;
      currency: string;
      payment_intent: string;
      status: string;
      livemode: boolean;
      metadata: Record<string, string>;
    } | null = null;
    const connect = stripeConnect(
      db,
      { origin, secret, key: 'sk_test_fixture' },
      async (input, request) => {
        const path = new URL(String(input)).pathname;
        const headers = new Headers(request?.headers);
        if (path.startsWith('/v1/accounts'))
          return Response.json({
            id: accountId,
            charges_enabled: active,
            payouts_enabled: active,
            details_submitted: active,
          });
        if (path === '/v1/account_links')
          return Response.json({
            url: 'https://connect.stripe.com/setup/test',
          });
        if (path === '/v1/payment_intents/pi_refundfixture') {
          assert.equal(headers.get('stripe-account'), refundAccountId);
          return Response.json({
            id: 'pi_refundfixture',
            livemode: false,
            status: 'succeeded',
            amount_received: 1500,
            currency: 'aud',
            metadata: { brightwork_order: refundSaleId },
            latest_charge: {
              payment_intent: 'pi_refundfixture',
              paid: true,
              captured: true,
              created: Math.floor(Date.now() / 1000),
              amount_captured: 1500,
              amount_refunded: refundedAmount,
              currency: 'aud',
            },
          });
        }
        if (path === '/v1/refunds') {
          if (request?.method === 'GET')
            return Response.json({
              data: reflectedRefund ? [reflectedRefund] : [],
              has_more: false,
            });
          refundRequests++;
          const body = new URLSearchParams(String(request?.body));
          assert.equal(body.get('payment_intent'), 'pi_refundfixture');
          const amount = Number(body.get('amount'));
          assert.equal(
            headers.get('idempotency-key'),
            'brightwork-store-refund-' + partialRefundId,
          );
          assert.equal(headers.get('stripe-account'), refundAccountId);
          refundedAmount += amount;
          return Response.json({
            id: 're_refundfixture',
            amount,
            currency: 'aud',
            payment_intent: 'pi_refundfixture',
            status: 'succeeded',
            livemode: false,
          });
        }
        assert.equal(headers.get('stripe-account'), accountId);
        if (failures) {
          failures--;
          return new Response('temporary provider outage', { status: 503 });
        }
        if (path === '/v1/payment_intents/pi_DirectRecovered')
          return Response.json({
            id: 'pi_DirectRecovered',
            livemode: false,
            status: 'succeeded',
            amount_received: checkoutOrder.amount,
            currency: checkoutOrder.currency,
            metadata: { brightwork_order: checkoutOrder.id },
            latest_charge: {
              payment_intent: 'pi_DirectRecovered',
              paid: true,
              captured: true,
              created: Math.floor(Date.now() / 1000),
              amount_captured: checkoutOrder.amount,
              amount_refunded: 0,
              currency: checkoutOrder.currency,
            },
          });
        if (path === '/v1/charges/ch_Sale')
          return Response.json({
            id: 'ch_Sale',
            livemode: false,
            payment_intent: paymentIntent,
            paid: true,
            amount: checkoutOrder.amount,
            amount_refunded: refund,
            currency: checkoutOrder.currency,
            metadata: { brightwork_order: checkoutOrder.id },
          });
        if (path === '/v1/checkout/sessions' && request?.method === 'GET') {
          return Response.json({
            data: listedSessions
              ? [
                  {
                    id: session,
                    livemode: false,
                    status: checkoutStatus,
                    payment_status:
                      checkoutStatus === 'complete' ? 'paid' : 'unpaid',
                    client_reference_id: checkoutOrder.id,
                    created: Math.floor(Date.now() / 1000),
                    metadata: { brightwork_sale: checkoutOrder.id },
                    payment_intent:
                      checkoutStatus === 'complete' ? paymentIntent : null,
                    customer_details:
                      checkoutStatus === 'complete'
                        ? { email: 'Buyer@example.test' }
                        : null,
                    amount_total: checkoutOrder.amount,
                    currency: checkoutOrder.currency,
                    url: link,
                  },
                ]
              : [],
            has_more: false,
          });
        }
        const creating =
          path === '/v1/checkout/sessions' && request?.method === 'POST';
        if (creating) {
          if (failCheckoutCreation) {
            failCheckoutCreation = false;
            return new Response('temporary provider outage', { status: 503 });
          }
          submissions++;
          if (storeFixture) {
            const fields = new URLSearchParams(String(request?.body));
            if (directFixture) {
              assert.ok(fields.get('client_reference_id'));
              checkoutOrder = {
                ...checkoutOrder,
                id: fields.get('client_reference_id')!,
              };
            }
            assert.equal(fields.get('client_reference_id'), checkoutOrder.id);
            assert.equal(
              fields.get('line_items[0][price_data][unit_amount]'),
              String(checkoutOrder.amount),
            );
            assert.equal(
              fields.get('line_items[0][price_data][currency]'),
              checkoutOrder.currency,
            );
          }
          if (submissions === 2) {
            assert.equal(
              headers.get('idempotency-key'),
              'brightwork-sale-' + order.id + '-cs_test_Sale',
            );
            session = 'cs_test_Replacement';
          }
          checkoutStatus = 'open';
          if (loseCheckoutResponse) {
            loseCheckoutResponse = false;
            throw new Error('connection lost after Stripe created the session');
          }
        } else if (path.endsWith('/expire')) {
          assert.equal(path, '/v1/checkout/sessions/' + session + '/expire');
          assert.equal(
            headers.get('idempotency-key'),
            'brightwork-expire-' + session,
          );
          checkoutStatus = 'expired';
        } else {
          assert.equal(path, '/v1/checkout/sessions/' + session);
          lookups++;
        }
        const complete = checkoutStatus === 'complete';
        return Response.json({
          id: session,
          livemode: false,
          status: checkoutStatus,
          payment_status: complete ? 'paid' : 'unpaid',
          client_reference_id: checkoutOrder.id,
          created: Math.floor(Date.now() / 1000),
          metadata: { brightwork_sale: checkoutOrder.id },
          payment_intent: complete ? paymentIntent : null,
          customer_details: complete ? { email: 'Buyer@example.test' } : null,
          amount_total: creating ? checkoutOrder.amount : capturedAmount,
          currency: checkoutOrder.currency,
          url: link,
        });
      },
    );
    connect.register(app);
    await connection`insert into stripe_sellers
      (business_id, mode, account_id, charges_enabled, payouts_enabled, details_submitted)
      values (${refundOwner.id}, 'test', ${refundAccountId}, true, true, true)`;
    await connection`insert into stripe_sales
      (id, business_id, mode, account_id, title, currency, amount, payment_id, paid_at)
      values (${refundSaleId}, ${refundOwner.id}, 'test', ${refundAccountId}, 'Refund fixture', 'aud', 1500,
        'pi_refundfixture', now())`;
    const refundSiteId = randomUUID();
    const refundOrderId = randomUUID();
    const refundProductId = randomUUID();
    await connection`insert into workspace_artifacts (id, business_id, kind, title, body)
      values (${refundSiteId}, ${refundOwner.id}, 'website', 'Refund store', '<main></main>')`;
    await db.insert(websiteVersions).values({
      artifactId: refundSiteId,
      revision: 1,
      title: 'Refund store',
      document: '<main></main>',
      runtimeMode: 'store',
    });
    await connection`insert into generated_stores (site_id, first_revision, currency)
      values (${refundSiteId}, 1, 'AUD')`;
    await connection`insert into generated_store_products
      (id, site_id, name, description, price, stock, active)
      values (${refundProductId}, ${refundSiteId}, 'Item', '', 1500, 0, true)`;
    await connection`insert into generated_store_orders
      (site_id, id, product_id, product_name, unit_price, currency, quantity, email, status, sale_id)
      values (${refundSiteId}, ${refundOrderId}, ${refundProductId}, 'Item', 1500, 'AUD', 1,
        'buyer@example.test', 'fulfilled', ${refundSaleId})`;
    const liveSecret = 'synthetic-live-stripe-hook-secret';
    const liveRefundRequestId = randomUUID();
    let liveRefundedAmount = 0;
    let liveRefundRequests = 0;
    const liveConnect = stripeConnect(
      db,
      {
        origin,
        secret: liveSecret,
        key: 'sk_live_fixture',
        mode: 'live',
      },
      async (input, request) => {
        const path = new URL(String(input)).pathname;
        const headers = new Headers(request?.headers);
        assert.equal(headers.get('authorization'), 'Bearer sk_live_fixture');
        if (path === '/v1/accounts') {
          assert.equal(request?.method, 'POST');
          return Response.json({
            id: liveAccountId,
            charges_enabled: active,
            payouts_enabled: active,
            details_submitted: active,
          });
        }
        if (path.startsWith('/v1/accounts/'))
          return Response.json({
            id: liveAccountId,
            charges_enabled: active,
            payouts_enabled: active,
            details_submitted: active,
          });
        if (path === '/v1/account_links') {
          assert.equal(
            new URLSearchParams(String(request?.body)).get('account'),
            liveAccountId,
          );
          return Response.json({
            url: 'https://connect.stripe.com/setup/live',
          });
        }
        if (path === '/v1/checkout/sessions/cs_live_ModeRouted') {
          assert.equal(headers.get('stripe-account'), liveAccountId);
          return Response.json({
            id: 'cs_live_ModeRouted',
            livemode: true,
            status: 'complete',
            payment_status: 'paid',
            client_reference_id: liveOrder.id,
            created: Math.floor(Date.now() / 1000),
            metadata: { brightwork_sale: liveOrder.id },
            payment_intent: 'pi_livemoderouted',
            customer_details: { email: 'Buyer@example.test' },
            amount_total: liveOrder.amount,
            currency: liveOrder.currency,
            url: 'https://checkout.stripe.com/c/pay/live-routed',
          });
        }
        if (path.startsWith('/v1/payment_intents/pi_livemoderouted')) {
          assert.equal(headers.get('stripe-account'), liveAccountId);
          return Response.json({
            id: 'pi_livemoderouted',
            livemode: true,
            status: 'succeeded',
            amount_received: liveOrder.amount,
            currency: liveOrder.currency,
            metadata: { brightwork_order: liveOrder.id },
            latest_charge: {
              payment_intent: 'pi_livemoderouted',
              paid: true,
              captured: true,
              created: Math.floor(Date.now() / 1000),
              amount_captured: liveOrder.amount,
              amount_refunded: liveRefundedAmount,
              currency: liveOrder.currency,
            },
          });
        }
        if (path === '/v1/refunds') {
          assert.equal(request?.method, 'POST');
          assert.equal(headers.get('authorization'), 'Bearer sk_live_fixture');
          assert.equal(headers.get('stripe-account'), liveAccountId);
          assert.equal(
            headers.get('idempotency-key'),
            'brightwork-live-brightwork-store-refund-' + liveRefundRequestId,
          );
          const body = new URLSearchParams(String(request?.body));
          assert.equal(body.get('payment_intent'), 'pi_livemoderouted');
          assert.equal(body.get('amount'), String(liveOrder.amount));
          assert.equal(
            body.get('metadata[brightwork_refund_request]'),
            liveRefundRequestId,
          );
          liveRefundRequests++;
          liveRefundedAmount += Number(body.get('amount'));
          return Response.json({
            id: 're_LiveModeRouted',
            amount: liveOrder.amount,
            currency: liveOrder.currency,
            payment_intent: 'pi_livemoderouted',
            status: 'succeeded',
            livemode: true,
          });
        }
        if (path === '/v1/charges/ch_livemoderouted') {
          assert.equal(headers.get('stripe-account'), liveAccountId);
          return Response.json({
            id: 'ch_livemoderouted',
            livemode: true,
            payment_intent: 'pi_livemoderouted',
            paid: true,
            amount: liveOrder.amount,
            amount_refunded: liveRefundedAmount,
            currency: liveOrder.currency,
            metadata: { brightwork_order: liveOrder.id },
          });
        }
        throw new Error('Unexpected live Stripe fixture request.');
      },
    );
    liveConnect.register(app);
    const liveOrder = { ...order, id: randomUUID(), title: 'Live sale' };
    const routedLiveOrder = liveOrder;
    const payments = stripeConnectModes(
      db,
      {
        test: { key: 'sk_test_fixture', secret },
        live: { key: 'sk_live_fixture', secret: liveSecret },
      },
      { origin },
      async (input, request) => {
        const headers = new Headers(request?.headers);
        const path = new URL(String(input)).pathname;
        if (path === '/v1/payment_intents/pi_refundfixture') {
          assert.equal(headers.get('authorization'), 'Bearer sk_test_fixture');
          assert.equal(headers.get('stripe-account'), refundAccountId);
          return Response.json({
            id: 'pi_refundfixture',
            livemode: false,
            status: 'succeeded',
            amount_received: 1500,
            currency: 'aud',
            metadata: { brightwork_order: refundSaleId },
            latest_charge: {
              payment_intent: 'pi_refundfixture',
              paid: true,
              captured: true,
              created: Math.floor(Date.now() / 1000),
              amount_captured: 1500,
              amount_refunded: refundedAmount,
              currency: 'aud',
            },
          });
        }
        if (path === '/v1/refunds') {
          if (request?.method === 'GET')
            return Response.json({
              data: reflectedRefund ? [reflectedRefund] : [],
              has_more: false,
            });
          refundRequests++;
          assert.equal(headers.get('authorization'), 'Bearer sk_test_fixture');
          assert.equal(headers.get('stripe-account'), refundAccountId);
          const body = new URLSearchParams(String(request?.body));
          assert.equal(body.get('payment_intent'), 'pi_refundfixture');
          const amount = Number(body.get('amount'));
          const requestId = [
            partialRefundId,
            finalRefundId,
            concurrentRefundId,
          ].find(
            (id) =>
              headers.get('idempotency-key') ===
              'brightwork-store-refund-' + id,
          );
          assert.ok(requestId);
          assert.equal(
            body.get('metadata[brightwork_refund_request]'),
            requestId,
          );
          assert.equal(
            body.get('amount'),
            refundRequests === 1 ? '500' : '600',
          );
          refundedAmount += amount;
          return Response.json({
            id: 're_refundfixture',
            amount,
            currency: 'aud',
            payment_intent: 'pi_refundfixture',
            status: 'succeeded',
            livemode: false,
          });
        }
        assert.equal(headers.get('authorization'), 'Bearer sk_live_fixture');
        assert.equal(headers.get('stripe-account'), liveAccountId);
        assert.equal(path, '/v1/checkout/sessions');
        assert.equal(request?.method, 'POST');
        const body = new URLSearchParams(String(request?.body));
        assert.equal(body.get('client_reference_id'), routedLiveOrder.id);
        return Response.json({
          id: 'cs_live_ModeRouted',
          livemode: true,
          payment_status: 'unpaid',
          status: 'open',
          amount_total: routedLiveOrder.amount,
          currency: routedLiveOrder.currency,
          payment_intent: null,
          client_reference_id: routedLiveOrder.id,
          created: Math.floor(Date.now() / 1000),
          metadata: { brightwork_sale: routedLiveOrder.id },
          url: 'https://checkout.stripe.com/c/pay/live-routed',
        });
      },
    );
    function webhook(
      id: number,
      type: string,
      objectId: string,
      account = accountId,
      key = secret,
      live = false,
    ) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        id: 'evt_' + id,
        type,
        account,
        created: timestamp,
        livemode: live,
        data: { object: { id: objectId } },
      });
      const signature = createHmac('sha256', key)
        .update(timestamp + '.' + payload)
        .digest('hex');
      return app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe-connect',
        payload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=' + timestamp + ',v1=' + signature,
        },
      });
    }
    function liveWebhook(
      id: number,
      live: boolean,
      type = 'account.updated',
      objectId = liveAccountId,
    ) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        id: 'evt_live' + id,
        type,
        account: liveAccountId,
        created: timestamp,
        livemode: live,
        data: { object: { id: objectId } },
      });
      const signature = createHmac('sha256', liveSecret)
        .update(timestamp + '.' + payload)
        .digest('hex');
      return app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe-connect/live',
        payload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=' + timestamp + ',v1=' + signature,
        },
      });
    }
    assert.equal(
      await connect.onboarding(owner.id),
      'https://connect.stripe.com/setup/test',
    );
    assert.equal(await connect.create(owner.id, order), false);
    active = true;
    assert.equal(
      (await webhook(1, 'account.updated', accountId, accountId, 'incorrect'))
        .statusCode,
      403,
    );
    assert.equal(
      (await webhook(1, 'account.updated', accountId, accountId, secret, true))
        .statusCode,
      400,
    );
    assert.equal(
      (await webhook(1, 'account.updated', accountId)).statusCode,
      204,
    );
    assert.equal((await connect.overview(owner.id)).seller?.ready, true);
    refundedAmount = 250;
    reflectedRefund = {
      id: 're_refundrecovered',
      amount: 250,
      currency: 'aud',
      payment_intent: 'pi_refundfixture',
      status: 'succeeded',
      livemode: false,
      metadata: { brightwork_refund_request: recoveredRefundId },
    };
    assert.equal(
      await payments.refundStoreOrder(
        refundOwner.id,
        refundSiteId,
        refundOrderId,
        250,
        recoveredRefundId,
      ),
      true,
    );
    assert.equal(
      await payments.refundStoreOrder(
        refundOwner.id,
        refundSiteId,
        refundOrderId,
        500,
        partialRefundId,
      ),
      true,
    );
    assert.equal(
      await payments.refundStoreOrder(
        refundOwner.id,
        refundSiteId,
        refundOrderId,
        500,
        partialRefundId,
      ),
      true,
    );
    const concurrentRefunds = await Promise.all([
      payments.refundStoreOrder(
        refundOwner.id,
        refundSiteId,
        refundOrderId,
        600,
        finalRefundId,
      ),
      payments.refundStoreOrder(
        refundOwner.id,
        refundSiteId,
        refundOrderId,
        600,
        concurrentRefundId,
      ),
    ]);
    assert.deepEqual(concurrentRefunds.sort(), [false, true]);
    assert.equal(
      await liveConnect.refundSale(
        refundOwner.id,
        refundSaleId,
        1,
        randomUUID(),
      ),
      false,
    );
    assert.equal(refundRequests, 2);
    const [refundedSale] = await connection`
      select amount_refunded from stripe_sales where id = ${refundSaleId}`;
    assert.equal(refundedSale?.amount_refunded, 1350);
    const refundedStore = await generatedStores(db).read(
      refundOwner.id,
      refundSiteId,
    );
    assert.equal(
      refundedStore?.orders.find((candidate) => candidate.id === refundOrderId)
        ?.amountRefunded,
      1350,
    );
    const storedRefundRequests = await connection`
      select id, status from stripe_store_refund_requests where sale_id = ${refundSaleId}`;
    assert.equal(storedRefundRequests.length, 3);
    assert.ok(
      storedRefundRequests.every(({ status }) => status === 'succeeded'),
    );
    const refundActivity = await connection`
      select kind, source_key from generated_store_activity
      where site_id = ${refundSiteId} and kind = 'payment.refund'
      order by source_key
    `;
    assert.deepEqual(
      refundActivity.map(({ source_key }) => source_key),
      [
        `store-refund:${refundSaleId}:1350`,
        `store-refund:${refundSaleId}:250`,
        `store-refund:${refundSaleId}:750`,
      ].sort(),
    );
    assert.equal(
      await liveConnect.onboarding(owner.id),
      'https://connect.stripe.com/setup/live',
    );
    assert.equal((await liveConnect.overview(owner.id)).seller?.ready, true);
    assert.equal((await liveWebhook(1, false)).statusCode, 400);
    assert.equal((await liveWebhook(1, true)).statusCode, 204);
    const [sellerModes] = await connection`
      select count(*)::int as count from stripe_sellers
      where business_id = ${owner.id} and account_id = ${liveAccountId} and mode = 'live'
    `;
    assert.equal(sellerModes?.count, 1);
    const [testSeller] = await connection`
      select account_id from stripe_sellers where business_id = ${owner.id} and mode = 'test'
    `;
    assert.equal(testSeller?.account_id, accountId);
    assert.notEqual(testSeller?.account_id, liveAccountId);
    assert.equal(await liveConnect.create(owner.id, liveOrder), true);
    assert.deepEqual(
      (await liveConnect.overview(owner.id)).orders.map(({ id }) => id),
      [liveOrder.id],
    );
    assert.deepEqual(
      (await connect.overview(owner.id)).orders.map(({ id }) => id),
      [],
    );
    assert.deepEqual(payments.availableModes(), ['test', 'live']);
    assert.equal((await payments.publicOrder(liveOrder.id))?.id, liveOrder.id);
    assert.equal((await payments.publicOrder(liveOrder.id))?.mode, 'live');
    assert.equal(
      await payments.checkout(liveOrder.id),
      'https://checkout.stripe.com/c/pay/live-routed',
    );
    const livePaymentEvent = await liveWebhook(
      2,
      true,
      'checkout.session.completed',
      'cs_live_ModeRouted',
    );
    assert.equal(livePaymentEvent.statusCode, 204, livePaymentEvent.body);
    assert.ok((await liveConnect.publicOrder(liveOrder.id))?.paidAt);
    assert.equal(
      await liveConnect.refundSale(
        owner.id,
        liveOrder.id,
        liveOrder.amount,
        liveRefundRequestId,
      ),
      true,
    );
    assert.equal(liveRefundRequests, 1);
    const [liveRefundedSale] = await connection`
      select mode, account_id, amount_refunded from stripe_sales where id = ${liveOrder.id}
    `;
    assert.equal(liveRefundedSale?.mode, 'live');
    assert.equal(liveRefundedSale?.account_id, liveAccountId);
    assert.equal(liveRefundedSale?.amount_refunded, liveOrder.amount);
    assert.equal(
      (await liveWebhook(3, true, 'charge.refunded', 'ch_livemoderouted'))
        .statusCode,
      204,
    );
    assert.equal(await connect.checkout(liveOrder.id), null);
    assert.equal(await connect.publicOrder(liveOrder.id), null);
    assert.equal(await connect.create(owner.id, order), true);
    assert.equal(
      await connect.create(owner.id, { ...order, amount: 2000 }),
      false,
    );
    assert.equal(await connect.create(other.id, order), false);
    assert.equal(await connect.checkout(order.id), link);
    assert.equal(await connect.checkout(order.id), link);
    assert.equal(submissions, 1);
    checkoutStatus = 'expired';
    assert.equal(await connect.checkout(order.id), link);
    assert.equal(submissions, 2);
    checkoutStatus = 'complete';
    assert.equal(
      (
        await webhook(
          2,
          'checkout.session.completed',
          'cs_test_Sale',
          'acct_Unrelated',
        )
      ).statusCode,
      204,
    );
    assert.equal((await connect.publicOrder(order.id))?.paidAt, null);
    refund = 500;
    assert.equal(
      (await webhook(3, 'charge.refunded', 'ch_Sale')).statusCode,
      204,
    );
    assert.equal((await connect.publicOrder(order.id))?.amountRefunded, 500);
    capturedAmount = order.amount + 1;
    assert.equal(
      (await webhook(4, 'checkout.session.completed', 'cs_test_Replacement'))
        .statusCode,
      204,
    );
    assert.equal((await connect.publicOrder(order.id))?.paidAt, null);
    capturedAmount = order.amount;
    failures = 1;
    assert.equal(
      (await webhook(5, 'checkout.session.completed', 'cs_test_Replacement'))
        .statusCode,
      500,
    );
    assert.equal(
      (await webhook(5, 'checkout.session.completed', 'cs_test_Replacement'))
        .statusCode,
      204,
    );
    assert.equal(
      (await webhook(5, 'checkout.session.completed', 'cs_test_Replacement'))
        .statusCode,
      204,
    );
    assert.equal(lookups, 4);
    assert.ok((await connect.publicOrder(order.id))?.paidAt);
    const [[testSale], [storedLiveSale]] = await Promise.all([
      connection`select id, customer_key from stripe_sales where id = ${order.id}`,
      connection`select id, customer_key from stripe_sales where id = ${liveOrder.id}`,
    ]);
    assert.ok(testSale?.customer_key);
    assert.ok(storedLiveSale?.customer_key);
    assert.notEqual(testSale?.customer_key, storedLiveSale?.customer_key);
    refund = 1999;
    await webhook(6, 'charge.refunded', 'ch_Sale');
    assert.equal((await connect.publicOrder(order.id))?.amountRefunded, 1999);
    assert.deepEqual((await connect.overview(other.id)).orders, []);
    const day = new Date().toISOString().slice(0, 10);
    await connection`update stripe_sales set customer_key = null where id = ${order.id}`;
    assert.equal(await connect.repairHistory(other.id), null);
    capturedAmount = order.amount + 1;
    assert.deepEqual(await connect.repairHistory(owner.id), {
      checked: 1,
      refreshed: 0,
      failed: 0,
      next: null,
    });
    capturedAmount = order.amount;
    failures = 1;
    assert.deepEqual(await connect.repairHistory(owner.id), {
      checked: 1,
      refreshed: 0,
      failed: 1,
      next: null,
    });
    assert.deepEqual(await connect.repairHistory(owner.id), {
      checked: 1,
      refreshed: 1,
      failed: 0,
      next: null,
    });
    assert.equal((await connect.repairHistory(owner.id))?.checked, 0);
    const insights = await commerceInsights(db, owner.id, {
      from: day,
      through: day,
    });
    assert.equal(insights.revenue[0]?.source, 'stripe');
    assert.equal(Number(insights.revenue[0]?.gross), 19.99);
    assert.equal(Number(insights.revenue[0]?.refunded), 19.99);
    assert.equal(Number(insights.revenue[0]?.net), 0);
    assert.deepEqual(insights.customers, {
      identified: 1,
      repeat: 0,
      unattributed: 0,
    });
    assert.ok(!JSON.stringify(insights).includes('Buyer@example.test'));

    assert.equal(await connect.checkout(order.id), null);

    const [site] = await db
      .insert(artifacts)
      .values({
        businessId: owner.id,
        kind: 'website',
        title: 'Test shop',
        body: '<h1>Test shop</h1>',
        state: 'approved',
      })
      .returning();
    assert.ok(site);
    await db.insert(websiteVersions).values({
      artifactId: site.id,
      revision: 1,
      title: site.title,
      document: site.body,
      runtimeMode: 'store',
    });
    await db.insert(publications).values({
      artifactId: site.id,
      draftRevision: 1,
      document: site.body,
      pages: [],
    });
    await connection`insert into generated_stores(site_id, currency, first_revision) values (${site.id}, 'AUD', 1)`;
    const stores = generatedStores(db);
    assert.equal(await connect.readyForCheckout(owner.id), true);
    assert.equal(await connect.readyForCheckout(other.id), false);
    assert.ok(
      await stores.saveProduct(owner.id, site.id, {
        name: 'Kettle',
        description: '',
        price: 4500,
        stock: 2,
        active: true,
        photo: {
          mime: 'image/png',
          content: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAC0AAAAASUVORK5CYII=',
            'base64',
          ),
          alt: 'Kettle',
        },
      }),
    );
    assert.ok(
      await stores.saveProduct(owner.id, site.id, {
        name: 'Filters',
        description: '',
        price: 2250,
        stock: 2,
        active: true,
      }),
    );
    assert.ok(
      await stores.saveDiscount(owner.id, site.id, {
        code: 'WELCOME25',
        percentOff: 25,
        active: true,
        maxUses: 1,
        expiresAt: null,
      }),
    );
    const discountedProduct = (
      await stores.read(owner.id, site.id)
    )?.products.find(({ name }) => name === 'Kettle');
    assert.ok(discountedProduct);
    const discountedOrder = randomUUID();
    const discountedOrderInput = {
      id: discountedOrder,
      email: 'discount@example.test',
      discountCode: 'welcome25',
      items: [
        {
          productId: discountedProduct.id,
          revision: discountedProduct.revision,
          quantity: 1,
        },
      ],
    };
    assert.equal(await stores.request(site.id, discountedOrderInput), true);
    assert.equal(await stores.request(site.id, discountedOrderInput), true);
    const storeEmails = storeEmailOutbox(db);
    const receiptEmail = await storeEmails.claim('orders@example.test');
    assert.ok(receiptEmail);
    assert.equal(receiptEmail.recipient, 'discount@example.test');
    assert.match(receiptEmail.subject, /Order received/u);
    assert.match(receiptEmail.body, /Discount WELCOME25/u);
    await storeEmails.record(receiptEmail, {
      kind: 'accepted',
      id: 'resend_store_receipt_fixture',
    });
    const [receiptState] = await connection`
      select state, provider_id from generated_store_email_outbox where order_id = ${discountedOrder}
    `;
    assert.deepEqual(receiptState, {
      state: 'accepted',
      provider_id: 'resend_store_receipt_fixture',
    });
    const merchantEmails = await stores.merchantEmails(owner.id, site.id, {});
    assert.equal(merchantEmails?.emails[0]?.status, 'accepted');
    assert.equal(merchantEmails?.emails[0]?.recipient, 'discount@example.test');
    assert.equal('body' in (merchantEmails?.emails[0] ?? {}), false);
    await connection`
      insert into generated_store_email_outbox(site_id, order_id, event_key, recipient, subject, body)
      select ${site.id}, ${discountedOrder}, 'history:' || item, 'history@example.test', 'History', 'Private body'
      from generate_series(1, 30) item
    `;
    const emailPageOne = await stores.merchantEmails(owner.id, site.id, {});
    assert.equal(emailPageOne?.emails.length, 25);
    assert.ok(emailPageOne?.next);
    const emailPageTwo = await stores.merchantEmails(
      owner.id,
      site.id,
      emailPageOne!.next!,
    );
    assert.equal(emailPageTwo?.emails.length, 6);
    assert.equal(emailPageTwo?.next, null);
    assert.equal(
      new Set([
        ...emailPageOne!.emails.map(({ id }) => id),
        ...emailPageTwo!.emails.map(({ id }) => id),
      ]).size,
      31,
    );
    assert.equal(
      emailPageTwo!.emails.some((email) => 'body' in email),
      false,
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.discounts.find(
        ({ code }) => code === 'WELCOME25',
      )?.usedCount,
      1,
    );
    assert.equal(
      await stores.request(site.id, {
        id: randomUUID(),
        email: 'second-discount@example.test',
        discountCode: 'WELCOME25',
        items: [
          {
            productId: discountedProduct.id,
            revision: discountedProduct.revision,
            quantity: 1,
          },
        ],
      }),
      false,
    );
    assert.equal(
      await stores.saveDiscount(owner.id, site.id, {
        code: 'WELCOME25',
        percentOff: 20,
        active: true,
        maxUses: 1,
        expiresAt: null,
        revision: 1,
      }),
      false,
    );
    assert.equal(
      await stores.saveDiscount(owner.id, site.id, {
        code: 'WELCOME25',
        percentOff: 20,
        active: true,
        maxUses: 1,
        expiresAt: '2035-01-01T00:00:00.000Z',
        revision: 2,
      }),
      true,
    );
    assert.ok(
      await stores.saveDiscount(owner.id, site.id, {
        code: 'EXPIRED20',
        percentOff: 20,
        active: true,
        maxUses: null,
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    assert.equal(
      await stores.request(site.id, {
        id: randomUUID(),
        email: 'expired-discount@example.test',
        discountCode: 'EXPIRED20',
        items: [
          {
            productId: discountedProduct.id,
            revision: discountedProduct.revision,
            quantity: 1,
          },
        ],
      }),
      false,
    );
    assert.ok(await stores.setPaymentMode(owner.id, site.id, 'live'));
    assert.ok(await stores.setCheckout(owner.id, site.id, true));
    const staleModeProduct = (await stores.read(owner.id, site.id))
      ?.products[0];
    assert.ok(staleModeProduct);
    assert.equal(
      await stores.request(
        site.id,
        {
          id: randomUUID(),
          email: 'stale-mode-buyer@example.test',
          items: [
            {
              productId: staleModeProduct.id,
              revision: staleModeProduct.revision,
              quantity: 1,
            },
          ],
        },
        true,
        'test',
      ),
      false,
    );
    assert.ok(await stores.setCheckout(owner.id, site.id, false));
    const liveRequest = randomUUID();
    const liveProduct = (await stores.read(owner.id, site.id))?.products[0];
    assert.ok(liveProduct);
    assert.ok(
      await stores.request(site.id, {
        id: liveRequest,
        email: 'live-buyer@example.test',
        items: [
          {
            productId: liveProduct.id,
            revision: liveProduct.revision,
            quantity: 1,
          },
        ],
      }),
    );
    assert.ok(
      await stores.changeOrder(owner.id, site.id, liveRequest, 'confirmed'),
    );
    const liveSaleId = await stores.createPayment(
      owner.id,
      site.id,
      liveRequest,
    );
    assert.ok(liveSaleId);
    const [liveSale] = await connection`
      select mode from stripe_sales where id = ${liveSaleId}
    `;
    assert.equal(liveSale?.mode, 'live');
    assert.ok(
      await liveConnect.closeStoreCheckout(owner.id, site.id, liveRequest),
    );
    assert.ok(
      await stores.changeOrder(owner.id, site.id, liveRequest, 'cancelled'),
    );
    assert.ok(await stores.setPaymentMode(owner.id, site.id, 'test'));
    storeFixture = true;
    async function reserveOrder(withDelivery = false) {
      const dashboard = await stores.read(owner!.id, site!.id);
      const products = dashboard?.products;
      assert.equal(products?.length, 2);
      const input = {
        id: randomUUID(),
        items: products!.map(({ id, revision, name }) => ({
          productId: id,
          revision,
          quantity: name === 'Kettle' ? 1 : 2,
        })),
        email: 'merchant-order@example.test',
      };
      let id = input.id;
      if (withDelivery) {
        const prepared = await stores.prepareDelivery(
          site!.id,
          input,
          {
            country: 'AU',
            name: 'Fixture Buyer',
            street: '123 Test Street',
            city: 'Perth',
            region: 'WA',
            postalCode: '6000',
            unit: '',
          },
          null,
        );
        assert.equal(prepared?.delivery.shipping, 250);
        assert.equal(prepared?.delivery.tax, 925);
        assert.ok(prepared);
        const saved = await stores.placeDelivery(site!.id, prepared.id, null);
        assert.ok(saved);
        id = saved;
        assert.ok(await stores.setDelivery(owner!.id, site!.id, 1, []));
      } else {
        assert.ok(await stores.request(site!.id, input));
      }
      assert.equal(await stores.createPayment(owner!.id, site!.id, id), null);
      assert.ok(await stores.changeOrder(owner!.id, site!.id, id, 'confirmed'));
      const [a, b] = await Promise.all([
        stores.createPayment(owner!.id, site!.id, id),
        stores.createPayment(owner!.id, site!.id, id),
      ]);
      assert.ok(a);
      assert.equal(a, b);
      assert.notEqual(id, a);
      assert.equal(
        (await connect.publicOrder(a))?.amount,
        withDelivery ? 10175 : 9000,
      );
      assert.equal(await stores.createPayment(other!.id, site!.id, id), null);
      return { id, saleId: a };
    }

    const abandoned = await reserveOrder();
    checkoutOrder = {
      id: abandoned.saleId,
      title: 'Filters and 1 more',
      currency: 'aud',
      amount: 9000,
    };
    capturedAmount = 9000;
    session = 'cs_test_Abandoned';
    failCheckoutCreation = true;
    await assert.rejects(
      connect.checkout(abandoned.saleId),
      /Stripe could not complete/,
    );
    assert.equal(
      await connect.closeStoreCheckout(owner.id, site.id, abandoned.id),
      false,
    );
    assert.equal(
      await stores.changeOrder(owner.id, site.id, abandoned.id, 'cancelled'),
      false,
    );
    assert.equal(await connect.checkout(abandoned.saleId), link);
    assert.equal(
      await connect.closeStoreCheckout(other.id, site.id, abandoned.id),
      false,
    );
    assert.equal(
      await connect.closeStoreCheckout(owner.id, site.id, abandoned.id),
      true,
    );
    assert.equal(await connect.checkout(abandoned.saleId), null);
    assert.equal(await connect.publicOrder(abandoned.saleId), null);
    assert.ok(
      await stores.changeOrder(owner.id, site.id, abandoned.id, 'cancelled'),
    );

    const purchase = await reserveOrder();
    checkoutOrder = { ...checkoutOrder, id: purchase.saleId };
    paymentIntent = 'pi_GeneratedStore';
    session = 'cs_test_GeneratedStore';
    assert.equal(await connect.checkout(purchase.saleId), link);
    assert.equal(
      await stores.changeOrder(owner.id, site.id, purchase.id, 'fulfilled'),
      false,
    );
    checkoutStatus = 'complete';
    assert.equal(
      await connect.closeStoreCheckout(owner.id, site.id, purchase.id),
      false,
    );
    capturedAmount = 8999;
    assert.equal(
      (await webhook(64, 'checkout.session.completed', session)).statusCode,
      204,
    );
    assert.equal(
      await stores.changeOrder(owner.id, site.id, purchase.id, 'fulfilled'),
      false,
    );
    capturedAmount = 9000;
    assert.equal(
      (await webhook(65, 'checkout.session.completed', session)).statusCode,
      204,
    );
    assert.equal(
      (await webhook(65, 'checkout.session.completed', session)).statusCode,
      204,
    );
    const paid = (await stores.read(owner.id, site.id))?.orders.find(
      (value) => value.id === purchase.id,
    );
    assert.equal(paid?.payment, 'paid');
    assert.equal(
      await stores.changeOrder(owner.id, site.id, purchase.id, 'cancelled'),
      false,
    );
    refund = 9000;
    assert.equal(
      (await webhook(66, 'charge.refunded', 'ch_Sale')).statusCode,
      204,
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.orders.find(
        (value) => value.id === purchase.id,
      )?.payment,
      'refunded',
    );
    assert.equal(
      await stores.changeOrder(owner.id, site.id, purchase.id, 'fulfilled'),
      false,
    );
    assert.ok(
      await stores.changeOrder(owner.id, site.id, purchase.id, 'cancelled'),
    );
    assert.deepEqual(
      (await stores.read(owner.id, site.id))?.products.map(
        (product) => product.stock,
      ),
      [2, 2],
    );
    assert.ok(
      await stores.setDelivery(owner.id, site.id, 0, [
        {
          country: 'AU',
          shipping: 250,
          taxRate: 1000,
          freeAbove: null,
          taxShipping: true,
        },
      ]),
    );
    const shipped = await reserveOrder(true);
    checkoutOrder = { ...checkoutOrder, id: shipped.saleId, amount: 10175 };
    capturedAmount = 10175;
    paymentIntent = 'pi_GeneratedStoreShipped';
    session = 'cs_test_GeneratedStoreShipped';
    assert.equal(await connect.checkout(shipped.saleId), link);
    checkoutStatus = 'complete';
    assert.equal(
      (await webhook(67, 'checkout.session.completed', session)).statusCode,
      204,
    );
    assert.ok(
      await stores.changeOrder(owner.id, site.id, shipped.id, 'fulfilled'),
    );
    assert.equal(
      await stores.changeOrder(owner.id, site.id, shipped.id, 'cancelled'),
      false,
    );
    assert.deepEqual(
      (await stores.read(owner.id, site.id))?.products.map(
        (product) => product.stock,
      ),
      [0, 1],
    );
    const [buildAccount] = await db
      .insert(accounts)
      .values({ email: 'store-builder@example.test' })
      .returning();
    assert.ok(buildAccount);
    const [buildTurn] = await db
      .insert(agentTurns)
      .values({
        businessId: owner.id,
        creatorId: buildAccount.id,
        prompt: 'Build the test shop.',
        state: 'completed',
      })
      .returning();
    assert.ok(buildTurn);
    await db
      .update(websiteVersions)
      .set({ turnId: buildTurn.id })
      .where(eq(websiteVersions.artifactId, site.id));
    await db.insert(creditEntries).values([
      {
        accountId: buildAccount.id,
        turnId: buildTurn.id,
        operationKey: 'store-model',
        kind: 'model',
        amount: '-0.1500000000',
      },
      {
        accountId: buildAccount.id,
        turnId: buildTurn.id,
        operationKey: 'store-tool',
        kind: 'tool',
        amount: '-0.0500000000',
      },
    ]);
    await connection`insert into media_jobs
      (id, business_id, account_id, site_id, kind, prompt, credits, state) values
      (${randomUUID()}, ${owner.id}, ${buildAccount.id}, ${site.id}, 'image', 'product photo', 4, 'completed'),
      (${randomUUID()}, ${owner.id}, ${buildAccount.id}, ${site.id}, 'video', 'failed ad', 6, 'failed')`;
    const report = await stores.merchantReport(owner.id, site.id, {
      from: day,
      through: day,
    });
    assert.deepEqual(report, {
      currency: 'AUD',
      mode: 'test',
      usage: {
        products: 2,
        variants: 0,
        photoCount: 1,
        photoBytes: '68',
        modelCredits: '0.1500000000',
        toolCredits: '0.0500000000',
        totalCredits: '0.2000000000',
        mediaJobs: 1,
        mediaCredits: '4.0000000000',
      },
      days: [
        {
          day,
          requests: 5,
          cancelled: 3,
          paidOrders: 2,
          gross: '19175',
          refunds: '9000',
        },
      ],
    });

    assert.ok(
      await stores.setDelivery(owner.id, site.id, 2, [
        {
          country: 'AU',
          shipping: 250,
          taxRate: 1000,
          freeAbove: null,
          taxShipping: true,
        },
      ]),
    );
    assert.ok(
      await stores.saveDiscount(owner.id, site.id, {
        code: 'STORE10',
        percentOff: 10,
        active: true,
        maxUses: null,
        expiresAt: null,
      }),
    );
    const storefront = Fastify();
    t.after(() => storefront.close());
    const shopHost = site.id + '.shops.example.test';
    registerStorefront(
      storefront,
      stores,
      (hostname) => (hostname === shopHost ? site.id : null),
      () => 'https://' + shopHost,
      async () => {},
      undefined,
      connect,
    );
    const headers = {
      host: shopHost,
      origin: 'https://' + shopHost,
      'content-type': 'application/x-www-form-urlencoded',
    };
    const catalog = () =>
      storefront.inject({ method: 'GET', url: '/store/catalog', headers });
    assert.doesNotMatch((await catalog()).body, /name="pay"/u);
    assert.equal(await stores.setCheckout(other.id, site.id, true), false);
    assert.equal(await stores.setCheckout(owner.id, site.id, true), true);
    assert.match((await catalog()).body, /name="pay" value="stripe"/u);
    const product = (await stores.read(owner.id, site.id))!.products.find(
      ({ stock }) => stock > 0,
    )!;
    const cart = {
      id: randomUUID(),
      [`cart:${product.id}:${product.revision}`]: '1',
      email: 'direct-buyer@example.test',
      discountCode: 'store10',
      pay: 'stripe',
      paymentMode: 'test',
      country: 'AU',
      name: 'Fixture Buyer',
      street: '123 Test Street',
      city: 'Perth',
      region: 'WA',
      postalCode: '6000',
      unit: '',
    };
    const post = (url: string, fields: Record<string, string>) =>
      storefront.inject({
        method: 'POST',
        url,
        headers,
        payload: new URLSearchParams(fields).toString(),
      });
    const review = await post('/store/review', cart);
    assert.equal(review.statusCode, 200, review.body);
    assert.match(review.body, /Continue to Stripe/u);
    assert.match(review.body, /Discount \(STORE10\)/u);
    const discountAmount = Math.floor(product.price / 10);
    const discountedSubtotal = product.price - discountAmount;
    const amount =
      discountedSubtotal + 250 + Math.round((discountedSubtotal + 250) / 10);
    assert.ok(review.body.includes(`−A$${(discountAmount / 100).toFixed(2)}`));
    const quote = review.body.match(/name="quote" value="([^"]+)"/u)?.[1];
    assert.ok(quote);
    const payment = {
      quote,
      pay: 'stripe',
      paymentMode: 'test',
      discountCode: 'STORE10',
    };
    const rival = await post('/store/review', cart);
    const rivalQuote = rival.body.match(/name="quote" value="([^"]+)"/u)?.[1];
    assert.ok(rivalQuote);
    directFixture = true;
    session = 'cs_test_DirectStore';
    checkoutOrder = { ...checkoutOrder, amount };
    capturedAmount = amount;
    failCheckoutCreation = true;
    const blocked = await post('/store/orders', payment);
    assert.equal(blocked.statusCode, 503);
    assert.match(blocked.body, /Retry Stripe checkout/u);
    assert.match(blocked.body, /name="paymentMode" value="test"/u);
    assert.equal(
      (await stores.read(owner.id, site.id))?.products.find(
        ({ id }) => id === product.id,
      )?.stock,
      0,
    );
    const conflicting = await post('/store/orders', {
      quote: rivalQuote,
      pay: 'stripe',
      paymentMode: 'test',
    });
    assert.equal(conflicting.statusCode, 409);
    const before = submissions;
    const [redirect, retry] = await Promise.all([
      post('/store/orders', payment),
      post('/store/orders', payment),
    ]);
    assert.equal(redirect.statusCode, 303);
    assert.equal(redirect.headers.location, link);
    assert.equal(retry.headers.location, link);
    assert.equal(submissions, before + 1);
    assert.equal(
      (await stores.buyerSale(site.id, quote))?.id,
      checkoutOrder.id,
    );

    checkoutStatus = 'expired';
    capturedAmount++;
    assert.equal(
      (await webhook(68, 'checkout.session.expired', session)).statusCode,
      204,
    );
    assert.equal(
      (await stores.buyerSale(site.id, quote))?.id,
      checkoutOrder.id,
    );
    capturedAmount = amount;
    assert.equal(
      (await webhook(69, 'checkout.session.expired', session)).statusCode,
      204,
    );
    assert.equal(
      (await webhook(70, 'checkout.session.expired', session)).statusCode,
      204,
    );
    assert.equal(await stores.buyerSale(site.id, quote), undefined);
    const expired = await stores.read(owner.id, site.id);
    assert.equal(
      expired?.orders.find(({ id }) => id === quote)?.status,
      'cancelled',
    );
    const cancellationEmail = await connection`
      select state, recipient, body from generated_store_email_outbox
      where site_id = ${site.id} and order_id = ${quote} and event_key = 'cancelled'
    `;
    assert.deepEqual(cancellationEmail[0], {
      state: 'queued',
      recipient: 'direct-buyer@example.test',
      body: `Your order ${quote} could not be confirmed and has been cancelled. Any held stock has been released.`,
    });
    assert.equal(
      expired?.products.find(({ id }) => id === product.id)?.stock,
      1,
    );
    assert.equal(await connect.checkout(checkoutOrder.id), null);
    const updatedProduct = expired!.products.find(
      ({ id }) => id === product.id,
    )!;
    const paidReview = await post('/store/review', {
      ...cart,
      [`cart:${product.id}:${product.revision}`]: '0',
      [`cart:${product.id}:${updatedProduct.revision}`]: '1',
    });
    const paidQuote = paidReview.body.match(
      /name="quote" value="([^"]+)"/u,
    )?.[1];
    assert.ok(paidQuote, paidReview.body);
    session = 'cs_test_DirectPaid';
    paymentIntent = 'pi_DirectPaid';
    assert.equal(
      (
        await post('/store/orders', {
          quote: paidQuote,
          pay: 'stripe',
          paymentMode: 'test',
        })
      ).statusCode,
      303,
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.counts?.awaitingFulfillment,
      0,
    );
    checkoutStatus = 'complete';
    assert.equal(
      (await webhook(71, 'checkout.session.completed', session)).statusCode,
      204,
    );
    assert.equal(
      (await webhook(71, 'checkout.session.completed', session)).statusCode,
      204,
    );
    assert.ok((await stores.buyerSale(site.id, paidQuote))?.paid);
    assert.equal(
      (
        await connection`
          select count(*)::int as count from generated_store_activity
          where site_id = ${site.id} and kind = 'payment.received'
            and summary = ${'Payment received for order ' + paidQuote.slice(0, 8)}
        `
      )[0]?.count,
      1,
    );
    refund = 250;
    assert.equal(
      (await webhook(72, 'charge.refunded', 'ch_Sale')).statusCode,
      204,
    );
    assert.equal(
      (await webhook(72, 'charge.refunded', 'ch_Sale')).statusCode,
      204,
    );
    assert.equal(
      (
        await connection`
          select count(*)::int as count from generated_store_activity
          where site_id = ${site.id} and kind = 'payment.refund'
            and summary = ${'Refund recorded for order ' + paidQuote.slice(0, 8)}
        `
      )[0]?.count,
      1,
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.counts?.awaitingFulfillment,
      1,
    );
    assert.ok(
      await stores.changeOrder(owner.id, site.id, paidQuote, 'fulfilled', {
        carrier: 'Parcel Post',
        number: 'PKG-123',
        url: 'https://track.example.test/PKG-123',
      }),
    );
    const fulfilledOrder = (await stores.read(owner.id, site.id))?.orders.find(
      (order) => order.id === paidQuote,
    );
    assert.deepEqual(fulfilledOrder?.tracking, {
      carrier: 'Parcel Post',
      number: 'PKG-123',
      url: 'https://track.example.test/PKG-123',
    });
    assert.ok(
      await stores.changeOrder(owner.id, site.id, paidQuote, 'fulfilled', {
        carrier: 'Parcel Post',
        number: 'PKG-124',
        url: 'https://track.example.test/PKG-124',
      }),
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.orders.find(
        (order) => order.id === paidQuote,
      )?.tracking?.number,
      'PKG-124',
    );
    const fulfillmentEmails = await connection`
      select event_key from generated_store_email_outbox where order_id = ${paidQuote} order by event_key
    `;
    assert.deepEqual(
      fulfillmentEmails.map(({ event_key }) => event_key),
      [
        'order_received',
        'tracking:Parcel Post:PKG-123:https://track.example.test/PKG-123',
        'tracking:Parcel Post:PKG-124:https://track.example.test/PKG-124',
      ],
    );

    assert.ok(
      await stores.saveProduct(owner.id, site.id, {
        name: 'Recovery fixture',
        description: '',
        price: 1200,
        stock: 2,
        active: true,
      }),
    );
    const recoveryProduct = (await stores.read(
      owner.id,
      site.id,
    ))!.products.find(({ name }) => name === 'Recovery fixture')!;
    const recoveryOrder = (
      id: string,
      revision = recoveryProduct.revision,
    ) => ({
      id,
      email: 'recovery@example.test',
      items: [{ productId: recoveryProduct.id, revision, quantity: 1 }],
    });
    async function placeDirectFixture(input: ReturnType<typeof recoveryOrder>) {
      const currentProduct = (await stores.read(
        owner.id,
        site.id,
      ))!.products.find(({ id }) => id === recoveryProduct.id)!;
      const currentInput = {
        ...input,
        items: input.items.map((item) => ({
          ...item,
          revision: currentProduct.revision,
        })),
      };
      const review = await stores.prepareDelivery(
        site.id,
        currentInput,
        {
          country: 'AU',
          name: 'Fixture Buyer',
          street: '123 Test Street',
          unit: '',
          city: 'Perth',
          region: 'WA',
          postalCode: '6000',
        },
        null,
      );
      assert.ok(review);
      const id = await stores.placeDelivery(site.id, review.id, null, true);
      assert.ok(id);
      return id;
    }
    const uncertainId = await placeDirectFixture(recoveryOrder(randomUUID()));
    const uncertainSale = (await stores.buyerSale(site.id, uncertainId))!.id;
    checkoutOrder = {
      id: uncertainSale,
      title: 'Recovery fixture',
      amount: 1595,
      currency: 'aud',
    };
    session = 'cs_test_LostResponse';
    loseCheckoutResponse = true;
    await assert.rejects(connect.checkout(uncertainSale));
    await connection`update stripe_sales set checkout_recover_at = now() where id = ${uncertainSale}`;
    checkoutStatus = 'open';
    capturedAmount = checkoutOrder.amount;
    assert.deepEqual(await connect.recoverStoreCheckouts(), {
      checked: 1,
      resolved: 1,
      failed: 0,
      errors: [],
    });
    assert.equal(
      (await stores.read(owner.id, site.id))?.orders.find(
        ({ id }) => id === uncertainId,
      )?.status,
      'cancelled',
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.products.find(
        ({ id }) => id === recoveryProduct.id,
      )?.stock,
      2,
    );

    const absentId = await placeDirectFixture(recoveryOrder(randomUUID()));
    const absentSale = (await stores.buyerSale(site.id, absentId))!.id;
    checkoutOrder = {
      id: absentSale,
      title: 'Recovery fixture',
      amount: 1595,
      currency: 'aud',
    };
    failCheckoutCreation = true;
    await assert.rejects(connect.checkout(absentSale));
    listedSessions = false;
    await connection`update stripe_sales set checkout_recover_at = now(), checkout_hold_until = now() where id = ${absentSale}`;
    assert.deepEqual(await connect.recoverStoreCheckouts(), {
      checked: 1,
      resolved: 1,
      failed: 0,
      errors: [],
    });
    assert.equal(
      (await stores.read(owner.id, site.id))?.orders.find(
        ({ id }) => id === absentId,
      )?.status,
      'cancelled',
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.products.find(
        ({ id }) => id === recoveryProduct.id,
      )?.stock,
      2,
    );
    listedSessions = true;

    const missedEventId = randomUUID();
    const refreshedProduct = (await stores.read(
      owner.id,
      site.id,
    ))!.products.find(({ id }) => id === recoveryProduct.id)!;
    const missedOrderId = await placeDirectFixture(
      recoveryOrder(missedEventId, refreshedProduct.revision),
    );
    const missedSale = (await stores.buyerSale(site.id, missedOrderId))!.id;
    checkoutOrder = {
      id: missedSale,
      title: 'Recovery fixture',
      amount: 1595,
      currency: 'aud',
    };
    session = 'cs_test_MissedWebhook';
    capturedAmount = checkoutOrder.amount;
    paymentIntent = 'pi_DirectRecovered';
    assert.ok(await connect.checkout(missedSale));
    checkoutStatus = 'complete';
    await connection`update stripe_sales set checkout_recover_at = now() where id = ${missedSale}`;
    assert.deepEqual(await connect.recoverStoreCheckouts(), {
      checked: 1,
      resolved: 1,
      failed: 0,
      errors: [],
    });
    assert.ok((await stores.buyerSale(site.id, missedOrderId))?.paid);
    assert.equal(
      (await stores.read(owner.id, site.id))?.counts?.awaitingFulfillment,
      1,
    );
    assert.ok(
      await stores.changeOrder(owner.id, site.id, missedOrderId, 'fulfilled'),
    );
    const currentStore = await stores.read(owner.id, site.id);
    assert.ok(currentStore);
    assert.equal(
      await stores.setDelivery(
        owner.id,
        site.id,
        currentStore.deliveryRevision,
        [],
      ),
      true,
    );
    assert.equal(await stores.setCheckout(owner.id, site.id, true), true);
    assert.ok(
      await stores.saveProduct(owner.id, site.id, {
        name: 'Single stock concurrency probe',
        description: '',
        price: 500,
        stock: 1,
        active: true,
      }),
    );
    const oneUnit = (await stores.read(owner.id, site.id))?.products.find(
      ({ name }) => name === 'Single stock concurrency probe',
    );
    assert.ok(oneUnit);
    const submitOneUnit = () =>
      stores.request(
        site.id,
        {
          id: randomUUID(),
          email: 'concurrent-buyer@example.test',
          items: [
            {
              productId: oneUnit.id,
              revision: oneUnit.revision,
              quantity: 1,
            },
          ],
        },
        true,
        'test',
      );
    assert.deepEqual(
      (await Promise.all([submitOneUnit(), submitOneUnit()])).sort(),
      [false, true],
    );
    assert.equal(
      (await stores.read(owner.id, site.id))?.products.find(
        ({ id }) => id === oneUnit.id,
      )?.stock,
      0,
    );
    const [oneUnitOrders] = await connection`
      select count(distinct orders.id)::int as count
      from generated_store_orders orders
      join generated_store_order_lines lines on lines.site_id = orders.site_id and lines.order_id = orders.id
      where orders.site_id = ${site.id} and lines.product_id = ${oneUnit.id}
        and orders.status = 'confirmed'
    `;
    assert.equal(oneUnitOrders?.count, 1);
    assert.equal(await stores.setCheckout(owner.id, site.id, false), true);
    assert.doesNotMatch((await catalog()).body, /name="pay"/u);
  },
);
