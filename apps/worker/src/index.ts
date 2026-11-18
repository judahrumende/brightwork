import { mediaEnv, mediaProviders } from '@brightwork/api/media-providers';
import { mediaStore } from '@brightwork/api/media-store';
import { creditConfig, creditLedger } from '@brightwork/api/credits';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import { agentQueueName, agentStore } from '@brightwork/api/agent';
import { connectDatabase } from '@brightwork/api/database';
import { runStore } from '@brightwork/api/runs';
import { taskAutomationStore } from '@brightwork/api/schedule';
import { mailStore } from '@brightwork/api/mail';
import { agentRunner } from './agent';
import { llmClient } from '@brightwork/api/llm';
import { pageReader, publicPageUrl } from '@brightwork/api/public-page';
import { webSearch } from './web-search';
import { resendMail } from './resend-mail';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    LLM_API_KEY: z.string().min(1),
    LLM_MODEL: z.string().min(1),
    LLM_BASE_URL: z.url().default('https://api.openai.com/v1'),
    APP_ORIGIN: z
      .url({ protocol: /^https?$/u })
      .default('http://127.0.0.1:5173'),
    SITE_BASE_DOMAIN: z.string().optional(),
    WEB_SEARCH_API_KEY: z.string().optional(),
    WEB_SEARCH_MODEL: z.string().optional(),
    OUTREACH_RESEND_API_KEY: z.string().optional(),
    OUTREACH_FROM_EMAIL: z.string().optional(),
  })
  .parse(process.env);
const database = connectDatabase(env.DATABASE_URL);
const cache = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const store = agentStore(database.db);
const runs = runStore(database.db);
const schedules = taskAutomationStore(database.db);
const credits = creditLedger(database.db, creditConfig.parse(process.env));
const media = mediaStore(database.db, credits);
const providers = mediaProviders(mediaEnv.parse(process.env));
const run = agentRunner(
  store,
  credits,
  llmClient({
    key: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    baseUrl: env.LLM_BASE_URL,
  }),
  env.WEB_SEARCH_API_KEY && env.WEB_SEARCH_MODEL
    ? webSearch({ key: env.WEB_SEARCH_API_KEY, model: env.WEB_SEARCH_MODEL })
    : undefined,
  pageReader(publicPageUrl(env.APP_ORIGIN, env.SITE_BASE_DOMAIN)),
);
const worker = new Worker<{ turnId: string }>(
  agentQueueName,
  async (job) => {
    const id = z.uuid().parse(job.data.turnId);
    try {
      await run(id);
    } catch {
      await store.updateTurn(
        id,
        {
          state: 'failed',
          answer:
            'Pip could not complete this request. Try again or check your provider settings.',
        },
        'running',
      );
      throw new Error('Agent turn failed');
    }
  },
  { connection: cache, concurrency: 2, maxStalledCount: 0 },
);

worker.on('failed', (job) => {
  if (!job) return;
  void store
    .updateTurn(job.data.turnId, { state: 'failed' }, 'running')
    .catch(() => {
      console.error('Could not update a failed turn');
    });
});
worker.on('error', () => {
  console.error('Agent worker error');
});

const producer = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
const queue = new Queue<{ turnId: string }>(agentQueueName, {
  connection: producer,
});
queue.on('error', () => console.error('Run dispatch queue error'));
async function dispatchTurn(turnId: string | null | undefined) {
  if (!turnId) return;
  await queue.add(
    'turn',
    { turnId },
    {
      jobId: turnId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
const stop = new AbortController();
const scheduling = (async () => {
  while (!stop.signal.aborted) {
    try {
      await dispatchTurn((await schedules.advance())?.turnId);
      for (let index = 0; index < 8 && !stop.signal.aborted; index += 1) {
        const next = await runs.advance();
        if (!next) break;
        await dispatchTurn(next.turnId);
      }
    } catch {
      if (!stop.signal.aborted)
        console.error('Run dispatch failed. Queued steps remain in Postgres.');
    }
    await delay(2_000, undefined, { signal: stop.signal }).catch(() => {});
  }
})();

const sending = (async () => {
  if (!env.OUTREACH_RESEND_API_KEY || !env.OUTREACH_FROM_EMAIL) return;
  const send = resendMail(env.OUTREACH_RESEND_API_KEY);
  const mail = mailStore(database.db);
  while (!stop.signal.aborted) {
    try {
      const attempt = await mail.claim();
      if (attempt) await mail.record(attempt, await send(attempt));
    } catch {
      if (!stop.signal.aborted)
        console.error(
          'Email delivery processing failed. Stored delivery records will be checked again.',
        );
    }
    await delay(2_000, undefined, { signal: stop.signal }).catch(() => {});
  }
})();

const generating = (async () => {
  if (!providers.kinds.length) return;
  while (!stop.signal.aborted) {
    try {
      const job = await media.claim(providers.kinds);
      if (job) await media.record(job, await providers.run(job));
    } catch {
      if (!stop.signal.aborted)
        console.error('Media processing encountered a recoverable error.');
    }
    await delay(2_000, undefined, { signal: stop.signal }).catch(() => {});
  }
})();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stop.abort();
    void Promise.all([worker.close(), queue.close()])
      .then(() => Promise.all([scheduling, sending, generating]))
      .then(async () => {
        cache.disconnect();
        producer.disconnect();
        await database.close();
      })
      .catch(() => {
        process.exitCode = 1;
      });
  });
}
