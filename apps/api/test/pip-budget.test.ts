import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  initializePipBudget,
  PIP_BASE_URL,
  PIP_MODEL,
  pipBudget,
  setPipBudgetCap,
} from '../src/pip-budget.ts';

const key = 'test-brightwork-key';
const day = 86_400_000;
const monday = Date.parse('2026-11-23T00:00:00Z');
const reset = monday + day * 7;
const body = {
  messages: [{ role: 'user', content: 'Pip, draft a plan' }],
  max_tokens: 8192,
};
const signal = new AbortController().signal;
const approval = {
  tag: 'pareto-inference/nvfp4',
  provider_name: 'Pareto Inference',
  model_id: PIP_MODEL,
  service_tier: null,
  status: 0,
  context_length: 1_048_576,
  max_completion_tokens: 131072,
  supported_parameters: [
    'max_tokens',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'response_format',
    'structured_outputs',
  ],
  pricing: {
    prompt: '0.0000000375',
    completion: '0.000000125',
    input_cache_read: '0.0000000075',
    discount: 0,
  },
};
const completed = {
  id: 'gen-test',
  model: PIP_MODEL,
  object: 'chat.completion',
  choices: [{ finish_reason: 'stop', message: { content: 'Draft' } }],
  usage: {
    cost: 0.001,
    is_byok: false,
    prompt_tokens: 100,
    completion_tokens: 100,
  },
  openrouter_metadata: {
    requested: PIP_MODEL,
    attempt: 1,
    is_byok: false,
    endpoints: {
      available: [
        { selected: true, provider: 'Pareto Inference', model: PIP_MODEL },
      ],
    },
  },
};

function setup(directory: string) {
  const ledgerPath = join(directory, 'pip-budget.sqlite');
  const fake = {
    now: monday + day,
    providerDate: null as number | null,
    reset,
    limit: 3,
    observed: 0,
    label: 'Brightwork',
    omitKeyBudget: false,
    keyFailure: false,
    catalog: [approval],
    posts: [] as RequestInit[],
    finish: async () => Response.json(completed, { headers: date() }),
  };
  function date() {
    return { Date: new Date(fake.providerDate ?? fake.now).toUTCString() };
  }
  const request: typeof fetch = async (url, init) => {
    assert.ok(init);
    assert.equal(init.redirect, 'error');
    if (url === `${PIP_BASE_URL}/models/${PIP_MODEL}/endpoints`) {
      assert.equal(init.method, 'GET');
      assert.equal(new Headers(init.headers).has('Authorization'), false);
      return Response.json({
        data: { id: PIP_MODEL, endpoints: fake.catalog },
      });
    }
    if (url === `${PIP_BASE_URL}/key`) {
      assert.equal(init.method, 'GET');
      if (fake.keyFailure) throw new Error(`upstream error ${key}`);
      const budget = {
        scope: 'key_limit',
        guardrail_id: null,
        budget_id: null,
        limit_usd: fake.limit,
        spend_usd: fake.observed,
        remaining_usd: fake.limit - fake.observed,
        reset_interval: 'weekly',
        resets_at: new Date(fake.reset).toISOString(),
        include_byok: false,
      };
      return Response.json(
        {
          data: {
            label: fake.label,
            is_management_key: false,
            limit: fake.limit,
            limit_reset: 'weekly',
            limit_remaining: budget.remaining_usd,
            include_byok_in_limit: false,
            usage: fake.observed,
            usage_weekly: fake.observed,
            byok_usage: 0,
            byok_usage_weekly: 0,
            budgets: fake.omitKeyBudget ? [] : [budget],
            effective_budget: budget,
          },
        },
        { headers: date() },
      );
    }
    assert.equal(url, `${PIP_BASE_URL}/chat/completions`);
    assert.equal(init.method, 'POST');
    fake.posts.push(init);
    return fake.finish();
  };
  const dependencies = { ledgerPath, now: () => fake.now };
  const client = (override = key) => pipBudget(override, request, dependencies);
  return {
    fake,
    ledgerPath,
    client,
    request,
    initialize: () => initializePipBudget(key, request, dependencies),
  };
}

