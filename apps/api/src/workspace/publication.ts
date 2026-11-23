import type { StripeConnectModes } from './stripe-connect';
import type { BuyerAccess } from './store-buyer-routes';
import { registerStorefront, storePublicRoute } from './storefront';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { websiteDocument, websitePageSlug } from '@brightwork/shared';
import type { agentStore } from './agent-store';
import { browserCookie, cookie } from '../auth/tokens';

const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/u,
  );
export function siteHosting(
  app: FastifyInstance,
  store: ReturnType<typeof agentStore>,
  origin: string,
  domain: string | undefined,
  limitOrder: (key: string) => Promise<void>,
  buyerAccess?: BuyerAccess,
  payments?: Pick<StripeConnectModes, 'checkout'>,
) {
  const parsed = hostSchema.safeParse(domain);
  if (!parsed.success) return null;
  const base = parsed.data;
  const scheme = new URL(origin).protocol;
  const baseUrl = new URL(scheme + '//' + base);
  const dashboard = new URL(origin).hostname;
  const onSiteDomain = (hostname: string) =>
    hostname === baseUrl.hostname || hostname.endsWith('.' + baseUrl.hostname);
  if (onSiteDomain(dashboard))
    throw new Error('Site hosting needs a distinct base domain');
  const url = (id: string) => scheme + '//' + id + '.' + base;
  const siteId = (hostname: string) => {
    const suffix = '.' + baseUrl.hostname;
    const lower = hostname.toLowerCase();
    if (!lower.endsWith(suffix)) return null;
    const parsed = z.uuid().safeParse(lower.slice(0, -suffix.length));
    return parsed.success ? parsed.data : null;
  };
  const secure = scheme === 'https:';
  const visitCookie = secure ? '__Host-bw-visit' : 'bw-visit';

  app.addHook('onRequest', async (request, reply) => {
    if (!onSiteDomain(request.hostname.toLowerCase().replace(/\.$/u, '')))
      return;
    const route = request.routeOptions.url;
    if (storePublicRoute(request.method, route ?? '')) return;
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      (route !== '/' && route !== '/:page')
    )
      return reply.code(404).send('Site route not found');
  });

  async function serveSite(
    request: FastifyRequest,
    reply: FastifyReply,
    slug: string,
  ) {
    const id = siteId(request.hostname);
    if (!id) return reply.code(404).send('Site not found');
    const page = await store.published(id);
    if (!page) return reply.code(404).send('Site not found');
    const document = websiteDocument(page.document, page.pages ?? [], slug);
    if (document === null) return reply.code(404).send('Page not found');
    if (request.method === 'GET') {
      const current = z
        .uuid()
        .safeParse(browserCookie(request.headers.cookie, visitCookie));
      const session = current.success ? current.data : randomUUID();
      const referrer = request.headers.referer;
      const referringUrl =
        !current.success &&
        referrer &&
        referrer.length <= 2048 &&
        URL.canParse(referrer)
          ? new URL(referrer)
          : null;
      const source =
        referringUrl &&
        ['https:', 'http:'].includes(referringUrl.protocol) &&
        referringUrl.hostname.length <= 253 &&
        !onSiteDomain(referringUrl.hostname)
          ? referringUrl.hostname
          : null;
      reply.header('Set-Cookie', cookie(visitCookie, session, secure, 30 * 60));
      await store
        .visit(id, session, '/' + slug, source)
        .catch(() => app.log.warn('Could not count a website view'));
    }
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .send(document);
  }
  app.get('/', (request, reply) => serveSite(request, reply, ''));
  app.get('/:page', (request, reply) => {
    const slug = z.object({ page: websitePageSlug }).safeParse(request.params);
    if (!slug.success) return reply.code(404).send('Page not found');
    return serveSite(request, reply, slug.data.page);
  });
  registerStorefront(
    app,
    store.generatedStore,
    siteId,
    url,
    limitOrder,
    buyerAccess,
    payments,
  );
  return { url };
}
