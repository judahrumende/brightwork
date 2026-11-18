import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { artifacts, businesses, publications } from '../src/db/schema';
import { generatedStores } from '../src/workspace/generated-store';
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
    let checkoutOrder = order;
    let paymentIntent = 'pi_Sale';
    let storeFixture = false;
    let failCheckoutCreation = false;
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
            payment_intent: paymentIntent,
            paid: true,
            amount: checkoutOrder.amount,
            amount_refunded: refund,
            currency: checkoutOrder.currency,
            metadata: { brightwork_order: checkoutOrder.id },
          });
        const creating = path === '/v1/checkout/sessions';
        if (creating) {
          if (failCheckoutCreation) {
            failCheckoutCreation = false;
            return new Response('temporary provider outage', { status: 503 });
          }
          submissions++;
          if (storeFixture) {
            const fields = new URLSearchParams(String(request?.body));
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
          payment_intent: complete ? paymentIntent : null,
          customer_details: complete ? { email: 'Buyer@example.test' } : null,
          amount_total: creating ? checkoutOrder.amount : capturedAmount,
          currency: checkoutOrder.currency,
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
  },
);
