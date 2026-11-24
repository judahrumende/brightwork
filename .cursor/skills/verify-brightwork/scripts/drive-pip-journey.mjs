#!/usr/bin/env node
/**
 * Drive Brightwork pip-core-journey against an owned verify stack.
 * Calls the same /api/* routes as the workbench, via VERIFY_API_BASE (API direct)
 * so Vite need not stay up under Ollama memory pressure.
 * Verification scaffolding.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const origin = process.env.APP_ORIGIN;
const out = process.env.VERIFY_ROOT;
const apiPort = process.env.API_PORT;
const databaseUrl = process.env.DATABASE_URL;
const apiBase =
  process.env.VERIFY_API_BASE || `http://127.0.0.1:${apiPort || ''}`;
const siteBase = process.env.SITE_BASE_DOMAIN || `127.0.0.1.nip.io:${apiPort}`;

if (!origin || !out || !apiPort) {
  console.error('APP_ORIGIN, VERIFY_ROOT, and API_PORT required');
  process.exit(1);
}

await mkdir(out, { recursive: true });

const tab = randomUUID();
const cookieJar = new Map();
const note = [];
const results = { feature: 'pip-core-journey', ok: false, steps: [] };

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
  const response = await fetch(`${apiBase}${urlPath}`, {
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

async function waitForApi({ maxMs = 120_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const response = await fetch(`${apiBase}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = await response.text();
        if (body.includes('"status":"ok"')) return;
      }
    } catch {
      /* restart loop may be bringing API back */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`API at ${apiBase} did not recover within ${maxMs}ms`);
}

