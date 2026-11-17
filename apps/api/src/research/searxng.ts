import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const result = z.object({
  url: z.string().max(2048),
});
const results = z.object({ results: z.array(z.unknown()).max(1000) });
const maxBytes = 1024 * 1024;

export function rewriteQuery(question: string) {
  const original = question.trim();
  if (/["!]|(?:^|\s)[+-]\S/u.test(original)) return original;
  const compact = original.replace(/\s+/gu, ' ');
  const query = compact
    .replace(
      /^(?:(?:can|could|would) you\s+(?:please\s+)?(?:tell me|show me|explain)|please\s+(?:tell me|show me|explain))\s+/iu,
      '',
    )
    .replace(/^(?:what (?:is|are)|how (?:do|does|can) (?:i|we))\s+/iu, '')
    .replace(/\?+$/u, '');
  return query.length >= 3 ? query : compact;
}

export function searchTerms(query: string) {
  return new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

export function relevance(text: string, query: Set<string>) {
  return [...searchTerms(text)].filter((term) => query.has(term)).length;
}

export function canonicalPageUrl(input: URL) {
  const url = new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/iu.test(key))
      url.searchParams.delete(key);
  }
  return url;
}

export function searxngEndpoint(value: string) {
  const base = new URL(value);
  const trustedHttp = ['localhost', '127.0.0.1', '[::1]', 'searxng'].includes(
    base.hostname,
  );
  if (
    base.username ||
    base.password ||
    base.href.includes('?') ||
    base.href.includes('#') ||
    !(base.protocol === 'https:' || (trustedHttp && base.protocol === 'http:'))
  )
    throw new Error('Invalid SearXNG base URL');
  base.pathname = base.pathname.replace(/\/+$/u, '') + '/search';
  return base;
}

async function readResults(response: Response) {
  if (!response.body) throw new Error('SearXNG returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new Error('SearXNG response exceeded the size limit');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return results.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    .results;
}

export function searxngSearch(endpoint: URL, request = fetch) {
  return async (
    query: string,
    signal: AbortSignal,
    pageUrl: (value: string) => URL | null,
  ) => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await request(endpoint, {
          method: 'POST',
          body: new URLSearchParams({
            q: query,
            format: 'json',
            categories: 'general',
            safesearch: '1',
          }),
          headers: { Accept: 'application/json' },
          redirect: 'manual',
          signal,
        });
      } catch (error) {
        if (attempt || signal.aborted || !(error instanceof TypeError))
          throw error;
      }
      if (response && (attempt || ![502, 503].includes(response.status))) break;
      void response?.body?.cancel().catch(() => {});
      await delay(randomInt(100, 251), undefined, { signal });
    }
    if (!response?.ok) {
      void response?.body?.cancel().catch(() => {});
      throw new Error('SearXNG search failed');
    }

    const rows = await readResults(response);
    const seen = new Set<string>();
    const hosts = new Set<string>();
    const diverse: URL[] = [];
    const remaining: URL[] = [];
    for (const row of rows) {
      const parsed = result.safeParse(row);
      if (!parsed.success) continue;
      const candidate = pageUrl(parsed.data.url);
      if (!candidate) continue;
      const url = canonicalPageUrl(candidate);
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const host = url.hostname.replace(/^www\./u, '');
      if (hosts.has(host)) {
        if (remaining.length < 8) remaining.push(url);
      } else {
        hosts.add(host);
        diverse.push(url);
      }
      if (diverse.length === 8) break;
    }
    return [...diverse, ...remaining].slice(0, 8);
  };
}
