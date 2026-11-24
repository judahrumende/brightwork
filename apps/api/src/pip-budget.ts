import { createHash, randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PIP_BASE_URL, PIP_MODEL } from './pip-routing.ts';

export { PIP_BASE_URL, PIP_MODEL } from './pip-routing.ts';

const route = 'pareto-inference/nvfp4';
const providerName = 'Pareto Inference';
const promptPrice = 0.0375;
const completionPrice = 0.125;
const usdScale = 1_000_000;
const cap = 3 * usdScale;
const maxContext = 1_048_576;
const maxOutput = 8_192;
const maxBodyBytes = 256 * 1_024;
const week = 7 * 24 * 60 * 60 * 1_000;
const rolloverBuffer = 120_000;
const maxClockSkew = 30_000;

type Body = {
  messages: readonly unknown[];
  tools?: readonly unknown[];
  response_format?: object;
  max_tokens: number;
};
type Dependencies = { ledgerPath?: string; now?: () => number };

const record = z.record(z.string(), z.unknown());
const integer = z.number().int().nonnegative();
const money = z
  .number()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER / usdScale);
const weeklyLimit = money.positive().max(3);
const toolCall = z.strictObject({
  id: z.string(),
  type: z.literal('function'),
  function: z.strictObject({ name: z.string(), arguments: z.string() }),
});
const message = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('system'), content: z.string() }),
  z.strictObject({
    role: z.literal('user'),
    content: z.union([
      z.string(),
      z
        .array(z.strictObject({ type: z.literal('text'), text: z.string() }))
        .min(1),
    ]),
  }),
  z.strictObject({
    role: z.literal('assistant'),
    content: z.string().nullable(),
    tool_calls: z.array(toolCall).optional(),
  }),
  z.strictObject({
    role: z.literal('tool'),
    content: z.string(),
    tool_call_id: z.string(),
  }),
]);
const bodySchema = z.strictObject({
  messages: z.array(message).min(1),
  tools: z
    .array(
      z.strictObject({
        type: z.literal('function'),
        function: z.strictObject({
          name: z.string(),
          description: z.string(),
          parameters: record,
        }),
      }),
    )
    .optional(),
  response_format: z
    .discriminatedUnion('type', [
      z.strictObject({ type: z.literal('json_object') }),
      z.strictObject({
        type: z.literal('json_schema'),
        json_schema: z.strictObject({
          name: z.string(),
          description: z.string().optional(),
          schema: record,
          strict: z.boolean().optional(),
        }),
      }),
    ])
    .optional(),
  max_tokens: integer.min(1).max(maxOutput),
});
const budget = z.object({
  scope: z.enum([
    'workspace_default_member',
    'workspace_default_key',
    'member',
    'api_key',
    'workspace',
    'key_limit',
  ]),
  guardrail_id: z.string().nullable(),
  budget_id: z.string().nullable(),
  limit_usd: money,
  spend_usd: money,
  remaining_usd: z.number(),
  reset_interval: z.enum(['daily', 'weekly', 'monthly']).nullable(),
  resets_at: z.iso.datetime().nullable(),
  include_byok: z.boolean(),
});
const keySchema = z.object({
  data: z.object({
    label: z.string().min(1),
    is_management_key: z.literal(false),
    limit: weeklyLimit,
    limit_reset: z.literal('weekly'),
    limit_remaining: money.max(3),
    include_byok_in_limit: z.boolean(),
    usage: money,
    usage_weekly: money,
    byok_usage: z.literal(0),
    byok_usage_weekly: z.literal(0),
    budgets: z.array(budget),
    effective_budget: budget,
  }),
});
const catalogSchema = z.object({
  data: z.object({
    id: z.literal(PIP_MODEL),
    endpoints: z.array(z.looseObject({ tag: z.string() })),
  }),
});
const routeSchema = z.object({
  model_id: z.literal(PIP_MODEL),
  provider_name: z.literal(providerName),
  service_tier: z.null(),
  status: z.literal(0),
  context_length: integer.min(1).max(maxContext),
  max_completion_tokens: integer.min(1),
  supported_parameters: z.array(z.string()),
  pricing: record,
});
const completionSchema = z.object({
  id: z.string().min(1),
  model: z.literal(PIP_MODEL),
  object: z.literal('chat.completion'),
  error: z.null().optional(),
  choices: z.tuple([
    z.object({
      finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']),
      message: z.object({
        content: z.string().nullable().optional(),
        tool_calls: z.array(toolCall).optional(),
      }),
    }),
  ]),
  openrouter_metadata: z.object({
    requested: z.literal(PIP_MODEL),
    attempt: z.literal(1),
    is_byok: z.literal(false),
    endpoints: z.object({
      available: z.array(
        z.object({
          selected: z.boolean(),
          provider: z.string(),
          model: z.string(),
        }),
      ),
    }),
    pipeline: z
      .array(
        z.object({ cost_usd: z.union([z.literal(0), z.null()]).optional() }),
      )
      .optional(),
  }),
  usage: z.object({
    cost: money,
    is_byok: z.literal(false),
    prompt_tokens: integer,
    completion_tokens: integer,
    cost_details: z
      .object({
        server_tool_cost: z.union([z.literal(0), z.null()]).optional(),
      })
      .nullish(),
    server_tool_use_details: z
      .object({
        tool_calls_requested: z.literal(0),
        tool_calls_executed: z.literal(0),
      })
      .nullish(),
    deferred_tools_details: z.null().optional(),
  }),
});

