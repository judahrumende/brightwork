import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { observedContracts } from '../packages/shared/src/api-contracts.gen.ts';

const [harPath, target, ...flags] = process.argv.slice(2);
if (!harPath || !target || flags.some((flag) => flag !== '--write-fixtures')) {
  console.error(
    'Usage: pnpm contracts:replay <fixture.har> <local app origin> [--write-fixtures]',
  );
  process.exit(2);
}
const origin = new URL(target);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
  !['http:', 'https:'].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
) {
  throw new Error('Use the origin of the local Brightwork fixture server.');
}
const writes = flags.includes('--write-fixtures');
const { log } = JSON.parse(await readFile(harPath, 'utf8'));
const firstApi = log.entries.find((entry) =>
  new URL(entry.request.url).pathname.startsWith('/api/'),
);
if (!firstApi) throw new Error('The fixture contains no API requests.');
const source = new URL(firstApi.request.url);
const permittedSource = process.env.HAR_FIXTURE_SOURCE_ORIGIN ?? source.origin;
const tabId = randomUUID();
const cookie = process.env.HAR_FIXTURE_COOKIE;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const ids = JSON.parse(process.env.HAR_FIXTURE_ID_MAP ?? '{}');
const totals = { matched: 0, mismatched: 0, skipped: 0 };
const schema = new Map(Object.entries(observedContracts));

function mapIds(value) {
  if (typeof value === 'string')
    return Object.hasOwn(ids, value) ? ids[value] : value;
  if (Array.isArray(value)) return value.map(mapIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapIds(item)]),
    );
  return value;
}

async function inspect(response, contract, expectedStatus) {
  const issues = [];
  if (
    response.status !== expectedStatus ||
    !contract.statuses.includes(response.status)
  )
    issues.push(
      `captured status ${expectedStatus}, local status ${response.status}`,
    );
  const type = response.headers.get('content-type')?.split(';')[0].trim();
  if (
    response.status !== 204 &&
    contract.responseTypes.length &&
    !contract.responseTypes.includes(type)
  )
    issues.push(`local media type ${type ?? '(missing)'}`);
  if (response.ok && type === 'application/json') {
    const body = await response.json();
    const result = contract.response.safeParse(body);
    if (!result.success) {
      issues.push(
        ...result.error.issues
          .slice(0, 8)
          .map(
            (issue) =>
              `response ${issue.path.join('.') || '(root)'}: ${issue.code}`,
          ),
      );
    }
  } else {
    await response.body?.cancel();
  }
  return issues;
}

for (const entry of log.entries) {
  const { request, response: captured } = entry;
  const sourceUrl = new URL(request.url);
  if (
    sourceUrl.origin !== permittedSource ||
    !sourceUrl.pathname.startsWith('/api/')
  )
    continue;
  const method = request.method;
  const parts = sourceUrl.pathname.split('/');
  const eventKey = `${method} ${parts.map((part) => (uuid.test(part) ? ':id' : part)).join('/')}`;
  const contract =
    schema.get(eventKey) ?? schema.get(`${method} ${sourceUrl.pathname}`);
  if (!contract || !captured.status) {
    totals.skipped++;
    continue;
  }
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (
    (isWrite && !writes) ||
    contract.responseTypes.includes('text/event-stream')
  ) {
    totals.skipped++;
    continue;
  }
  if (
    isWrite &&
    request.postData &&
    !request.postData.mimeType?.startsWith('application/json')
  ) {
    totals.skipped++;
    continue;
  }
  const destination = new URL(origin);
  destination.pathname = parts
    .map((part) => encodeURIComponent(mapIds(decodeURIComponent(part))))
    .join('/');
  for (const [key, value] of sourceUrl.searchParams)
    destination.searchParams.append(key, mapIds(value));
  const headers = { Accept: 'application/json', 'X-Session-Id': tabId };
  if (cookie) headers.Cookie = cookie;
  try {
    let body;
    let requestIssue = false;
    if (isWrite) {
      headers.Origin = origin.origin;
      if (request.postData?.text) {
        headers['Content-Type'] = 'application/json';
        const recordedBody = mapIds(JSON.parse(request.postData.text));
        requestIssue = !contract.request.safeParse(recordedBody).success;
        body = JSON.stringify(recordedBody);
      }
    }
    const response = await fetch(destination, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const issues = await inspect(response, contract, captured.status);
    if (requestIssue)
      issues.unshift('recorded body differs from the inferred request schema');
    if (issues.length) {
      totals.mismatched++;
      console.log(`${eventKey}: ${issues.join(', ')}`);
    } else {
      totals.matched++;
    }
  } catch {
    totals.mismatched++;
    console.log(`${eventKey}: local request or response parsing failed`);
  }
}
console.log(JSON.stringify(totals));
if (!totals.matched || totals.mismatched) process.exitCode = 1;
