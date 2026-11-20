import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { BuyerAccess } from '../src/workspace/store-buyer-routes';
import { registerBuyerRoutes } from '../src/workspace/store-buyer-routes';

test('buyer order history shows partial refund and net paid for verified email', async (t) => {
  const app = Fastify();
  t.after(async () => app.close());
  const site = randomUUID();
  const orderId = randomUUID();
  const liveOrderId = randomUUID();
  const liveSaleId = randomUUID();
  const email = 'buyer@example.test';
  const session = 'a'.repeat(43);
  const orderLookups: [string, string][] = [];
  const sessionRevocations: [string, string][] = [];
  let revoked = false;
  const access: BuyerAccess = {
    buyers: {
      buyer: async (siteId, token) =>
        token === session && siteId === site && !revoked ? email : null,
      orders: async (siteId, buyerEmail) => {
        orderLookups.push([siteId, buyerEmail]);
        return [
          {
            id: orderId,
            email,
            items: [
              {
                productId: randomUUID(),
                productName: 'Copper kettle',
                unitPrice: 4500,
                quantity: 1,
              },
            ],
            delivery: null,
            discount: { code: 'WELCOME10', amount: 450 },
            tracking: {
              carrier: 'Parcel & Co',
              number: 'PKG-123',
              url: 'https://track.example.test/PKG-123?source=store&lang=en',
            },
            currency: 'AUD',
            status: 'fulfilled',
            saleId: randomUUID(),
            paymentMode: 'test',
            amountRefunded: 125,
            payment: 'partially_refunded',
            createdAt: new Date().toISOString(),
          },
          {
            id: liveOrderId,
            email,
            items: [
              {
                productId: randomUUID(),
                productName: 'Tea set',
                unitPrice: 2500,
                quantity: 1,
              },
            ],
            delivery: null,
            tracking: null,
            currency: 'AUD',
            status: 'confirmed',
            saleId: liveSaleId,
            paymentMode: 'live',
            amountRefunded: 0,
            payment: 'awaiting_payment',
            createdAt: new Date().toISOString(),
          },
        ];
      },
      signOutAll: async (siteId, buyerEmail) => {
        sessionRevocations.push([siteId, buyerEmail]);
        revoked = true;
      },
    } as unknown as BuyerAccess['buyers'],
    sendCode: async () => {},
    limit: async () => {},
    paymentOrigin: 'https://pay.example.test',
  };
  registerBuyerRoutes(
    app,
    access,
    (host) => (host === 'shop.example.test' ? site : null),
    () => 'https://shop.example.test',
    async (siteId) => siteId === site,
  );
  await app.ready();

  const anonymous = await app.inject({
    url: '/store/account',
    headers: { host: 'shop.example.test' },
  });
  assert.equal(anonymous.statusCode, 200);
  assert.match(anonymous.body, /Email me a code/u);
  assert.doesNotMatch(anonymous.body, new RegExp(orderId, 'u'));
  assert.deepEqual(orderLookups, []);

  const history = await app.inject({
    url: '/store/account',
    headers: {
      host: 'shop.example.test',
      cookie: `__Host-bw-buyer=${session}`,
    },
  });
  assert.equal(history.statusCode, 200);
  assert.match(history.body, /Partially refunded/u);
  assert.match(history.body, /Refunded .*1\.25/u);
  assert.match(history.body, /Net paid .*39\.25/u);
  assert.match(history.body, /Discount WELCOME10 · −A\$4\.50/u);
  assert.match(history.body, /Parcel &amp; Co · PKG-123/u);
  assert.match(
    history.body,
    /href="https:\/\/track\.example\.test\/PKG-123\?source=store&amp;lang=en" target="_blank" rel="noreferrer">Track package/u,
  );
  assert.match(history.body, /Open payment link/u);
  assert.doesNotMatch(history.body, /Open test payment link/u);
  assert.match(
    history.body,
    new RegExp('https://pay\\.example\\.test/sale/' + liveSaleId, 'u'),
  );
  assert.match(history.body, new RegExp(orderId, 'u'));
  assert.match(history.body, new RegExp(liveOrderId, 'u'));
  assert.deepEqual(orderLookups, [[site, email]]);

  const signedOutEverywhere = await app.inject({
    method: 'POST',
    url: '/store/account/sign-out-all',
    headers: {
      host: 'shop.example.test',
      origin: 'https://shop.example.test',
      cookie: `__Host-bw-buyer=${session}`,
    },
  });
  assert.equal(signedOutEverywhere.statusCode, 303);
  assert.deepEqual(sessionRevocations, [[site, email]]);
  const revokedHistory = await app.inject({
    url: '/store/account',
    headers: {
      host: 'shop.example.test',
      cookie: `__Host-bw-buyer=${session}`,
    },
  });
  assert.match(revokedHistory.body, /Email me a code/u);
  assert.doesNotMatch(revokedHistory.body, new RegExp(orderId, 'u'));
  assert.deepEqual(orderLookups, [[site, email]]);

  const sibling = await app.inject({
    url: '/store/account',
    headers: {
      host: 'other.example.test',
      cookie: `__Host-bw-buyer=${session}`,
    },
  });
  assert.equal(sibling.statusCode, 404);
  assert.deepEqual(orderLookups, [[site, email]]);
});

