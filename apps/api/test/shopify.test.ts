import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { businesses } from '../src/db/schema';
import {
  orderQuery,
  shopQuery,
  shopifyOrders,
} from '../src/workspace/shopify-orders';

const url = process.env.TEST_DATABASE_URL;

test(
  'Shopify scopes deliveries and totals to the connected store',
  { skip: !url },
  async () => {
    assert.ok(url);
    const schema = 'brightwork_shopify_' + randomUUID().replaceAll('-', '');
    const admin = postgres(url, { max: 1, connect_timeout: 5 });
    const client = postgres(url, {
      max: 4,
      connect_timeout: 5,
      connection: { search_path: schema },
    });
    const app = Fastify();
    try {
      await admin`create schema ${admin(schema)}`;
      const db = drizzle(client);
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
        migrationsSchema: schema,
      });
      const [first, second] = await db
        .insert(businesses)
        .values([{ name: 'Fixture storefront' }, { name: 'Other storefront' }])
        .returning();
      assert.ok(first && second);
      const shop = 'one.myshopify.com';
      const otherShop = 'two.myshopify.com';
      const token = 'fixture-token-1';
      const secret = 'fixture-secret-1';
      const rotated = 'fixture-secret-2';
      const id = 'gid://shopify/Order/42';
      let retrievals = 0;
      let failed = false;
      let reported = 1;
      const commerce = shopifyOrders(
        db,
        '23'.repeat(32),
        async (url, options) => {
          const target = new URL(String(url));
          assert.equal(target.pathname, '/admin/api/2026-10/graphql.json');
          assert.ok([shop, otherShop].includes(target.hostname));
          assert.equal(
            new Headers(options?.headers).get('X-Shopify-Access-Token'),
            token,
          );
          assert.equal(typeof options?.body, 'string');
          const body = JSON.parse(options?.body as string);
          if (body.query === shopQuery) {
            return Response.json({
              data: { shop: { myshopifyDomain: target.hostname } },
            });
          }
          assert.equal(body.query, orderQuery);
          assert.equal(body.variables.id, id);
          retrievals += 1;
          if (failed) return Response.json({}, { status: 503 });
          return Response.json({
            data: {
              order: {
                id,
                updatedAt: '2026-11-18T00:00:0' + reported + 'Z',
                displayFinancialStatus: reported === 3 ? 'REFUNDED' : 'PAID',
                cancelledAt: null,
                currentTotalPriceSet: {
                  shopMoney: {
                    amount:
                      target.hostname === shop ? String(10 * reported) : '85',
                    currencyCode: 'AUD',
                  },
                },
              },
            },
          });
        },
      );
      commerce.register(app);
      const connected = await commerce.connect(first.id, {
        shop,
        token,
        secret,
      });
      const other = await commerce.connect(second.id, {
        shop: otherShop,
        token,
        secret,
      });
      assert.ok(connected && other);
      assert.equal(
        await commerce.connect(second.id, { shop, token, secret }),
        null,
      );
      assert.equal(await commerce.disconnect(second.id, connected.id), false);

      const payload = JSON.stringify({ admin_graphql_api_id: id });
      function deliver(
        connection: string,
        domain: string,
        eventId: string,
        key = secret,
      ) {
        return app.inject({
          method: 'POST',
          url: '/api/webhooks/shopify/' + connection,
          payload,
          headers: {
            'content-type': 'application/json',
            'x-shopify-shop-domain': domain,
            'x-shopify-topic': 'orders/updated',
            'x-shopify-webhook-id': eventId,
            'x-shopify-hmac-sha256': createHmac('sha256', key)
              .update(payload)
              .digest('base64'),
          },
        });
      }
      assert.equal(
        (await deliver(connected.id, shop, 'event-1', 'wrong')).statusCode,
        401,
      );
      assert.equal(
        (await deliver(connected.id, otherShop, 'event-1')).statusCode,
        401,
      );
      assert.equal(retrievals, 0);
      failed = true;
      assert.equal(
        (await deliver(connected.id, shop, 'event-1')).statusCode,
        503,
      );
      failed = false;
      assert.equal(
        (await deliver(connected.id, shop, 'event-1')).statusCode,
        200,
      );
      assert.equal(
        (await deliver(connected.id, shop, 'event-1')).statusCode,
        200,
      );
      assert.equal(retrievals, 2);
      assert.deepEqual((await commerce.report(first.id)).totals, [
        { shop, currency: 'AUD', orders: 1, orderValue: '10.00000000' },
      ]);
      assert.deepEqual((await commerce.report(second.id)).totals, []);
      assert.equal(
        (await deliver(other.id, otherShop, 'event-1')).statusCode,
        200,
      );
      assert.deepEqual((await commerce.report(second.id)).totals, [
        {
          shop: otherShop,
          currency: 'AUD',
          orders: 1,
          orderValue: '85.00000000',
        },
      ]);

      reported = 2;
      const concurrent = await Promise.all([
        deliver(connected.id, shop, 'event-2'),
        deliver(connected.id, shop, 'event-2'),
      ]);
      assert.deepEqual(
        concurrent.map(({ statusCode }) => statusCode),
        [200, 200],
      );
      reported = 1;
      assert.equal(
        (await deliver(connected.id, shop, 'later-delivery-older-record'))
          .statusCode,
        200,
      );
      assert.deepEqual((await commerce.report(first.id)).totals, [
        { shop, currency: 'AUD', orders: 1, orderValue: '20.00000000' },
      ]);

      assert.equal(await commerce.disconnect(first.id, connected.id), true);
      assert.equal(
        (await deliver(connected.id, shop, 'event-3')).statusCode,
        404,
      );
      assert.deepEqual((await commerce.report(first.id)).shops, [
        { id: connected.id, shop, connected: false },
      ]);
      assert.deepEqual(
        await commerce.connect(first.id, { shop, token, secret: rotated }),
        connected,
      );
      assert.equal(
        (await deliver(connected.id, shop, 'event-3')).statusCode,
        401,
      );
      reported = 3;
      assert.equal(
        (await deliver(connected.id, shop, 'event-3', rotated)).statusCode,
        200,
      );
      assert.deepEqual((await commerce.report(first.id)).totals, []);
      assert.equal((await commerce.report(second.id)).totals[0]?.orders, 1);
    } finally {
      await app.close();
      await client.end();
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    }
  },
);
