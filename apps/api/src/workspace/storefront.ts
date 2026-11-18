import { sendStorePhoto } from './store-product-photo';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderRequest } from './generated-store';
import type { generatedStores } from './generated-store';

export const catalogPath = '/store/catalog';
const orderPath = '/store/orders';
const photoPath = '/store/photos';
const orderBodyLimit = 128 * 1024;
export function storePublicRoute(method: string, route: string) {
  return (
    (method === 'POST' && route === orderPath) ||
    (['GET', 'HEAD'].includes(method) &&
      (route === catalogPath || route === photoPath + '/:product'))
  );
}

const escape = (value: string) =>
  value.replace(/[&<>"']/gu, (char) => {
    return (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        char
      ] ?? char
    );
  });

export function registerStorefront(
  app: FastifyInstance,
  stores: ReturnType<typeof generatedStores>,
  siteId: (hostname: string) => string | null,
  origin: (id: string) => string,
  limitOrder: (key: string) => Promise<void>,
) {
  void app.register((scope, _opts, done) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: orderBodyLimit },
      (_request, body, next) =>
        next(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    scope.addHook('onRequest', (request, reply, next) => {
      if (!siteId(request.hostname)) {
        void reply.code(404).send('Store not found');
        return;
      }
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'same-origin')
        .header(
          'Content-Security-Policy',
          "sandbox allow-forms allow-same-origin; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        );
      next();
    });
    scope.get(photoPath + '/:product', async (request, reply) => {
      const params = z.object({ product: z.uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(404).send();
      return sendStorePhoto(
        reply,
        await stores.photo(siteId(request.hostname)!, params.data.product),
      );
    });
    scope.get(catalogPath, async (request, reply) => {
      const store = await stores.catalog(siteId(request.hostname)!);
      if (!store) return reply.code(404).send('Store not found');
      const price = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: store.currency,
      });
      const groups = new Map<string, Array<(typeof store.products)[number]>>();
      for (const product of store.products) {
        const id = product.parentId ?? product.id;
        const group = groups.get(id) ?? [];
        group.push(product);
        groups.set(id, group);
      }
      const photo = (id: string, alt: string) =>
        `<img src="${photoPath}/${id}" alt="${escape(alt)}" loading="lazy" decoding="async">`;
      const products = [...groups.values()]
        .map((group) => {
          const first = group[0]!;
          const commonPhoto = group.every(
            (product) => product.photoId === first.photoId,
          )
            ? first.photoId
            : null;
          const options = group
            .map(
              (product) => `<div class="option">
          ${product.photoId && !commonPhoto ? photo(product.photoId, product.photoAlt ?? product.name) : ''}
          ${product.parentId ? `<h3>${escape(product.name)}</h3>` : ''}
          <strong>${price.format(product.price / 100)}</strong>
          ${
            product.stock > 0
              ? `<label>Quantity<input type="number" aria-label="Quantity for ${escape(product.parentId ? product.groupName + ' ' + product.name : product.name)}" required name="cart:${product.id}:${product.revision}" value="0" min="0" max="${Math.min(20, product.stock)}"></label>`
              : '<p>Out of stock</p>'
          }
          </div>`,
            )
            .join('');
          return `<article>
          ${commonPhoto ? photo(commonPhoto, first.photoAlt ?? first.groupName) : ''}
          <h2>${escape(first.groupName)}</h2><p>${escape(first.groupDescription)}</p>${options}</article>`;
        })
        .join('');
      const available = store.products.some((product) => product.stock > 0);
      return reply.type('text/html; charset=utf-8')
        .send(`<!doctype html><html lang="en"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(store.title)} catalog</title>
        <style>
          *{box-sizing:border-box}body{margin:0;background:#f8f7f4;color:#282724;font:1rem/1.5 system-ui}
          main{max-width:68rem;margin:auto;padding:clamp(1rem,5vw,4rem)}a{color:#254a3e}h1{font-size:clamp(2rem,6vw,4rem);line-height:1.1}
          section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:1rem}
          .checkout{display:grid;gap:1rem;max-width:28rem}article{padding:1.5rem;background:white;border:1px solid #ddd9d0;border-radius:.75rem;overflow-wrap:anywhere}
          h2,h3{margin:0} img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:#f8f7f4;border-radius:.5rem;margin-bottom:1rem}.option{display:grid;gap:.5rem;margin-top:1rem}.option img{max-width:12rem;margin-bottom:0} form,label{display:grid;gap:.5rem}form{margin-top:1rem;gap:1rem}
          input,button{font:inherit;padding:.5rem .75rem;width:100%;border-radius:.375rem;border:1px solid #88867e}button{background:#254a3e;color:white;cursor:pointer}
        </style>
        <main><a href="/">← ${escape(store.title)}</a><h1>Shop</h1><p>Choose quantities and send one order request for the store to confirm.</p>
        <form method="post" action="${orderPath}">
          <input type="hidden" name="id" value="${randomUUID()}">
          <section aria-label="Products">${products || '<p>Products will appear here when they are available.</p>'}</section>
          ${
            available
              ? `<div class="checkout"><label>Email for your order <input type="email" required name="email" maxlength="254" autocomplete="email"></label>
          <button>Request order</button></div>`
              : ''
          }
        </form></main></html>`);
    });
    scope.post(
      orderPath,
      { bodyLimit: orderBodyLimit },
      async (request, reply) => {
        const id = siteId(request.hostname)!;
        if (request.headers.origin !== origin(id))
          return reply
            .code(403)
            .send('Open the store catalog to request an order.');
        const fields = z.record(z.string(), z.string()).safeParse(request.body);
        const values = fields.success ? fields.data : null;
        const cart = values
          ? Object.entries(values).filter(([key]) => key.startsWith('cart:'))
          : [];
        const result = orderRequest.safeParse(
          values && cart.length
            ? {
                id: values.id,
                email: values.email,
                items: cart
                  .filter(([, quantity]) => quantity !== '0')
                  .map(([key, quantity]) => {
                    const [, productId, revision] = key.split(':');
                    return { productId, revision, quantity };
                  }),
              }
            : values,
        );
        if (!result.success)
          return reply
            .code(400)
            .send('Choose at least one product and check your order details.');
        try {
          await limitOrder(id + ':' + request.ip);
        } catch (error) {
          const status = z
            .object({ statusCode: z.literal(429) })
            .safeParse(error);
          return status.success
            ? reply.code(429).send('Too many requests.')
            : reply.code(503).send('Orders are temporarily unavailable.');
        }
        if (!(await stores.request(id, result.data)))
          return reply
            .code(409)
            .send(
              'A product has changed or is unavailable. Refresh the catalog and try again.',
            );
        return reply
          .type('text/html; charset=utf-8')
          .send(
            `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order requested</title><main><h1>Order requested</h1><p>The store has received your request. No payment was taken.</p><p>Reference: ${result.data.id}</p><a href="${catalogPath}">Back to catalog</a></main></html>`,
          );
      },
    );
    done();
  });
}
