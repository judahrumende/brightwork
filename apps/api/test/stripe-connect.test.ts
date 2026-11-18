import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { businesses } from '../src/db/schema';
import { commerceInsights } from '../src/workspace/commerce-insights';
import { stripeConnect } from '../src/workspace/stripe-connect';

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
    const [owner, other] = await db
      .insert(businesses)
      .values([{ name: 'Stripe fixture' }, { name: 'Separate business' }])
      .returning();
    assert.ok(owner && other);

    const accountId = 'acct_Fixture';
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
        assert.equal(headers.get('stripe-account'), accountId);
        if (failures) {
          failures--;
          return new Response('temporary provider outage', { status: 503 });
        }
        if (path === '/v1/charges/ch_Sale')
          return Response.json({
            id: 'ch_Sale',
            livemode: false,
            payment_intent: 'pi_Sale',
            paid: true,
            amount: order.amount,
            amount_refunded: refund,
            currency: order.currency,
            metadata: { brightwork_order: order.id },
          });
        const creating = path === '/v1/checkout/sessions';
        if (creating) {
          submissions++;
          if (submissions === 2) {
            assert.equal(
              headers.get('idempotency-key'),
              'brightwork-sale-' + order.id + '-cs_test_Sale',
            );
            session = 'cs_test_Replacement';
          }
          checkoutStatus = 'open';
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
          client_reference_id: order.id,
          payment_intent: complete ? 'pi_Sale' : null,
          customer_details: complete ? { email: 'Buyer@example.test' } : null,
          amount_total: creating ? order.amount : capturedAmount,
          currency: order.currency,
          url: link,
        });
      },
    );
    connect.register(app);
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
    refund = 1999;
    await webhook(6, 'charge.refunded', 'ch_Sale');
    assert.equal((await connect.publicOrder(order.id))?.amountRefunded, 1999);
    assert.deepEqual((await connect.overview(other.id)).orders, []);
    const day = new Date().toISOString().slice(0, 10);
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
  },
);