test('buyer order history uses a stable twenty-order cursor', async (t) => {
  const app = Fastify();
  t.after(async () => app.close());
  const site = randomUUID();
  const email = 'buyer@example.test';
  const session = 'b'.repeat(43);
  const orders = Array.from({ length: 21 }, (_, index) => ({
    id: randomUUID(),
    email,
    items: [
      {
        productId: randomUUID(),
        productName: `Item ${index + 1}`,
        unitPrice: 1000,
        quantity: 1,
      },
    ],
    delivery: null,
    tracking: null,
    currency: 'AUD' as const,
    status: 'fulfilled' as const,
    saleId: null,
    paymentMode: null,
    amountRefunded: 0,
    payment: null,
    createdAt: new Date(Date.UTC(2026, 0, 21 - index)).toISOString(),
  }));
  const cursors: (string | undefined)[] = [];
  const access: BuyerAccess = {
    buyers: {
      buyer: async (siteId, token) =>
        siteId === site && token === session ? email : null,
      orders: async (_siteId, _email, before) => {
        cursors.push(before?.id);
        const index = before
          ? orders.findIndex((order) => order.id === before.id) + 1
          : 0;
        return orders.slice(index, index + 21);
      },
    } as unknown as BuyerAccess['buyers'],
    sendCode: async () => {},
    limit: async () => {},
    paymentOrigin: 'https://pay.example.test',
  };
  registerBuyerRoutes(
    app,
    access,
    (host) => (host === 'shop.example.test' ? site : null),
    () => 'https://shop.example.test',
    async (siteId) => siteId === site,
  );
  await app.ready();
  const headers = {
    host: 'shop.example.test',
    cookie: `__Host-bw-buyer=${session}`,
  };
  const first = await app.inject({ url: '/store/account', headers });
  assert.equal(first.statusCode, 200);
  assert.match(first.body, new RegExp(orders[0]!.id, 'u'));
  assert.match(first.body, new RegExp(orders[19]!.id, 'u'));
  assert.doesNotMatch(first.body, new RegExp(orders[20]!.id, 'u'));
  const link = /href="\/store\/account\?([^"]+)"/u.exec(first.body)?.[1];
  assert.ok(link);
  const cursor = new URLSearchParams(link.replaceAll('&amp;', '&'));
  const second = await app.inject({
    url: '/store/account?' + cursor.toString(),
    headers,
  });
  assert.equal(second.statusCode, 200);
  assert.match(second.body, new RegExp(orders[20]!.id, 'u'));
  assert.doesNotMatch(second.body, new RegExp(orders[0]!.id, 'u'));
  assert.deepEqual(cursors, [undefined, orders[19]!.id]);
});