function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'pip-budget-'));
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return setup(directory);
}

test('valid request sends exactly one pinned POST and a consumable completion', async (t) => {
  const { fake, client, initialize } = fixture(t);
  await initialize();
  const response = await client()(
    {
      ...body,
      tools: [
        {
          type: 'function',
          function: {
            name: 'draft',
            description: 'Draft',
            parameters: { type: 'object' },
          },
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'draft', schema: { type: 'object' } },
      },
    },
    signal,
  );
  assert.equal((await response.json()).choices[0].message.content, 'Draft');
  assert.equal(fake.posts.length, 1);
  const sent = JSON.parse(String(fake.posts[0]?.body));
  assert.equal(sent.model, PIP_MODEL);
  assert.equal(sent.max_tokens, 8192);
  assert.equal(sent.stream, false);
  assert.equal(sent.parallel_tool_calls, false);
  assert.deepEqual(sent.provider, {
    only: [approval.tag],
    order: [approval.tag],
    allow_fallbacks: false,
    require_parameters: true,
    max_price: {
      prompt: '0.0375',
      completion: '0.125',
      request: '0',
      image: '0',
      audio: '0',
    },
  });
  assert.ok(
    sent.plugins.every(
      (plugin: { enabled?: boolean }) => plugin.enabled === false,
    ),
  );
});

test('initialization accepts OpenRouter masked key identifiers', async (t) => {
  const { fake, initialize } = fixture(t);
  fake.label = 'sk-or-v1-masked-fixture';
  await initialize();
  assert.equal(fake.posts.length, 0);
});

test('no POST on missing, foreign, open, or corrupted ledger; owner initialization never overwrites', async (t) => {
  const { fake, ledgerPath, client, initialize } = fixture(t);
  await assert.rejects(client()(body, signal));
  await initialize();
  await assert.rejects(initialize());
  await assert.rejects(client('other-key')(body, signal));
  chmodSync(ledgerPath, 0o644);
  await assert.rejects(client()(body, signal));
  chmodSync(ledgerPath, 0o600);
  writeFileSync(ledgerPath, 'not a database');
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 0);
});

test('no POST on non-text, unbounded calls, or caller-controlled routing', async (t) => {
  const { fake, client, initialize } = fixture(t);
  await initialize();
  for (const invalid of [
    {
      ...body,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'https://example.org' } },
          ],
        },
      ],
    },
    { ...body, messages: [{ role: 'user', content: '日'.repeat(90_000) }] },
    { ...body, max_tokens: 8193 },
    { ...body, model: 'openrouter/auto', plugins: [{ id: 'web' }] },
    { ...body, tools: [{ type: 'web_search' }] },
  ])
    await assert.rejects(client()(invalid, signal));
  assert.equal(fake.posts.length, 0);
});

test('no POST on changed route, ambiguous route, surprise fee, context growth, unsupported parameters or overprice', async (t) => {
  const { fake, client, initialize } = fixture(t);
  await initialize();
  for (const catalog of [
    [],
    [approval, { ...approval, tag: `${approval.tag}/us` }],
    [{ ...approval, pricing: { ...approval.pricing, request: '0.1' } }],
    [
      {
        ...approval,
        pricing: { ...approval.pricing, completion: '0.00000125' },
      },
    ],
    [
      {
        ...approval,
        pricing: { ...approval.pricing, input_cache_write: '0.00000005' },
      },
    ],
    [{ ...approval, context_length: 1_048_577 }],
    [{ ...approval, supported_parameters: [] }],
  ]) {
    fake.catalog = catalog;
    await assert.rejects(client()(body, signal));
  }
  assert.equal(fake.posts.length, 0);
});

