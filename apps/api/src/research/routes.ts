import { performance } from 'node:perf_hooks';
import { webSearchRequest, webSearchResponse } from '@brightwork/shared';
import type { WebSearchCode } from '@brightwork/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { beforeAbort, ResearchFailure } from './answer';
import type { researchAnswer } from './answer';
import { canonicalPageUrl } from './searxng';
import type { publicPageUrl } from './page';

const params = z.object({ id: z.uuid() });
const errors = {
  invalid_request: [400, 'Enter a valid question.'],
  sign_in_required: [401, 'Sign in to search the web.'],
  forbidden: [403, 'This request requires write access from Brightwork.'],
  business_not_found: [404, 'Business not found.'],
  request_too_large: [413, 'The request is too large.'],
  unsupported_media_type: [415, 'Send the question as JSON.'],
  no_evidence: [
    422,
    'The available sources did not provide enough evidence to answer.',
  ],
  rate_limited: [429, 'Search limit reached. Try again later.'],
  upstream_error: [
    502,
    'A research provider could not complete the request. Try again.',
  ],
  unavailable: [503, 'Web search is unavailable.'],
  deadline_exceeded: [504, 'Web search timed out. Try again.'],
} as const satisfies Record<WebSearchCode, readonly [number, string]>;

type Context = {
  deadlineMs?: number;
  authorize: (request: FastifyRequest, businessId: string) => Promise<string>;
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
  };
  rateWindow: (
    type: string,
    key: string,
    seconds: number,
  ) => Promise<{ count: number; ttl: number }>;
  cacheKey: (parts: string[]) => string;
  provider?:
    | {
        identity: string;
        answer: ReturnType<typeof researchAnswer>;
        pageUrl: ReturnType<typeof publicPageUrl>;
      }
    | undefined;
};

function failure(reply: FastifyReply, code: WebSearchCode) {
  const [status, message] = errors[code];
  reply.request.log.info({ code }, 'Web search failed');
  return reply.code(status).send({ code, message });
}

function readCached(raw: string, pageUrl: ReturnType<typeof publicPageUrl>) {
  try {
    const result = webSearchResponse.parse(JSON.parse(raw));
    const urls = result.sources.map((source) => {
      const url = pageUrl(source.url);
      if (!url || url.href !== source.url)
        throw new Error('Invalid cached source URL');
      return canonicalPageUrl(url).href;
    });
    return new Set(urls).size === urls.length ? result : null;
  } catch {
    return null;
  }
}

export function registerResearch(app: FastifyInstance, context?: Context) {
  const signals = new WeakMap<FastifyRequest, AbortSignal>();
  app.post(
    '/api/companies/:id/web-search',
    {
      bodyLimit: 8 * 1024,
      onRequest: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (
          request.headers['content-type']
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() !== 'application/json'
        ) {
          return failure(reply, 'unsupported_media_type');
        }
        const stop = new AbortController();
        signals.set(request, stop.signal);
        const timeout = setTimeout(() => {
          stop.abort();
          if (!reply.sent && !reply.raw.destroyed)
            failure(reply.header('Connection', 'close'), 'deadline_exceeded');
        }, context?.deadlineMs ?? 35_000);
        timeout.unref();
        reply.raw.once('finish', () => clearTimeout(timeout));
        reply.raw.once('close', () => {
          clearTimeout(timeout);
          if (!reply.raw.writableFinished) stop.abort();
        });
      },
      errorHandler: (error, _request, reply) => {
        if (reply.sent || reply.raw.destroyed) return;
        switch (error.statusCode) {
          case 413:
            return failure(reply, 'request_too_large');
          case 415:
            return failure(reply, 'unsupported_media_type');
          case 400:
            return failure(reply, 'invalid_request');
          default:
            return failure(reply, 'unavailable');
        }
      },
    },
    async (request, reply) => {
      const signal = signals.get(request)!;
      if (signal.aborted) return;
      if (!context) return failure(reply, 'unavailable');
      const start = performance.now();
      const diagnostics: Record<string, string | number> = {};
      try {
        const { id } = params.parse(request.params);
        const account = await beforeAbort(signal, () =>
          context.authorize(request, id),
        );
        const { question } = webSearchRequest.parse(request.body);
        const provider = context.provider;
        if (!provider) throw new ResearchFailure('unavailable');
        for (const [window, limit, seconds] of [
          ['minute', 5, 60],
          ['day', 30, 86_400],
        ] as const) {
          const { count, ttl } = await beforeAbort(signal, () =>
            context.rateWindow('research-' + window, account, seconds),
          );
          if (count > limit)
            return failure(
              reply.header('Retry-After', String(ttl)),
              'rate_limited',
            );
        }
        const key = context.cacheKey([
          'research-v1',
          account,
          id,
          provider.identity,
          question,
        ]);
        const cached = await beforeAbort(signal, () => context.redis.get(key));
        diagnostics.cache = 'miss';
        if (cached !== null) {
          const answer = readCached(cached, provider.pageUrl);
          if (answer) {
            diagnostics.cache = 'hit';
            return answer;
          }
          void context.redis.del(key).catch(() => {});
        }
        const global = await beforeAbort(signal, () =>
          context.rateWindow('research-global', '', 3_600),
        );
        if (global.count > 60)
          return failure(
            reply.header('Retry-After', String(global.ttl)),
            'rate_limited',
          );
        const answer = await beforeAbort(signal, () =>
          provider.answer(question, signal, diagnostics),
        );
        // Quotas were enforced before provider calls. A cache write failure can be skipped.
        void context.redis
          .set(key, JSON.stringify(answer), 'EX', 600)
          .catch(() => {});
        return answer;
      } catch (error) {
        if (signal.aborted || reply.sent || reply.raw.destroyed) return;
        if (error instanceof ResearchFailure) return failure(reply, error.code);
        if (error instanceof z.ZodError)
          return failure(reply, 'invalid_request');
        return failure(reply, 'unavailable');
      } finally {
        request.log.info(
          { ...diagnostics, durationMs: Math.round(performance.now() - start) },
          'Web search completed',
        );
      }
    },
  );
}
