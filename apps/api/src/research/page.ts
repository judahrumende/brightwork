import { Resolver } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { TcpNetConnectOpts } from 'node:net';
import type { Readable } from 'node:stream';
import { loadBuffer } from 'cheerio';
import { relevance } from './searxng';

const maxBytes = 1024 * 1024;
const excluded = new BlockList();
// IANA special-purpose IPv4 ranges, multicast, and reserved space.
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  excluded.addSubnet(address, bits);
excluded.addAddress('168.63.129.16'); // Azure platform virtual IP.

export function publicPageUrl(appOrigin: string, siteDomain?: string) {
  const blocked = [
    new URL(appOrigin).hostname,
    siteDomain,
    'localhost',
    'local',
    'localdomain',
    'internal',
    'home.arpa',
    'invalid',
  ]
    .filter((host): host is string => Boolean(host))
    .map((host) => host.toLowerCase().replace(/\.$/u, ''));
  return (input: string) => {
    if (input.length > 2048) return null;
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/\.$/u, '');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.port ||
      url.username ||
      url.password ||
      !host.includes('.') ||
      isIP(host) ||
      !/^[a-z0-9.-]+$/u.test(host) ||
      blocked.some((domain) => host === domain || host.endsWith('.' + domain))
    )
      return null;
    url.hostname = host;
    url.hash = '';
    return url.href.length <= 2048 ? url : null;
  };
}

type PageResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Readable;
};

async function resolveIPv4(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await resolver.resolve4(hostname + '.');
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function requestPage(
  url: URL,
  address: string,
  signal: AbortSignal,
): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const connection: RequestOptions &
      Pick<TcpNetConnectOpts, 'autoSelectFamily'> = {
      agent: false,
      family: 4,
      autoSelectFamily: false,
      signal,
      // Pin the checked address and keep the original HTTPS hostname for certificate validation.
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
      headers: {
        Accept: 'text/html,text/plain',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Brightwork-Research/1.0',
      },
    };
    request(url, connection, (body) => {
      resolve({ status: body.statusCode ?? 0, headers: body.headers, body });
    })
      .on('error', reject)
      .end();
  });
}

async function readPageBody(body: Readable) {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maxBytes) return null;
    buffers.push(buffer);
  }
  return Buffer.concat(buffers, size);
}

export function normalizeText(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}

export type FetchedPage = {
  url: string;
  title: string;
  paragraphs: string[];
  score: number;
};

function extract(
  buffer: Buffer,
  contentType: string,
  url: URL,
  terms: Set<string>,
): FetchedPage | null {
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([^"';\s]+)/iu.exec(
    contentType,
  )?.[1];
  let title = '';
  let text: string;
  if (/^text\/plain(?:;|$)/iu.test(contentType)) {
    text = new TextDecoder(charset || 'utf-8').decode(buffer);
  } else {
    const $ = loadBuffer(
      buffer,
      charset ? { encoding: { transportLayerEncodingLabel: charset } } : {},
    );
    title = normalizeText($('title').first().text());
    if (
      /^(?:access denied|just a moment\.{0,3}|attention required!?)$/iu.test(
        title,
      ) ||
      $('script[type="application/ld+json"]')
        .toArray()
        .some((node) =>
          /"isAccessibleForFree"\s*:\s*(?:false\b|"false")/iu.test(
            $(node).text(),
          ),
        )
    )
      return null;
    $(
      'script,style,noscript,template,svg,nav,aside,footer,form,iframe,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"]',
    ).remove();
    $('p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,section,div,article,tr,br').append(
      '\n\n',
    );
    text = $('body').text();
    for (const selector of ['main', 'article', '[role="main"]']) {
      const content = $(selector).first().text();
      if (normalizeText(content).length >= 80) {
        text = content;
        break;
      }
    }
    title ||= normalizeText($('h1').first().text());
  }
  const candidates = [
    ...new Set(
      text
        .split(/\n\s*\n/u)
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
  const ranked = candidates
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: relevance(paragraph, terms),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let remaining = 6_000;
  const selected = [];
  for (const row of ranked) {
    if (remaining <= 0) break;
    const paragraph = row.paragraph.slice(0, remaining).trimEnd();
    if (!paragraph) continue;
    selected.push({ ...row, paragraph });
    remaining -= paragraph.length + 2;
  }
  if (6_000 - remaining < 80 || !/\p{L}/u.test(text)) return null;
  const paragraphs = selected
    .sort((a, b) => a.index - b.index)
    .map((row) => row.paragraph);
  return {
    url: url.href,
    title: (title || url.hostname).slice(0, 200).trimEnd(),
    paragraphs,
    score: 2 * relevance(title, terms) + relevance(paragraphs.join(' '), terms),
  };
}

export function pageReader(
  pageUrl: ReturnType<typeof publicPageUrl>,
  resolve = resolveIPv4,
  request = requestPage,
) {
  return async (candidate: URL, terms: Set<string>, parent: AbortSignal) => {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(3_000)]);
    let url = pageUrl(candidate.href);
    const visited = new Set<string>();
    try {
      for (let hops = 0; url && hops <= 3; hops++) {
        signal.throwIfAborted();
        if (visited.has(url.href)) return null;
        visited.add(url.href);
        const addresses = await resolve(url.hostname, signal);
        const address = addresses[0];
        if (
          !address ||
          addresses.some((ip) => isIP(ip) !== 4 || excluded.check(ip))
        )
          return null;
        signal.throwIfAborted();
        const { status, headers, body } = await request(url, address, signal);
        try {
          if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
            url = pageUrl(new URL(headers.location, url).href);
            continue;
          }
          const type = headers['content-type'] ?? '';
          const encoding = headers['content-encoding']?.toLowerCase();
          if (
            status !== 200 ||
            !/^text\/(?:html|plain)(?:;|$)/iu.test(type) ||
            (encoding && encoding !== 'identity') ||
            Number(headers['content-length']) > maxBytes
          )
            return null;
          const buffer = await readPageBody(body);
          signal.throwIfAborted();
          return buffer && extract(buffer, type, url, terms);
        } finally {
          body.destroy();
        }
      }
    } catch {
      // A failed page is skipped while other candidates are still eligible.
    }
    return null;
  };
}
