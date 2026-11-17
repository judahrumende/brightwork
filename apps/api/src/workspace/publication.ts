import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { websiteDocument, websitePageSlug } from '@brightwork/shared';
import type { agentStore } from './agent-store';

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
) {
  const parsed = hostSchema.safeParse(domain);
  if (!parsed.success) return null;
  const base = parsed.data;
  const scheme = new URL(origin).protocol;
  const baseUrl = new URL(scheme + '//' + base);
  if (baseUrl.hostname === new URL(origin).hostname)
    throw new Error('Site hosting needs a distinct base domain');
  const url = (id: string) => scheme + '//' + id + '.' + base;

  async function serveSite(
    request: FastifyRequest,
    reply: FastifyReply,
    slug: string,
  ) {
    const hostname = request.hostname.toLowerCase();
    const suffix = '.' + baseUrl.hostname;
    const key = hostname.endsWith(suffix)
      ? z.uuid().safeParse(hostname.slice(0, -suffix.length))
      : null;
    if (!key?.success) return reply.code(404).send('Site not found');
    const page = await store.published(key.data);
    if (!page) return reply.code(404).send('Site not found');
    const document = websiteDocument(page.document, page.pages ?? [], slug);
    if (document === null) return reply.code(404).send('Page not found');
    void store
      .visit(key.data)
      .catch(() => app.log.warn('Could not count a website view'));
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
  return { url };
}
