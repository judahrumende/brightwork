import Fastify from 'fastify';
import { z } from 'zod';
import { authEnv } from './auth/config';
import { registerAuth } from './auth/routes';
import { parseLogLevel } from './observability/log-level';
import {
  checkReady,
  minioProbe,
  postgresProbe,
  redisProbe,
  requiredUrlProbe,
} from './observability/ready';
import { initSentry } from './observability/sentry';
import { registerWeb } from './web';

const env = z
  .object({
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_TRUST_PROXY: z.string().optional(),
    API_HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
  })
  .parse(process.env);

const sentry = await initSentry({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT,
  service: 'api',
});
if (!sentry.enabled && sentry.reason === 'missing_module')
  console.warn(
    'SENTRY_DSN is set but @sentry/node is not installed; continuing without Sentry.',
  );

const app = Fastify({
  logger: { level: parseLogLevel(env.LOG_LEVEL) },
  disableRequestLogging: true,
  ...(env.API_TRUST_PROXY ? { trustProxy: env.API_TRUST_PROXY } : {}),
});
const auth = authEnv.parse(process.env);
registerAuth(app, auth);
if (process.argv.includes('--serve-web'))
  await registerWeb(app, auth.APP_ORIGIN);
const health = z.object({ status: z.literal('ok') });

app.get('/health', async () => health.parse({ status: 'ok' }));

app.get('/ready', async (_request, reply) => {
  const probes = [
    auth.DATABASE_URL
      ? postgresProbe(auth.DATABASE_URL)
      : requiredUrlProbe('postgres', auth.DATABASE_URL),
    auth.REDIS_URL
      ? redisProbe(auth.REDIS_URL)
      : requiredUrlProbe('redis', auth.REDIS_URL),
  ];
  if (env.S3_ENDPOINT) probes.push(minioProbe(env.S3_ENDPOINT));
  const report = await checkReady(probes);
  return reply.code(report.status === 'ready' ? 200 : 503).send(report);
});

await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
