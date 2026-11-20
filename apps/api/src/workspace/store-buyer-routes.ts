import { storeOrderTotal } from '@brightwork/shared';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { browserCookie, cookie, sessionLifetimeSeconds } from '../auth/tokens';
import type { storeBuyers } from './store-buyers';
import { escape } from './storefront-html';

export const buyerPath = '/store/account';
const codePath = buyerPath + '/code';
const verifyPath = buyerPath + '/verify';
const logoutPath = buyerPath + '/sign-out';
const logoutAllPath = buyerPath + '/sign-out-all';
const storefrontCatalog = '/store/catalog';

export const isBuyerRoute = (method: string, route: string) =>
  (['GET', 'HEAD'].includes(method) && route === buyerPath) ||
  (method === 'POST' &&
    [codePath, verifyPath, logoutPath, logoutAllPath].includes(route));

export type BuyerAccess = {
  buyers: ReturnType<typeof storeBuyers>;
  sendCode: (
    recipient: string,
    code: string,
    storefront: string,
  ) => Promise<void>;
  limit: (type: 'ip' | 'email' | 'verify', key: string) => Promise<void>;
  paymentOrigin: string;
};

function sessionCookie(origin: string) {
  return origin.startsWith('https:') ? '__Host-bw-buyer' : 'bw-buyer';
}

export function readBuyer(
  access: BuyerAccess | undefined,
  siteId: string,
  origin: string,
  header?: string,
) {
  return (
    access?.buyers.buyer(
      siteId,
      browserCookie(header, sessionCookie(origin)),
    ) ?? Promise.resolve(null)
  );
}

function render(reply: FastifyReply, title: string, body: string) {
  return reply.type('text/html; charset=utf-8').send(`<!doctype html>
    <html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(title)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#f8f7f4;color:#282724;font:1rem/1.5 system-ui}
      main{max-width:52rem;margin:auto;padding:clamp(1rem,5vw,4rem)}h1{line-height:1.2}
      a{color:#254a3e}article{padding:1rem 1.25rem;background:white;border:1px solid #ddd9d0;border-radius:.75rem;margin:1rem 0;overflow-wrap:anywhere}
      input,button{font:inherit;padding:.5rem .75rem;border-radius:.375rem;border:1px solid #88867e}
      label,input{display:block}input{width:100%;margin:.25rem 0 1rem}form{max-width:24rem}
      button{background:#254a3e;color:white;cursor:pointer}time{color:#53514b}
    </style>
    <main><nav><a href="${storefrontCatalog}">Back to shop</a></nav>
    <h1>${escape(title)}</h1>${body}</main></html>`);
}

function enterCode(reply: FastifyReply, challenge: string, message: string) {
  return render(
    reply,
    'Enter your sign-in code',
    `<p>${escape(message)}</p>
    <form method="post" action="${verifyPath}">
      <input type="hidden" name="challenge" value="${challenge}">
      <label for="code">Six-digit code</label><input id="code" name="code" required
        inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}">
      <button>Sign in</button>
    </form><p><a href="${buyerPath}">Request a new code</a></p>`,
  );
}

function redirect(reply: FastifyReply) {
  return reply.code(303).header('Location', buyerPath).send();
}

const emailInput = z.object({
  email: z
    .email()
    .trim()
    .max(254)
    .transform((email) => email.toLowerCase()),
});
const proofInput = z.object({
  challenge: z.uuid(),
  code: z.string().regex(/^\d{6}$/u),
});
const cursorInput = z.object({ id: z.uuid(), createdAt: z.iso.datetime() });