function demand(condition: unknown): asserts condition {
  if (!condition)
    throw new Error('Pip OpenRouter budget guard rejected the request');
}

function upperUsd(value: number) {
  return Math.ceil(value * usdScale);
}

function lowerUsd(value: number) {
  return Math.floor(value * usdScale);
}

function providerDate(response: Response, now: number) {
  const date = response.headers.get('date');
  const timestamp = Date.parse(date ?? '');
  demand(
    date &&
      Number.isSafeInteger(timestamp) &&
      new Date(timestamp).toUTCString() === date,
  );
  demand(
    Math.abs(now - timestamp) <= maxClockSkew &&
      (response.headers.get('age') ?? '0') === '0',
  );
  return timestamp;
}

function assertWindow(reset: number, time: number) {
  demand(time > reset - week + rolloverBuffer && time < reset - rolloverBuffer);
}

async function keySnapshot(
  request: typeof fetch,
  key: string,
  signal: AbortSignal,
  now: () => number,
) {
  const response = await get(request, '/key', signal, key);
  const { data } = keySchema.parse(await response.json());
  const timestamp = providerDate(response, now());
  const entries = data.budgets.filter((entry) => entry.scope === 'key_limit');
  const entry = entries[0];
  demand(
    entries.length === 1 &&
      entry &&
      entry.reset_interval === 'weekly' &&
      entry.resets_at,
  );
  demand(
    entry.guardrail_id === null &&
      entry.budget_id === null &&
      entry.limit_usd === data.limit,
  );
  demand(
    entry.include_byok === data.include_byok_in_limit &&
      data.usage >= data.usage_weekly,
  );
  const reset = Date.parse(entry.resets_at);
  const resetsOn = new Date(reset);
  demand(resetsOn.getUTCDay() === 1 && reset % 86_400_000 === 0);
  assertWindow(reset, timestamp);
  assertWindow(reset, now());

  const layers = [...data.budgets, data.effective_budget];
  for (const layer of layers) {
    demand(
      Math.abs(layer.limit_usd - layer.spend_usd - layer.remaining_usd) <
        0.000001,
    );
    if (layer.scope === 'key_limit') {
      demand(
        layer.limit_usd === entry.limit_usd &&
          layer.resets_at === entry.resets_at &&
          layer.reset_interval === 'weekly' &&
          layer.include_byok === entry.include_byok,
      );
    }
  }

  const limit = lowerUsd(data.limit);
  const remaining = lowerUsd(
    Math.min(
      data.limit_remaining,
      ...layers.map((layer) => layer.remaining_usd),
    ),
  );
  demand(data.limit_remaining <= data.limit);
  const observed = upperUsd(
    Math.max(
      data.usage_weekly,
      entry.spend_usd,
      data.limit - data.limit_remaining,
      ...layers
        .filter((layer) => layer.scope === 'key_limit')
        .map((layer) => layer.spend_usd),
    ),
  );
  return {
    reset,
    timestamp,
    limit,
    remaining,
    observed,
    lifetime: upperUsd(data.usage),
  };
}

