import Fastify from 'fastify';
import { z } from 'zod';
import { authEnv } from './auth/config';
import { registerAuth } from './auth/routes';

const env = z
  .object({
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_TRUST_PROXY: z.string().optional(),
    API_HOST: z.string().default('127.0.0.1'),
  })
  .parse(process.env);

const app = Fastify({
  logger: true,
  disableRequestLogging: true,
  ...(env.API_TRUST_PROXY ? { trustProxy: env.API_TRUST_PROXY } : {}),
});
registerAuth(app, authEnv.parse(process.env));
const health = z.object({ status: z.literal('ok') });

app.get('/health', async () => health.parse({ status: 'ok' }));

await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
