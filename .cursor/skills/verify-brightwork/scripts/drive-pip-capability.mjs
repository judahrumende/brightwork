#!/usr/bin/env node
/**
 * Drive pip-capability-expansion against an owned verify stack.
 * Deterministic API + SQL + catalog checks (no long model journey).
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = process.env.APP_ORIGIN;
const out = process.env.VERIFY_ROOT;
const databaseUrl = process.env.DATABASE_URL;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

if (!origin || !out || !databaseUrl) {
  console.error('APP_ORIGIN, VERIFY_ROOT, and DATABASE_URL required');
  process.exit(1);
}

await mkdir(out, { recursive: true });

const tab = randomUUID();
const cookieJar = new Map();
const note = [];
const results = { feature: 'pip-capability-expansion', ok: false, steps: [] };

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  note.push(line);
}

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    const [pair] = entry.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function api(method, urlPath, body) {
  const headers = {
    Origin: origin,
    'x-session-id': tab,
    Accept: 'application/json',
  };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(response);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: response.status, json, text };
}

async function save(name, data) {
  const file = path.join(out, name);
  await writeFile(
    file,
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  );
  return file;
}

function step(name, ok, detail) {
  results.steps.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}: ${detail || 'failed'}`);
}

try {
  const health = await fetch(`${origin}/health`);
  const healthJson = await health.json();
  step(
    'health',
    health.ok && healthJson.status === 'ok',
    JSON.stringify(healthJson),
  );

  const session = await api('POST', '/api/me/session', {});
  await save('session.json', session);
  step('session', session.status === 200, `HTTP ${session.status}`);

  const begin = await api('POST', '/api/me/companies/begin', {
    name: 'Capability Cafe',
    idea: 'Notebook cafe for Harbor Notes fans who want quiet tables and Wi-Fi.',
  });
  await save('begin.json', begin);
  const companyId = begin.json?.company?.id || begin.json?.id;
  step(
    'begin',
    begin.status === 200 || begin.status === 201,
    `HTTP ${begin.status} company=${companyId}`,
  );
  if (!companyId) throw new Error('No company id');

  const create = await api('POST', `/api/companies/${companyId}/pip/runs`, {
    goal: 'Prove Run power and view endpoints for Capability Cafe.',
    steps: [],
    successCriteria: ['Run views and power are readable from the API'],
    creditLimit: '1',
    publishWebsites: false,
    mode: 'ask_first',
    power: 'ultra',
  });
  await save('run-create.json', create);
  step(
    'run-create',
    create.status === 201,
    `HTTP ${create.status} body=${JSON.stringify(create.json).slice(0, 240)}`,
  );
  const createdPower = create.json?.run?.power;
  step(
    'run-power-persisted',
    createdPower === 'ultra',
    `power=${createdPower}`,
  );

  const list = await api('GET', `/api/companies/${companyId}/pip/runs`);
  await save('runs-list.json', list);
  const listed = (list.json?.runs || []).find(
    (run) => run.id === create.json.run.id,
  );
  step(
    'runs-list-power',
    list.status === 200 && listed?.power === 'ultra',
    `HTTP ${list.status} power=${listed?.power}`,
  );

  for (const view of [
    'directions',
    'report',
    'earlier',
    'tasks',
    'questions',
  ]) {
    const response = await api(
      'GET',
      `/api/companies/${companyId}/run/${view}`,
    );
    await save(`${view}.json`, response);
    if (view === 'directions') {
      step(
        'run-directions',
        response.status === 200 &&
          Array.isArray(response.json?.directions) &&
          response.json.directions.length > 0 &&
          Array.isArray(response.json?.sprint?.items),
        `HTTP ${response.status} directions=${response.json?.directions?.length}`,
      );
    } else if (view === 'report') {
      step(
        'run-report',
        response.status === 200 &&
          response.json?.soFar?.sessionId === create.json.run.id,
        `HTTP ${response.status} session=${response.json?.soFar?.sessionId}`,
      );
    } else if (view === 'earlier') {
      step(
        'run-earlier',
        response.status === 200 && Array.isArray(response.json?.chats),
        `HTTP ${response.status}`,
      );
    } else if (view === 'tasks') {
      step(
        'run-tasks',
        response.status === 200 && Array.isArray(response.json?.tasks),
        `HTTP ${response.status} tasks=${response.json?.tasks?.length}`,
      );
    } else {
      step(
        'run-questions',
        response.status === 200 && Array.isArray(response.json?.questions),
        `HTTP ${response.status}`,
      );
    }
  }

  const insertOut = execFileSync(
    'psql',
    [
      databaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
      '-c',
      `insert into workspace_artifacts (business_id, kind, title, body, state)
       values ('${companyId}', 'memory', 'Harbor audience',
               'Capability Cafe serves quiet notebook writers near the harbor.',
               'draft')
       returning id;`,
    ],
    { encoding: 'utf8' },
  ).trim();
  const memoryId = insertOut
    .split('\n')
    .map((line) => line.trim())
    .find((line) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        line,
      ),
    );
  if (!memoryId) throw new Error(`memory insert returned: ${insertOut}`);
  const searchOut = execFileSync(
    'psql',
    [
      databaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
      '-c',
      `select id from workspace_artifacts
       where business_id = '${companyId}'
         and kind = 'memory'
         and (title ilike '%harbor%' or body ilike '%harbor%')
       order by created_at desc
       limit 12;`,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  await save('memory-search.json', { memoryId, hits: searchOut });
  step(
    'memory-search',
    searchOut.includes(memoryId),
    `hits=${searchOut.length}`,
  );

  const catalogJson = execFileSync(
    'pnpm',
    [
      '--filter',
      '@brightwork/worker',
      'exec',
      'tsx',
      '-e',
      `
      import { toolDefinitions, searchToolCatalog } from './src/pip-tools.ts';
      const names = toolDefinitions.map((t) => t.name);
      const required = ['tool_search','memory_search','memory_read','draft_sms','send_sms'];
      const missing = required.filter((n) => !names.includes(n));
      const hits = searchToolCatalog('memory search');
      console.log(JSON.stringify({ size: names.length, missing, hits: hits.map((h) => h.name) }));
      `,
    ],
    { cwd: root, encoding: 'utf8', env: process.env },
  ).trim();
  const catalog = JSON.parse(
    catalogJson
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .at(-1),
  );
  await save('catalog.json', catalog);
  step(
    'tool-catalog',
    catalog.missing.length === 0 && catalog.hits.includes('memory_search'),
    catalog.missing.length
      ? `missing=${catalog.missing.join(',')}`
      : `tools=${catalog.size}`,
  );

  results.ok = true;
  log('pip-capability-expansion ok');
} catch (error) {
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  log(`ERROR ${results.error}`);
}

await save('drive-pip-capability.json', results);
await save(
  'note.md',
  [
    `# pip-capability-expansion`,
    '',
    `SHA: ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`,
    `APP_ORIGIN: ${origin}`,
    `ok: ${results.ok}`,
    '',
    ...note,
    '',
  ].join('\n'),
);

process.exit(results.ok ? 0 : 1);
