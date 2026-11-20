import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerStorefront } from '../src/workspace/storefront';

test('checkout remains bound to the store payment mode shown to the shopper', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let paymentMode: 'test' | 'live' = 'test';
  let availableModes: ('test' | 'live')[] = ['test', 'live'];
  const events: string[] = [];
  const stores = {
    catalog: async () => {
      events.push('catalog');
      return {
        title: 'Mode-aware shop',
        currency: 'AUD',
        zones: [],
        directCheckout: true,
        get paymentMode() {
          return paymentMode;
        },
        products: [],
      };
    },
    request: async () => {
      throw new Error('Unavailable live mode must not create an order.');
    },
  };
  registerStorefront(
    app,
    stores as never,
    (host) =>
      host === 'shop.example.test'
        ? '00000000-0000-4000-8000-000000000001'
        : null,
    () => 'https://shop.example.test',
    async () => {
      events.push('limit');
    },
    undefined,
    {
      checkout: async () => ({}),
      availableModes: () => availableModes,
    } as never,
  );

  const catalog = () =>
    app.inject({
      url: '/store/catalog',
      headers: { host: 'shop.example.test' },
    });
  const testCatalog = await catalog();
  assert.match(testCatalog.body, /Stripe in test mode/u);
  assert.match(testCatalog.body, /name="paymentMode" value="test"/u);
  paymentMode = 'live';
  const liveCatalog = await catalog();
  assert.match(liveCatalog.body, /pay securely with Stripe/u);
  assert.match(liveCatalog.body, /name="paymentMode" value="live"/u);
  assert.doesNotMatch(liveCatalog.body, /test mode/u);
  const staleForm = await app.inject({
    method: 'POST',
    url: '/store/orders',
    headers: {
      host: 'shop.example.test',
      origin: 'https://shop.example.test',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload:
      'id=00000000-0000-4000-8000-000000000002&pay=stripe&paymentMode=test&cart%3A00000000-0000-4000-8000-000000000003%3A1=1&email=buyer%40example.test',
  });
  assert.equal(staleForm.statusCode, 409);
  assert.deepEqual(events.slice(-2), ['limit', 'catalog']);
  availableModes = ['test'];
  const unavailableLive = await catalog();
  assert.doesNotMatch(unavailableLive.body, /name="pay"/u);
  assert.match(unavailableLive.body, /send one order request/u);
  events.length = 0;
  const rejectedDirectPost = await app.inject({
    method: 'POST',
    url: '/store/orders',
    headers: {
      host: 'shop.example.test',
      origin: 'https://shop.example.test',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload:
      'id=00000000-0000-4000-8000-000000000002&pay=stripe&paymentMode=live&cart%3A00000000-0000-4000-8000-000000000003%3A1=1&email=buyer%40example.test',
  });
  assert.equal(rejectedDirectPost.statusCode, 503);
  assert.deepEqual(events, ['limit', 'catalog']);
});