async function get(
  request: typeof fetch,
  path: string,
  signal: AbortSignal,
  key?: string,
) {
  const response = await request(`${PIP_BASE_URL}${path}`, {
    method: 'GET',
    ...(key
      ? {
          headers: {
            Authorization: `Bearer ${key}`,
            'Cache-Control': 'no-cache',
          },
        }
      : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  demand(response.ok);
  return response;
}

async function tariff(
  request: typeof fetch,
  body: z.infer<typeof bodySchema>,
  signal: AbortSignal,
) {
  const response = await get(request, `/models/${PIP_MODEL}/endpoints`, signal);
  const { data } = catalogSchema.parse(await response.json());
  const candidates = data.endpoints.filter(
    ({ tag }) => tag === route || tag.startsWith(`${route}/`),
  );
  demand(candidates.length === 1 && candidates[0]?.tag === route);
  const endpoint = routeSchema.parse(candidates[0]);
  demand(
    endpoint.max_completion_tokens >= body.max_tokens &&
      endpoint.context_length >= body.max_tokens,
  );
  const required = ['max_tokens'];
  if (body.tools?.length)
    required.push('tools', 'tool_choice', 'parallel_tool_calls');
  if (body.response_format) required.push('response_format');
  if (body.response_format?.type === 'json_schema')
    required.push('structured_outputs');
  demand(
    required.every((parameter) =>
      endpoint.supported_parameters.includes(parameter),
    ),
  );
  demand(
    endpoint.pricing.prompt === '0.0000000375' &&
      endpoint.pricing.completion === '0.000000125',
  );
  for (const [dimension, price] of Object.entries(endpoint.pricing)) {
    if (dimension === 'prompt' || dimension === 'completion') continue;
    if (dimension === 'discount') {
      demand(typeof price === 'number' && price >= 0 && price <= 1);
    } else {
      demand(
        dimension === 'input_cache_read' || dimension === 'input_cache_write',
      );
      demand(typeof price === 'string' && /^\d+(?:\.\d+)?$/u.test(price));
      demand(Number(price) <= promptPrice / usdScale);
    }
  }
  const hold =
    Math.ceil(
      2 *
        (endpoint.context_length * promptPrice +
          body.max_tokens * completionPrice),
    ) + 1_000;
  return { hold, context: endpoint.context_length };
}

const stateSchema = z.object({
  fingerprint: z.string(),
  cap_micros: integer.min(1).max(cap),
  reset: integer,
  seen_at: integer,
  observed: integer,
  lifetime: integer,
  blocked: z.literal(0),
});

function assertPrivate(path: string, directory: boolean) {
  const stat = lstatSync(path);
  demand(stat.uid === userInfo().uid && (stat.mode & 0o077) === 0);
  demand(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1);
}

function transaction<T>(path: string, work: (db: DatabaseSync) => T) {
  demand(isAbsolute(path));
  assertPrivate(dirname(path), true);
  assertPrivate(path, false);
  const db = new DatabaseSync(path);
  try {
    db.exec(
      'PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA busy_timeout = 3000;',
    );
    demand(db.prepare('PRAGMA journal_mode').get()?.journal_mode === 'delete');
    db.exec('BEGIN IMMEDIATE');
    demand(db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok');
    const result = work(db);
    db.exec('COMMIT');
    return result;
  } finally {
    db.close();
  }
}

function state(db: DatabaseSync, fingerprint: string) {
  const row = stateSchema.parse(
    db.prepare('SELECT * FROM budget_state WHERE id = 1').get(),
  );
  demand(row.fingerprint === fingerprint);
  return row;
}

function installation(key: string, dependencies: Dependencies) {
  demand(Boolean(key) && key.trim() === key && !/\s/u.test(key));
  return {
    fingerprint: createHash('sha256').update(key).digest('hex'),
    path:
      dependencies.ledgerPath ??
      join(homedir(), '.brightwork', 'pip-budget.sqlite'),
    now: dependencies.now ?? Date.now,
  };
}

export async function initializePipBudget(
  key: string,
  request: typeof fetch = fetch,
  dependencies: Dependencies = {},
): Promise<void> {
  try {
    const { fingerprint, path, now } = installation(key, dependencies);
    const snapshot = await keySnapshot(
      request,
      key,
      AbortSignal.timeout(10_000),
      now,
    );
    demand(
      snapshot.lifetime === 0 &&
        snapshot.observed === 0 &&
        snapshot.remaining > 0 &&
        isAbsolute(path),
    );
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    assertPrivate(dirname(path), true);
    closeSync(openSync(path, 'wx', 0o600));
    transaction(path, (db) => {
      db.exec(`
        CREATE TABLE budget_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          fingerprint TEXT NOT NULL,
          cap_micros INTEGER NOT NULL DEFAULT 3000000 CHECK (cap_micros BETWEEN 1 AND 3000000),
          reset INTEGER NOT NULL,
          seen_at INTEGER NOT NULL,
          observed INTEGER NOT NULL CHECK (observed >= 0),
          lifetime INTEGER NOT NULL CHECK (lifetime >= 0),
          blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1))
        ) STRICT;
        CREATE TABLE reservation (
          id TEXT PRIMARY KEY,
          reset INTEGER NOT NULL,
          micros INTEGER NOT NULL CHECK (micros BETWEEN 1 AND 3000000),
          completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1))
        ) STRICT;
      `);
      db.prepare(
        'INSERT INTO budget_state (id, fingerprint, reset, seen_at, observed, lifetime) VALUES (1, ?, ?, ?, ?, ?)',
      ).run(
        fingerprint,
        snapshot.reset,
        snapshot.timestamp,
        snapshot.observed,
        snapshot.lifetime,
      );
    });
  } catch {
    throw new Error(
      'Pip OpenRouter budget initialization failed; no inference was sent',
    );
  }
}

export async function setPipBudgetCap(
  key: string,
  amount: number,
  request: typeof fetch = fetch,
  dependencies: Dependencies = {},
): Promise<void> {
  try {
    const capMicros = upperUsd(weeklyLimit.parse(amount));
    const { fingerprint, path, now } = installation(key, dependencies);
    const snapshot = await keySnapshot(
      request,
      key,
      AbortSignal.timeout(10_000),
      now,
    );
    demand(capMicros <= snapshot.limit && capMicros <= cap);
    transaction(path, (db) => {
      const prior = state(db, fingerprint);
      demand(
        snapshot.reset >= prior.reset && snapshot.timestamp >= prior.seen_at,
      );
      assertWindow(snapshot.reset, now());
      const outstanding = integer.parse(
        db
          .prepare(
            'SELECT COALESCE(SUM(micros), 0) AS total FROM reservation WHERE reset = ?',
          )
          .get(snapshot.reset)?.total,
      );
      const observed =
        snapshot.reset > prior.reset
          ? snapshot.observed
          : Math.max(prior.observed, snapshot.observed);
      demand(observed + outstanding <= capMicros);
      if (snapshot.reset > prior.reset)
        db.prepare(
          'DELETE FROM reservation WHERE completed = 1 AND reset < ?',
        ).run(snapshot.reset);
      db.prepare(
        'UPDATE budget_state SET cap_micros = ?, reset = ?, seen_at = ?, observed = ?, lifetime = ? WHERE id = 1',
      ).run(
        capMicros,
        snapshot.reset,
        snapshot.timestamp,
        observed,
        Math.max(prior.lifetime, snapshot.lifetime),
      );
    });
  } catch {
    throw new Error('Pip weekly cap was not changed');
  }
}

function reserve(
  path: string,
  fingerprint: string,
  snapshot: Awaited<ReturnType<typeof keySnapshot>>,
  now: () => number,
  hold: number,
  signal: AbortSignal,
) {
  return transaction(path, (db) => {
    const prior = state(db, fingerprint);
    const { reset, timestamp, limit, remaining } = snapshot;
    demand(reset >= prior.reset && timestamp >= prior.seen_at);
    assertWindow(reset, now());
    demand(Math.abs(now() - timestamp) <= maxClockSkew);
    signal.throwIfAborted();
    const observed = Math.max(
      reset === prior.reset ? prior.observed : 0,
      snapshot.observed,
    );
    const lifetime = Math.max(prior.lifetime, snapshot.lifetime);
    db.prepare(
      'UPDATE budget_state SET reset = ?, seen_at = ?, observed = ?, lifetime = ? WHERE id = 1',
    ).run(reset, timestamp, observed, lifetime);
    if (reset > prior.reset)
      db.prepare(
        'DELETE FROM reservation WHERE completed = 1 AND reset < ?',
      ).run(reset);
    const outstanding = integer.parse(
      db
        .prepare(
          'SELECT COALESCE(SUM(micros), 0) AS total FROM reservation WHERE reset = ?',
        )
        .get(reset)?.total,
    );
    if (
      outstanding + hold >
      Math.min(prior.cap_micros - observed, limit - observed, remaining)
    )
      return null;
    const id = randomUUID();
    db.prepare(
      'INSERT INTO reservation (id, reset, micros) VALUES (?, ?, ?)',
    ).run(id, reset, hold);
    return id;
  });
}

export function pipBudget(
  key: string,
  request: typeof fetch = fetch,
  dependencies: Dependencies = {},
) {
  return async (body: Body, signal: AbortSignal): Promise<Response> => {
    try {
      const { fingerprint, path, now } = installation(key, dependencies);
      const serialized = JSON.stringify(body);
      demand(Buffer.byteLength(serialized) <= maxBodyBytes);
      const input = bodySchema.parse(JSON.parse(serialized));
      transaction(path, (db) => state(db, fingerprint));
      signal.throwIfAborted();
      const { hold, context } = await tariff(request, input, signal);
      const snapshot = await keySnapshot(request, key, signal, now);
      const id = reserve(path, fingerprint, snapshot, now, hold, signal);
      demand(id);
      assertWindow(snapshot.reset, now());
      demand(Math.abs(now() - snapshot.timestamp) <= maxClockSkew);
      signal.throwIfAborted();

      const response = await request(`${PIP_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify({
          ...input,
          model: PIP_MODEL,
          stream: false,
          plugins: [{ id: 'context-compression', enabled: false }],
          ...(input.tools?.length
            ? { tool_choice: 'auto', parallel_tool_calls: false }
            : {}),
          provider: {
            only: [route],
            order: [route],
            allow_fallbacks: false,
            require_parameters: true,
            max_price: {
              prompt: '0.0375',
              completion: '0.125',
              request: '0',
              image: '0',
              audio: '0',
            },
          },
        }),
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
      });
      demand(response.ok);
      let wire: unknown;
      try {
        wire = await response.json();
      } catch {
        transaction(path, (db) => {
          state(db, fingerprint);
          db.exec('UPDATE budget_state SET blocked = 1 WHERE id = 1');
        });
        demand(false);
      }
      const parsed = completionSchema.safeParse(wire);
      if (!parsed.success) {
        transaction(path, (db) => {
          state(db, fingerprint);
          db.exec('UPDATE budget_state SET blocked = 1 WHERE id = 1');
        });
        demand(false);
      }
      const result = parsed.data;
      const selected = result.openrouter_metadata.endpoints.available.filter(
        (endpoint) => endpoint.selected,
      );
      const endpoint = selected[0];
      if (
        selected.length !== 1 ||
        endpoint?.provider !== providerName ||
        endpoint.model !== PIP_MODEL ||
        upperUsd(result.usage.cost) > hold ||
        result.usage.prompt_tokens > context ||
        result.usage.completion_tokens > input.max_tokens
      ) {
        transaction(path, (db) => {
          state(db, fingerprint);
          db.exec('UPDATE budget_state SET blocked = 1 WHERE id = 1');
        });
        demand(false);
      }

      const completedAt = providerDate(response, now());
      demand(completedAt >= snapshot.timestamp);
      assertWindow(snapshot.reset, completedAt);
      assertWindow(snapshot.reset, now());
      transaction(path, (db) => {
        state(db, fingerprint);
        demand(
          db
            .prepare(
              'UPDATE reservation SET completed = 1 WHERE id = ? AND reset = ? AND completed = 0',
            )
            .run(id, snapshot.reset).changes === 1,
        );
      });
      return Response.json({ choices: result.choices, usage: result.usage });
    } catch {
      throw new Error(
        'Pip OpenRouter budget guard could not safely complete the request',
      );
    }
  };
}
