import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';

const browserPaths =
  /^\/(?:home|new|login|signup|signed-out|sign-in(?:\/link)?|sign-up|f\/[a-z0-9-]+(?:\/[a-z-]+)?|sale\/[a-z0-9-]+)$/u;

const contentTypes = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
]);

export async function registerWeb(app: FastifyInstance, appOrigin: string) {
  const dist = new URL('../../web/dist/', import.meta.url);
  const client = new URL('client/', dist);
  const server = new URL('server/marketing-server.js', dist);
  const [{ renderMarketing }, template, assets] = await Promise.all([
    import(server.href) as Promise<{
      renderMarketing: (
        template: string,
        path: string,
        origin: string,
      ) => string | null;
    }>,
    readFile(new URL('index.html', client), 'utf8'),
    readdir(new URL('assets/', client), { withFileTypes: true }),
  ]);
  const files = new Set(
    assets
      .filter((entry) => entry.isFile())
      .map((entry) => '/assets/' + entry.name),
  );
  files.add('/mark.svg');
  const origin = new URL(appOrigin);
  app.addHook('onRequest', async (request, reply) => {
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      request.hostname.toLowerCase() !== origin.hostname
    )
      return;
    const path = request.url.split('?')[0] ?? '';
    if (files.has(path)) {
      const type = contentTypes.get(extname(path));
      if (!type) return;
      return reply
        .type(type)
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Cache-Control',
          path.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        )
        .send(createReadStream(new URL('.' + path, client)));
    }
    const page = path.replace(/\/$/u, '') || '/';
    const html = renderMarketing(template, page, origin.origin);
    if (html)
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'public, max-age=300')
        .header('X-Content-Type-Options', 'nosniff')
        .send(html);
    if (browserPaths.test(page))
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(template);
  });
}