async function apiWithRetry(method, urlPath, body, { retries = 40 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await waitForApi({ maxMs: 15_000 }).catch(() => undefined);
      return await api(method, urlPath, body);
    } catch (error) {
      lastError = error;
      log(`retry ${method} ${urlPath} (${attempt + 1}/${retries}): ${error}`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  throw lastError;
}

async function turnStateFromDb(turnId) {
  if (!databaseUrl) return null;
  try {
    const { stdout } = await execFileAsync(
      'psql',
      [
        databaseUrl,
        '-Atc',
        `SELECT state FROM agent_turns WHERE id = '${turnId}'`,
      ],
      { timeout: 5_000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function questionFromDb(companyId) {
  if (!databaseUrl) return null;
  try {
    const { stdout } = await execFileAsync(
      'psql',
      [
        databaseUrl,
        '-Atc',
        `SELECT id || '|' || coalesce(title,'') FROM workspace_artifacts
         WHERE business_id = '${companyId}' AND kind = 'question'
           AND answer IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      ],
      { timeout: 5_000 },
    );
    const line = stdout.trim();
    if (!line) return null;
    const [id, title] = line.split('|');
    return { id, title, kind: 'question', answered: false };
  } catch {
    return null;
  }
}

async function waitTurn(
  companyId,
  turnId,
  { maxMs = 900_000, label = 'turn' } = {},
) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    let state = 'unknown';
    let turn = null;
    try {
      const { status, json } = await api(
        'GET',
        `/api/companies/${companyId}/pip/turns`,
      );
      if (status === 200) {
        turn = (json.turns || []).find((t) => t.id === turnId) || null;
        state = turn?.status || 'missing';
      }
    } catch {
      state = (await turnStateFromDb(turnId)) || 'api-down';
      log(`${label} api-down; db state=${state}`);
    }
    if (state !== 'api-down') log(`${label} status=${state}`);
    if (state === 'completed' || state === 'failed') {
      await save(`${label}-final.json`, turn || { id: turnId, status: state });
      if (state === 'failed') {
        throw new Error(`${label} failed`);
      }
      return turn || { id: turnId, status: state };
    }
    let question = null;
    try {
      const work = await api('GET', `/api/companies/${companyId}/work/summary`);
      question = (work.json?.items || []).find(
        (i) => i.kind === 'question' && !i.answered,
      );
    } catch {
      question = await questionFromDb(companyId);
    }
    if (question && label.startsWith('ask')) {
      log(`${label} waiting on question ${question.id}`);
      await save(`${label}-waiting.json`, { turn, question });
      return { ...(turn || { id: turnId }), waitingQuestion: question };
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error(`${label} timed out after ${maxMs}ms`);
}

async function workSummary(companyId) {
  await waitForApi();
  const { status, json } = await apiWithRetry(
    'GET',
    `/api/companies/${companyId}/work/summary`,
  );
  if (status !== 200) throw new Error(`work/summary HTTP ${status}`);
  await save('work-summary.json', json);
  return json.items || [];
}

try {
  log('session');
  const session = await api('POST', '/api/me/session', {});
  await save('session.json', session.json);
  if (session.status < 200 || session.status >= 300) {
    throw new Error(
      `session HTTP ${session.status}: ${session.text.slice(0, 200)}`,
    );
  }
  results.steps.push({ step: 'session', ok: true });

  const name = `Verify Notes ${Date.now().toString(36)}`;
  const idea =
    'A calm notebook for independent cafe owners to track weekly specials, supplier notes, and a simple public menu page.';
  const beginReq = randomUUID();
  log(`begin ${name}`);
  const begin = await api('POST', '/api/me/companies/begin', {
    startRequestId: beginReq,
    name,
    idea,
  });
  await save('begin.json', begin.json);
  if (begin.status < 200 || begin.status >= 300) {
    throw new Error(`begin HTTP ${begin.status}: ${begin.text.slice(0, 300)}`);
  }
  const companyId = begin.json?.company?.id;
  if (!companyId) throw new Error('begin missing company.id');
  await save('company_id.txt', companyId);
  results.steps.push({ step: 'begin', ok: true, companyId });

  const planPrompt =
    'Use my saved business idea to draft a short launch plan and a simple multi-page website. Save the plan with write_document, then use build to save a homepage plus an about page and a menu page as a draft for review. Use only details provided and ask me about any decision that would materially change the plan. Do not publish yet.';
  log('plan+build turn');
  const turn = await api('POST', `/api/companies/${companyId}/pip/turns`, {
    requestId: beginReq,
    prompt: planPrompt,
  });
  await save('turn-plan.json', turn.json);
  if (turn.status !== 200 && turn.status !== 201 && turn.status !== 202) {
    throw new Error(`turn HTTP ${turn.status}: ${turn.text.slice(0, 300)}`);
  }
  const turnId = turn.json?.id;
  if (!turnId) throw new Error('turn missing id');
  await waitTurn(companyId, turnId, { label: 'plan' });

  let items = await workSummary(companyId);
  const document = items.find((i) => i.kind === 'document');
  let website = items.find((i) => i.kind === 'website');
  if (!document) throw new Error('expected plan document in work/summary');
  if (!website) throw new Error('expected website draft in work/summary');
  results.steps.push({
    step: 'plan-build',
    ok: true,
    documentId: document.id,
    websiteId: website.id,
    revision: website.revision,
  });

  log(`approve website ${website.id} rev ${website.revision}`);
  const approve = await api(
    'POST',
    `/api/companies/${companyId}/work/${website.id}/decision`,
    { approve: true, revision: website.revision },
  );
  await save('approve.json', approve.json);
  if (approve.status !== 200) {
    throw new Error(
      `approve HTTP ${approve.status}: ${approve.text.slice(0, 300)}`,
    );
  }
  results.steps.push({ step: 'approve', ok: true });

  log('publish');
  const publish = await api(
    'POST',
    `/api/companies/${companyId}/work/${website.id}/publish`,
    { publish: true, revision: website.revision },
  );
  await save('publish.json', publish.json);
  if (publish.status !== 200) {
    throw new Error(
      `publish HTTP ${publish.status}: ${publish.text.slice(0, 300)}`,
    );
  }
  results.steps.push({ step: 'publish', ok: true });

  const liveHost = `${website.id}.${siteBase}`;
  const liveUrl = `http://${liveHost}/`;
  log(`live fetch ${liveUrl}`);
  let liveStatus = 0;
  let liveHtml = '';
  try {
    const live = await fetch(liveUrl, { redirect: 'follow' });
    liveStatus = live.status;
    liveHtml = await live.text();
  } catch {
    const live = await fetch(`http://127.0.0.1:${apiPort}/`, {
      headers: { Host: liveHost },
    });
    liveStatus = live.status;
    liveHtml = await live.text();
  }
  await save('live-home.html', liveHtml);
  await save('live-meta.json', { url: liveUrl, status: liveStatus });
  if (liveStatus !== 200) throw new Error(`live site HTTP ${liveStatus}`);
  results.steps.push({
    step: 'live',
    ok: true,
    status: liveStatus,
    url: liveUrl,
  });

  // Record a visit for traffic proof (second fetch)
  await fetch(liveUrl).catch(() =>
    fetch(`http://127.0.0.1:${apiPort}/`, { headers: { Host: liveHost } }),
  );
  // API ignores unused range query params; keep the path aligned with the route.
  const traffic = await api('GET', `/api/companies/${companyId}/traffic`);
  await save('traffic.json', traffic.json);
  results.steps.push({
    step: 'traffic',
    ok: traffic.status === 200,
    status: traffic.status,
  });

  log('ask_owner turn');
  const ask = await api('POST', `/api/companies/${companyId}/pip/turns`, {
    requestId: randomUUID(),
    prompt:
      'Use ask_owner to ask one short question about the cafe name for the menu page. Do not build or publish.',
  });
  await save('turn-ask.json', ask.json);
  if (ask.status !== 200 && ask.status !== 201 && ask.status !== 202) {
    throw new Error(`ask turn HTTP ${ask.status}`);
  }
  const askTurn = await waitTurn(companyId, ask.json.id, {
    label: 'ask',
    maxMs: 600_000,
  });
  items = await workSummary(companyId);
  let question =
    askTurn?.waitingQuestion ||
    items.find((i) => i.kind === 'question' && !i.answered);
  if (!question) {
    // completed ask may have answered=false until we POST
    question = items.find((i) => i.kind === 'question');
  }
  if (!question) throw new Error('expected question work item from ask_owner');

  log(`answer question ${question.id}`);
  const answer = await api(
    'POST',
    `/api/companies/${companyId}/work/${question.id}/answer`,
    { answer: `${name} Cafe` },
  );
  await save('answer.json', answer.json);
  if (answer.status !== 200) {
    throw new Error(
      `answer HTTP ${answer.status}: ${answer.text.slice(0, 300)}`,
    );
  }
  results.steps.push({ step: 'answer', ok: true, questionId: question.id });

  const changeCssRules =
    'HTML/CSS only: system fonts, gradients, inline SVG. Do not use CSS url(), @import, external fonts, scripts, forms, iframes, or remote images.';
  const changePrompt = (extra = '') =>
    `Update the existing website with build targetId ${website.id}. Add one short Welcome line that mentions ${name} Cafe on the homepage HTML. Keep about and menu pages. ${changeCssRules} Do not publish.${extra}`;

  async function requestChange(label, prompt) {
    const change = await api('POST', `/api/companies/${companyId}/pip/turns`, {
      requestId: randomUUID(),
      prompt,
    });
    await save(`${label}.json`, change.json);
    if (
      change.status !== 200 &&
      change.status !== 201 &&
      change.status !== 202
    ) {
      throw new Error(`${label} HTTP ${change.status}`);
    }
    try {
      await waitTurn(companyId, change.json.id, {
        label: label.replace(/^turn-/, ''),
        maxMs: 900_000,
      });
      return true;
    } catch (error) {
      log(`${label} failed: ${error}`);
      return false;
    }
  }

  log('change turn');
  let changeOk = await requestChange('turn-change', changePrompt());
  if (!changeOk) {
    log('change turn retry (CSS verification)');
    changeOk = await requestChange(
      'turn-change-retry',
      changePrompt(
        ' Previous draft failed verification because of CSS url()/@import — regenerate without those.',
      ),
    );
  }
  if (!changeOk) throw new Error('change failed after retry');

  items = await workSummary(companyId);
  website = items.find((i) => i.kind === 'website');
  if (!website || website.revision < 2) {
    throw new Error(
      `expected website revision >= 2, got ${website?.revision ?? 'none'}`,
    );
  }

  log(`approve+publish rev ${website.revision}`);
  const approve2 = await api(
    'POST',
    `/api/companies/${companyId}/work/${website.id}/decision`,
    { approve: true, revision: website.revision },
  );
  await save('approve2.json', approve2.json);
  if (approve2.status !== 200) {
    throw new Error(`approve2 HTTP ${approve2.status}`);
  }
  const publish2 = await api(
    'POST',
    `/api/companies/${companyId}/work/${website.id}/publish`,
    { publish: true, revision: website.revision },
  );
  await save('publish2.json', publish2.json);
  if (publish2.status !== 200) {
    throw new Error(`publish2 HTTP ${publish2.status}`);
  }
  const live2 = await fetch(liveUrl).catch(() =>
    fetch(`http://127.0.0.1:${apiPort}/`, { headers: { Host: liveHost } }),
  );
  await save('live2-meta.json', { status: live2.status });
  if (live2.status !== 200) throw new Error(`live2 HTTP ${live2.status}`);

  results.steps.push({
    step: 'change-approve-publish',
    ok: true,
    revision: website.revision,
  });
  results.ok = true;
  results.companyId = companyId;
  results.websiteId = website.id;
  results.liveUrl = liveUrl;
} catch (error) {
  results.ok = false;
  results.error = String(error);
  log(`ERROR ${error}`);
}

await save('drive-pip-journey.json', results);
await save(
  'note.md',
  [
    '# pip-core-journey',
    '',
    `- feature: pip-core-journey`,
    `- ok: ${results.ok}`,
    `- APP_ORIGIN: ${origin}`,
    `- LLM_MODEL: ${process.env.LLM_MODEL || 'qwen2.5:7b-instruct'}`,
    '',
    '## Log',
    ...note.map((l) => `- ${l}`),
    '',
  ].join('\n'),
);

if (!results.ok) {
  console.error(results.error || 'journey failed');
  process.exit(1);
}
console.log('pip-core-journey ok');