test('no POST on an invalid provider budget, unavailable accounting, or insufficient remaining', async (t) => {
  const { fake, client, initialize } = fixture(t);
  await initialize();
  fake.limit = 3.01;
  await assert.rejects(client()(body, signal));
  fake.limit = 3;
  fake.omitKeyBudget = true;
  await assert.rejects(client()(body, signal));
  fake.omitKeyBudget = false;
  fake.keyFailure = true;
  await assert.rejects(
    client()(body, signal),
    (error) =>
      error instanceof Error &&
      !error.message.includes(key) &&
      error.cause === undefined,
  );
  fake.keyFailure = false;
  fake.observed = 2.95;
  await assert.rejects(client()(body, signal));
  fake.observed = 0;
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 0);
});

test('competing clients and retries share durable full holds despite lag', async (t) => {
  const { fake, ledgerPath, client, initialize } = fixture(t);
  await initialize();
  const db = new DatabaseSync(ledgerPath);
  db.exec('UPDATE budget_state SET cap_micros = 90000');
  db.close();
  const results = await Promise.allSettled([
    client()(body, signal),
    client()(body, signal),
  ]);
  assert.equal(
    results.filter(({ status }) => status === 'fulfilled').length,
    1,
  );
  assert.equal(fake.posts.length, 1);
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 1);
});

test('completed calls retain their holds until weekly provider reconciliation', async (t) => {
  const { fake, client, initialize, ledgerPath, request } = fixture(t);
  await initialize();
  await setPipBudgetCap(key, 0.1, request, {
    ledgerPath,
    now: () => fake.now,
  });
  await client()(body, signal);
  await assert.rejects(client()(body, signal));
  await assert.rejects(
    setPipBudgetCap(key, 0.01, request, { ledgerPath, now: () => fake.now }),
  );
  await assert.rejects(
    setPipBudgetCap(key, 3.01, request, { ledgerPath, now: () => fake.now }),
  );
  assert.equal(fake.posts.length, 1);
});

test('cap changes persist provider usage high-water marks across delayed reports', async (t) => {
  const { fake, client, initialize, ledgerPath, request } = fixture(t);
  await initialize();
  fake.observed = 0.15;
  await setPipBudgetCap(key, 0.2, request, { ledgerPath, now: () => fake.now });
  fake.observed = 0;
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 0);
});

test('unrecognized successful responses permanently block further inference', async (t) => {
  const { fake, client, initialize } = fixture(t);
  await initialize();
  fake.finish = async () => Response.json({ choices: [] });
  await assert.rejects(client()(body, signal));
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 1);
});

test('rollover follows provider time and scopes reservations to each provider week', async (t) => {
  const { fake, ledgerPath, client, initialize } = fixture(t);
  await initialize();
  const db = new DatabaseSync(ledgerPath);
  db.exec('UPDATE budget_state SET cap_micros = 180000');
  db.close();
  await client()(body, signal);
  const finish = fake.finish;
  fake.finish = async () => {
    throw new Error('connection lost');
  };
  await assert.rejects(client()(body, signal));
  fake.finish = finish;
  assert.equal(fake.posts.length, 2);
  fake.now = reset - 60_000;
  await assert.rejects(client()(body, signal));
  fake.now = reset + 60_000;
  fake.reset = reset + day * 7;
  await assert.rejects(client()(body, signal));
  fake.now = reset + day;
  fake.providerDate = reset - day;
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 2);
  fake.providerDate = null;
  await client()(body, signal);
  await client()(body, signal);
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 4);
  fake.now += day * 7;
  fake.reset += day * 7;
  await client()(body, signal);
  await client()(body, signal);
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 6);
});

test('a terminal response crossing rollover cannot settle its old-week hold', async (t) => {
  const { fake, ledgerPath, client, initialize } = fixture(t);
  await initialize();
  const db = new DatabaseSync(ledgerPath);
  db.exec('UPDATE budget_state SET cap_micros = 90000');
  db.close();
  const finish = fake.finish;
  fake.finish = async () => {
    fake.now = reset + day;
    fake.reset = reset + day * 7;
    return finish();
  };
  await assert.rejects(client()(body, signal));
  await client()(body, signal);
  await assert.rejects(client()(body, signal));
  assert.equal(fake.posts.length, 2);
});
