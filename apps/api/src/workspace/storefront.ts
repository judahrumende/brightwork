import { storeDeliveryAddress, storeOrderTotal } from '@brightwork/shared';
import {
  buyerPath,
  isBuyerRoute,
  readBuyer,
  registerBuyerRoutes,
} from './store-buyer-routes';
import type { StripeConnectModes } from './stripe-connect';
import type { BuyerAccess } from './store-buyer-routes';
import { escape } from './storefront-html';
import { sendStorePhoto } from './store-product-photo';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { orderRequest } from './generated-store';
import type { generatedStores } from './generated-store';

export const catalogPath = '/store/catalog';
const orderPath = '/store/orders';
const quotePath = '/store/review';
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const photoPath = '/store/photos';
const orderBodyLimit = 128 * 1024;
export function storePublicRoute(method: string, route: string) {
  return (
    isBuyerRoute(method, route) ||
    (method === 'POST' && [orderPath, quotePath].includes(route)) ||
    (['GET', 'HEAD'].includes(method) &&
      (route === catalogPath || route === photoPath + '/:product'))
  );
}

function checkoutPage(title: string, body: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title><style>
    body{margin:0;background:#f8f7f4;color:#282724;font:1rem/1.5 system-ui}main{max-width:40rem;margin:auto;padding:2rem}
    dl>div{display:flex;justify-content:space-between;gap:1rem;padding:.5rem 0;border-bottom:1px solid #ddd9d0}
    a{color:#254a3e}button{font:inherit;color:white;background:#254a3e;border:0;border-radius:.375rem;padding:.625rem 1rem}
    </style><main><a href="${catalogPath}">Back to catalog</a><h1>${title}</h1>${body}</main></html>`;
}

export function registerStorefront(
  app: FastifyInstance,
  stores: ReturnType<typeof generatedStores>,
  siteId: (hostname: string) => string | null,
  origin: (id: string) => string,
  limitOrder: (key: string) => Promise<void>,
  buyerAccess?: BuyerAccess,
  payments?: Pick<StripeConnectModes, 'checkout'>,
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
          "sandbox allow-forms allow-same-origin; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'",
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
      const site = siteId(request.hostname)!;
      const store = await stores.catalog(site);
      if (!store) return reply.code(404).send('Store not found');
      const direct = Boolean(payments && store.directCheckout);
      const buyer = await readBuyer(
        buyerAccess,
        site,
        origin(site),
        request.headers.cookie,
      );
      const accountLink = buyerAccess
        ? `<a href="${buyerPath}">My orders</a>`
        : '';
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
      const zones = store.zones ?? [];
      const deliveryFields = zones.length
        ? `<fieldset><legend>Delivery address</legend>
        <label>Country<select required name="country" autocomplete="shipping country">
          <option value="">Choose a destination</option>${zones
            .map(
              ({ country }) =>
                `<option value="${country}">${escape(countryNames.of(country) ?? country)}</option>`,
            )
            .join('')}
        </select></label>
        <label>Recipient name<input required name="name" maxlength="120" autocomplete="shipping name"></label>
        <label>Street address<input required name="street" maxlength="180" autocomplete="shipping address-line1"></label>
        <label>Apartment or unit<input name="unit" maxlength="120" autocomplete="shipping address-line2"></label>
        <label>City<input required name="city" maxlength="100" autocomplete="shipping address-level2"></label>
        <label>State or region<input name="region" maxlength="100" autocomplete="shipping address-level1"></label>
        <label>Postcode<input name="postalCode" maxlength="24" autocomplete="shipping postal-code"></label>
      </fieldset>`
        : '';
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
          input,button,select{font:inherit;padding:.5rem .75rem;width:100%;border-radius:.375rem;border:1px solid #88867e}fieldset{display:grid;gap:.5rem;border:1px solid #ddd9d0;border-radius:.5rem}button{background:#254a3e;color:white;cursor:pointer}
        </style>
        <main><nav style="display:flex;justify-content:space-between;gap:12px"><a href="/">← ${escape(store.title)}</a>${accountLink}</nav><h1>Shop</h1><p>${direct ? `Choose quantities and check out with Stripe${store.paymentMode === 'test' ? ' in test mode' : ''}.` : 'Choose quantities and send one order request for the store to confirm.'}</p>
        <form method="post" action="${zones.length ? quotePath : orderPath}">
          <input type="hidden" name="id" value="${randomUUID()}">
          ${direct ? '<input type="hidden" name="pay" value="stripe">' : ''}
          <section aria-label="Products">${products || '<p>Products will appear here when they are available.</p>'}</section>
          ${
            available
              ? `<div class="checkout">${
                  buyer
                    ? `<p>Order email · ${escape(buyer)}</p>`
                    : '<label>Email for your order <input type="email" required name="email" maxlength="254" autocomplete="email"></label>'
                }
          ${deliveryFields}<button>${zones.length ? 'Review order' : direct ? 'Continue to Stripe' : 'Request order'}</button></div>`
              : ''
          }
        </form></main></html>`);
    });
    async function orderForm(request: FastifyRequest, reply: FastifyReply) {
      const id = siteId(request.hostname)!;
      if (request.headers.origin !== origin(id))
        return reply
          .code(403)
          .send('Open the store catalog to request an order.');
      const buyer = await readBuyer(
        buyerAccess,
        id,
        origin(id),
        request.headers.cookie,
      );
      const fields = z.record(z.string(), z.string()).safeParse(request.body);
      if (!fields.success)
        return reply.code(400).send('Check your order details.');
      const values: Record<string, string> = {
        ...fields.data,
        ...(buyer ? { email: buyer } : {}),
      };
      const direct = values.pay === 'stripe';
      if (direct && !payments)
        return reply
          .code(503)
          .send('Stripe checkout is temporarily unavailable.');
      const reviewing = request.routeOptions.url === quotePath;
      const quote = z.uuid().safeParse(values.quote);
      const cart = Object.entries(values).filter(([key]) =>
        key.startsWith('cart:'),
      );
      const result = orderRequest.safeParse(
        cart.length
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
      if (reviewing || !quote.success) {
        if (!result.success)
          return reply
            .code(400)
            .send('Choose at least one product and check your order details.');
      }
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
      const changed = () =>
        reply
          .code(409)
          .type('text/html; charset=utf-8')
          .send(
            checkoutPage(
              'Refresh your cart',
              `<p>Prices, availability or delivery may have changed. Return to the catalog for an updated total.</p>`,
            ),
          );
      if (reviewing && result.success) {
        const parsed = storeDeliveryAddress.safeParse(values);
        if (!parsed.success)
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              checkoutPage(
                'Check the delivery address',
                '<p>Enter a recipient, street, city and supported destination.</p>',
              ),
            );
        const review = await stores.prepareDelivery(
          id,
          result.data,
          parsed.data,
          buyer,
        );
        if (!review) return changed();
        const currency = new Intl.NumberFormat('en', {
          style: 'currency',
          currency: review.currency,
        });
        const money = (value: number) => currency.format(value / 100);
        const address = review.delivery.address;
        return reply.type('text/html; charset=utf-8').send(
          checkoutPage(
            'Review your order',
            `
          <p>Order email · ${escape(review.email)}</p>
          <p>Delivery to ${escape(address.name)}<br>${escape([address.street, address.unit].filter(Boolean).join(', '))}
          <br>${escape([address.city, address.region, address.postalCode, countryNames.of(address.country)].filter(Boolean).join(', '))}</p>
          <ul>${review.items.map((item) => `<li>${escape(item.productName)} × ${item.quantity} · ${money(item.unitPrice * item.quantity)}</li>`).join('')}</ul>
          <dl><div><dt>Subtotal</dt><dd>${money(storeOrderTotal(review.items))}</dd></div>
          <div><dt>Shipping</dt><dd>${money(review.delivery.shipping)}</dd></div>
          <div><dt>Tax</dt><dd>${money(review.delivery.tax)}</dd></div>
          <div><dt>Total</dt><dd><strong>${money(storeOrderTotal(review.items, review.delivery))}</strong></dd></div></dl>
          <form method="post" action="${orderPath}"><input type="hidden" name="quote" value="${review.id}">
          ${direct ? '<input type="hidden" name="pay" value="stripe">' : ''}
          <button>${direct ? 'Continue to Stripe' : 'Submit order request'}</button></form>`,
          ),
        );
      }
      const orderId = quote.success
        ? await stores.placeDelivery(id, quote.data, buyer, direct)
        : result.success && (await stores.request(id, result.data, direct))
          ? result.data.id
          : null;
      if (!orderId) return changed();
      if (direct && payments) {
        const sale = await stores.buyerSale(id, orderId);
        if (!sale) return changed();
        if (sale.paid)
          return reply
            .type('text/html; charset=utf-8')
            .send(
              checkoutPage('Payment received', `<p>Reference: ${orderId}</p>`),
            );
        let url: string | null = null;
        try {
          url = await payments.checkout(sale.id);
        } catch {
          request.log.warn(
            { sale: sale.id },
            'Could not create store checkout',
          );
        }
        if (url) return reply.redirect(url, 303);
        const retryFields = quote.success
          ? { quote: quote.data, pay: 'stripe' }
          : values;
        return reply
          .code(503)
          .type('text/html; charset=utf-8')
          .send(
            checkoutPage(
              'Checkout unavailable',
              `
            <p>Retry checkout for the same order. Reference: ${orderId}</p>
            <form method="post" action="${orderPath}">
              ${Object.entries(retryFields)
                .map(
                  ([key, value]) =>
                    `<input type="hidden" name="${escape(key)}" value="${escape(value)}">`,
                )
                .join('')}
              <button>Retry Stripe checkout</button>
            </form>`,
            ),
          );
      }
      return reply
        .type('text/html; charset=utf-8')
        .send(
          checkoutPage(
            'Order requested',
            `<p>The store has received your request. No payment was taken.</p><p>Reference: ${orderId}</p>${buyerAccess ? `<a href="${buyerPath}">My orders</a>` : ''}`,
          ),
        );
    }
    scope.post(orderPath, { bodyLimit: orderBodyLimit }, orderForm);
    scope.post(quotePath, { bodyLimit: orderBodyLimit }, orderForm);
    if (buyerAccess)
      registerBuyerRoutes(
        scope,
        buyerAccess,
        siteId,
        origin,
        stores.isPublished,
      );
    done();
  });
}