export function registerBuyerRoutes(
  app: FastifyInstance,
  access: BuyerAccess,
  siteId: (host: string) => string | null,
  origin: (id: string) => string,
  published: (id: string) => Promise<boolean>,
) {
  async function limited(reply: FastifyReply, work: () => Promise<void>) {
    try {
      await work();
      return false;
    } catch (error) {
      const status = z.object({ statusCode: z.literal(429) }).safeParse(error);
      void render(
        reply.code(status.success ? 429 : 503),
        'Sign-in unavailable',
        '<p>Try signing in again later.</p>',
      );
      return true;
    }
  }
  void app.register((account, _opts, done) => {
    account.addHook('onRequest', async (request, reply) => {
      const site = siteId(request.hostname);
      if (!site || !(await published(site)))
        return reply.code(404).send('Store not found');
      if (request.method === 'POST' && request.headers.origin !== origin(site))
        return reply.code(403).send('Sign in from the store account page.');
      reply.header('Referrer-Policy', 'same-origin');
    });
    const context = (request: FastifyRequest) => {
      const site = siteId(request.hostname)!;
      const base = origin(site);
      const name = sessionCookie(base);
      return {
        site,
        base,
        name,
        token: browserCookie(request.headers.cookie, name),
      };
    };
    account.get(buyerPath, async (request, reply) => {
      const { site, token } = context(request);
      const email = await access.buyers.buyer(site, token);
      if (!email)
        return render(
          reply,
          'My orders',
          `<p>Enter your email to get a sign-in code and view your orders.</p>
        <form action="${codePath}" method="post">
        <label for="email">Email address</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email">
        <button>Email me a code</button></form>`,
        );
      const cursor = cursorInput.safeParse(request.query);
      const orders = await access.buyers.orders(
        site,
        email,
        cursor.success ? cursor.data : undefined,
      );
      const formatter = new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      });
      const page = orders.slice(0, 20);
      const next = orders.length > 20 ? page.at(-1) : undefined;
      const cards = page
        .map((order) => {
          const amount = storeOrderTotal(
            order.items,
            order.delivery,
            order.discount?.amount ?? 0,
          );
          const currency = new Intl.NumberFormat('en', {
            style: 'currency',
            currency: order.currency,
          });
          const refund =
            order.amountRefunded > 0
              ? `<p>Refunded ${currency.format(order.amountRefunded / 100)} · Net paid ${currency.format(Math.max(0, amount - order.amountRefunded) / 100)}</p>`
              : '';
          const pay =
            order.status === 'confirmed' &&
            order.payment === 'awaiting_payment' &&
            order.saleId
              ? `<p><a href="${escape(new URL('/sale/' + order.saleId, access.paymentOrigin).href)}">Open payment link</a></p>`
              : '';
          const tracking = order.tracking
            ? `<p>Shipment · ${escape(order.tracking.carrier)} · ${escape(order.tracking.number)} · <a href="${escape(order.tracking.url)}" target="_blank" rel="noreferrer">Track package</a></p>`
            : '';
          const discount = order.discount
            ? `<p>Discount ${escape(order.discount.code)} · −${currency.format(order.discount.amount / 100)}</p>`
            : '';
          const payment = {
            awaiting_payment: 'Awaiting payment',
            paid: 'Paid',
            partially_refunded: 'Partially refunded',
            refunded: 'Refunded',
            closed: 'Checkout closed',
          };
          return `<article><h2>${currency.format(amount / 100)} · ${escape(order.status)}</h2>
          ${discount}${refund}
          <time datetime="${escape(order.createdAt)}">${formatter.format(new Date(order.createdAt))}</time>
          <ul>${order.items.map((line) => `<li>${escape(line.productName)} × ${line.quantity}</li>`).join('')}</ul>
          ${
            order.delivery
              ? `<p>Delivery to ${escape(order.delivery.address.name)} · ${escape([order.delivery.address.street, order.delivery.address.unit, order.delivery.address.city, order.delivery.address.region, order.delivery.address.postalCode, order.delivery.address.country].filter(Boolean).join(', '))}</p>
          <p>Shipping ${currency.format(order.delivery.shipping / 100)} · Tax ${currency.format(order.delivery.tax / 100)}</p>`
              : ''
          }
          ${order.payment ? `<p>${payment[order.payment]}</p>` : ''}
          <p>Reference: ${order.id}</p>${pay}${tracking}</article>`;
        })
        .join('');
      const query = next
        ? new URLSearchParams({ id: next.id, createdAt: next.createdAt })
        : null;
      return render(
        reply,
        'My orders',
        `<p>Signed in as ${escape(email)}</p>
        <form method="post" action="${logoutPath}"><button>Sign out</button></form>
        <form method="post" action="${logoutAllPath}"><button>Sign out on all devices</button></form>
        ${cards || '<p>No orders to show.</p>'}
        ${query ? `<a href="${buyerPath}?${escape(query.toString())}">Older orders</a>` : ''}`,
      );
    });
    account.post(codePath, { bodyLimit: 2048 }, async (request, reply) => {
      const { site, base } = context(request);
      const parsed = emailInput.safeParse(request.body);
      if (!parsed.success)
        return render(
          reply.code(400),
          'Check your email address',
          `<p><a href="${buyerPath}">Back to sign-in</a></p>`,
        );
      const { email } = parsed.data;
      if (
        await limited(reply, async () => {
          await access.limit('ip', request.ip);
          await access.limit('email', email);
        })
      )
        return;
      const challenge = await access.buyers.challenge(site, email);
      try {
        await access.sendCode(email, challenge.code, new URL(base).hostname);
      } catch {
        await access.buyers.discard(site, challenge.id);
        return render(
          reply.code(503),
          'Code delivery unavailable',
          `<p><a href="${buyerPath}">Try again later</a></p>`,
        );
      }
      return enterCode(
        reply,
        challenge.id,
        'Check your email for a code. It expires in ten minutes.',
      );
    });
    account.post(verifyPath, { bodyLimit: 2048 }, async (request, reply) => {
      const { site, base, name, token: old } = context(request);
      const proof = proofInput.safeParse(request.body);
      if (!proof.success)
        return render(
          reply.code(400),
          'Check your sign-in code',
          `<p><a href="${buyerPath}">Back to sign-in</a></p>`,
        );
      if (await limited(reply, () => access.limit('verify', request.ip)))
        return;
      const token = await access.buyers.verify(
        site,
        proof.data.challenge,
        proof.data.code,
        old,
      );
      if (!token)
        return enterCode(
          reply.code(401),
          proof.data.challenge,
          'That code is incorrect or expired.',
        );
      reply.header(
        'Set-Cookie',
        cookie(name, token, base.startsWith('https:'), sessionLifetimeSeconds),
      );
      return redirect(reply);
    });
    account.post(logoutPath, { bodyLimit: 2048 }, async (request, reply) => {
      const { site, base, name, token } = context(request);
      await access.buyers.signOut(site, token);
      reply.header(
        'Set-Cookie',
        cookie(name, '', base.startsWith('https:'), 0),
      );
      return redirect(reply);
    });
    account.post(logoutAllPath, { bodyLimit: 2048 }, async (request, reply) => {
      const { site, base, name, token } = context(request);
      const email = await access.buyers.buyer(site, token);
      if (email) await access.buyers.signOutAll(site, email);
      reply.header(
        'Set-Cookie',
        cookie(name, '', base.startsWith('https:'), 0),
      );
      return redirect(reply);
    });
    done();
  });
}
