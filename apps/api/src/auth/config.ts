import { z } from 'zod';
import { inboundSecret } from '../workspace/inbound-signature';
import { searxngEndpoint } from '../research/searxng';

const optionalValue = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

export const authEnv = z.object({
  APP_ORIGIN: z.url({ protocol: /^https?$/u }).default('http://127.0.0.1:5173'),
  SITE_BASE_DOMAIN: optionalValue,
  GITHUB_SITE_WORKSPACE_ID: optionalValue.pipe(z.uuid().optional()),
  GITHUB_SITE_REPO: optionalValue.pipe(
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*\/(?!\.{1,2}$)[a-z0-9_.-]{1,100}$/iu)
      .optional(),
  ),
  GITHUB_SITE_BRANCH: optionalValue.pipe(
    z
      .string()
      .regex(/^[a-z0-9_][a-z0-9_.-]*(?:\/[a-z0-9_][a-z0-9_.-]*)*$/iu)
      .max(160)
      .optional(),
  ),
  GITHUB_SITE_TOKEN: optionalValue,
  AUTH_SECRET: optionalValue.pipe(z.string().min(32).optional()),
  DATABASE_URL: optionalValue,
  REDIS_URL: optionalValue,
  SEARXNG_BASE_URL: optionalValue.pipe(
    z
      .string()
      .refine((value) => {
        try {
          searxngEndpoint(value);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid SearXNG base URL')
      .optional(),
  ),
  LLM_API_KEY: optionalValue,
  LLM_MODEL: optionalValue,
  LLM_BASE_URL: optionalValue.pipe(z.url().optional()),
  RESEARCH_MODEL_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(45)
    .default(10),
  GROWTH_WORKSPACE_ID: optionalValue.pipe(z.uuid().optional()),
  GROWTH_META_PAGE_ID: optionalValue.pipe(
    z.string().regex(/^\d+$/u).optional(),
  ),
  GROWTH_META_PAGE_TOKEN: optionalValue,
  GROWTH_META_AD_ACCOUNT_ID: optionalValue.pipe(
    z.string().regex(/^\d+$/u).optional(),
  ),
  GROWTH_META_AD_TOKEN: optionalValue,
  GROWTH_GOOGLE_LOCATION_ID: optionalValue.pipe(
    z.string().regex(/^\d+$/u).optional(),
  ),
  GROWTH_GOOGLE_ACCESS_TOKEN: optionalValue,
  TURNSTILE_SITE_KEY: optionalValue,
  TURNSTILE_SECRET_KEY: optionalValue,
  WORKOS_CLIENT_ID: optionalValue,
  WORKOS_API_KEY: optionalValue,
  GOOGLE_CLIENT_ID: optionalValue,
  SMTP_HOST: optionalValue,
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: optionalValue,
  SMTP_PASSWORD: optionalValue,
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  MAIL_FROM: optionalValue,
  OUTREACH_RESEND_API_KEY: optionalValue,
  OUTREACH_FROM_EMAIL: optionalValue.pipe(z.email().optional()),
  INBOUND_EMAIL_DOMAIN: optionalValue.pipe(
    z
      .string()
      .toLowerCase()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u)
      .optional(),
  ),
  INBOUND_RESEND_API_KEY: optionalValue,
  INBOUND_RESEND_WEBHOOK_SECRET: optionalValue.pipe(
    z.string().min(28).regex(inboundSecret).optional(),
  ),
});
export type AuthEnv = z.infer<typeof authEnv>;
