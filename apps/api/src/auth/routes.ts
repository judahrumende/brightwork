import { creditConfig, creditLedger } from '../workspace/credits';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { agentStore } from '../workspace/agent-store';
import { registerWorkspace } from '../workspace/routes';
import { runStore } from '../workspace/run-store';
import { mailStore } from '../workspace/mail-store';
import { inboundMail } from '../workspace/inbound-mail';
import { z } from 'zod';
import { connectDatabase } from '../db/database';
import type { AuthEnv } from './config';
import { authProviders } from './providers';
import { authStore } from './store';
import type { Account, ProfileUpdate } from './store';
import { llmClient } from '../llm';
import { ResearchFailure, researchAnswer } from '../research/answer';
import { pageReader, publicPageUrl } from '../research/page';
import { siteHosting } from '../workspace/publication';
import { githubSiteSync } from '../workspace/github-site-sync';
import { teamStore } from '../workspace/team';
import { vaultStore } from '../workspace/vault';
import { domainStore } from '../workspace/domains';
import { stripeBilling } from '../workspace/stripe-billing';
import { registerResearch } from '../research/routes';
import { registerGrowth } from '../growth/routes';
import { searxngEndpoint, searxngSearch } from '../research/searxng';
import {
  browserCookie,
  challengeLifetimeSeconds,
  cookie,
  digest,
  randomToken,
  safeReturnTo,
  sameToken,
  sessionLifetimeSeconds,
} from './tokens';

const tokenShape = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const uuid = z.uuid();
const provider = z.enum(['GoogleOAuth', 'AppleOAuth']);
const tabId = uuid;
const empty = z.strictObject({});
const codeRequest = z.object({
  email,
  humanCheck: z.string().min(1).max(2048),
  signals: z.string().max(512).optional(),
});
const verifyRequest = z.object({
  email,
  attempt: uuid,
  code: z.string().regex(/^\d{6}$/u),
});
const preferences = z
  .strictObject({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    appearance: z.enum(['light', 'dark', 'system']).optional(),
    background: z.enum(['plain', 'clouds']).optional(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine(isTimezone)
      .nullable()
      .optional(),
    language: z.string().min(1).max(32).nullable().optional(),
    showPredictions: z.boolean().optional(),
    showNotificationBadges: z.boolean().optional(),
    reduceEffects: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

class AuthFailure extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const rateScript = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return {count, redis.call('TTL', KEYS[1])}
`;

function asProfile(account: Account) {
  return {
    userId: account.id,
    profile: {
      name: account.name,
      timezone: account.timezone,
      avatar: null,
      language: account.language,
      browserLanguage: account.browserLanguage,
      browserTimezone: account.browserTimezone,
      background: account.background,
      appearance: account.appearance,
      reduceEffects: account.reduceEffects,
      showPredictions: account.showPredictions,
      showNotificationBadges: account.showNotificationBadges,
    },
  };
}

function isTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function timezone(value: unknown) {
  if (typeof value !== 'string' || value.length > 100) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return 'UTC';
  }
}

function locale(value: string | undefined) {
  const language = value?.split(',')[0]?.split(';')[0]?.trim();
  try {
    return Intl.getCanonicalLocales(language)[0] ?? 'en-US';
  } catch {
    return 'en-US';
  }
}

export function registerAuth(
  app: FastifyInstance,
  env: AuthEnv,
  providerRequest?: typeof fetch,
) {
  if (!(env.DATABASE_URL && env.AUTH_SECRET && env.REDIS_URL)) {
    app.all('/api/auth/*', async (_request, reply) =>
      reply
        .code(503)
        .send({ message: 'Sign-in is unavailable in this environment.' }),
    );
    app.all('/api/me/*', async (_request, reply) =>
      reply.code(503).send({ message: 'Account services are unavailable.' }),
    );
    registerResearch(app);
    return;
  }
  const secret = env.AUTH_SECRET;
  const database = connectDatabase(env.DATABASE_URL);
  const store = authStore(database.db, secret);
  const credits = creditLedger(database.db, creditConfig.parse(process.env));
  const cache = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  });
  const auth = authProviders(env, providerRequest);
  const origin = new URL(env.APP_ORIGIN).origin;
  const secure = origin.startsWith('https:');
  const cook = (name: string) => (secure ? '__Host-' : '') + 'bw-' + name;
  const saveCookie = (
    reply: FastifyReply,
    name: string,
    value: string,
    age: number,
  ) => reply.header('Set-Cookie', cookie(cook(name), value, secure, age));
  const readCookie = (request: FastifyRequest, name: string) =>
    browserCookie(request.headers.cookie, cook(name));
  const authError = (failure: unknown, reply: FastifyReply) => {
    const status =
      failure instanceof AuthFailure
        ? failure.statusCode
        : failure instanceof z.ZodError
          ? 400
          : 503;
    const message =
      failure instanceof AuthFailure
        ? failure.message
        : status === 400
          ? 'Check the information you entered.'
          : 'This service is temporarily unavailable. Try again shortly.';
    return reply.code(status).send({ message });
  };

  const originTab = (request: FastifyRequest) => {
    if (request.headers.origin !== origin)
      throw new AuthFailure(403, 'This request must come from Brightwork.');
    return tabId.parse(request.headers['x-session-id']);
  };
  const activeSession = async (request: FastifyRequest) => {
    const token = tokenShape.safeParse(readCookie(request, 'session'));
    if (!token.success) throw new AuthFailure(401, 'Sign in to continue.');
    const active = await store.readSession(token.data);
    if (!active) throw new AuthFailure(401, 'Sign in to continue.');
    return active;
  };
  const rateWindow = async (type: string, key: string, seconds: number) => {
    const result = await cache.eval(
      rateScript,
      1,
      'brightwork:rate:' + digest(secret, type, key),
      String(seconds),
    );
    if (
      !Array.isArray(result) ||
      !Number.isSafeInteger(result[0]) ||
      !Number.isSafeInteger(result[1]) ||
      result[1] < 0
    )
      throw new AuthFailure(503, 'Rate limiting is unavailable.');
    return {
      count: result[0] as number,
      ttl: Math.max(1, result[1] as number),
    };
  };
  const allow = async (
    type: string,
    key: string,
    max: number,
    seconds: number,
  ) => {
    const { count } = await rateWindow(type, key, seconds);
    if (count > max)
      throw new AuthFailure(429, 'Too many attempts. Try again later.');
  };
  const setSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    token: string | null,
  ) => {
    if (!token)
      throw new AuthFailure(401, 'That sign-in could not be verified.');
    const previous = tokenShape.safeParse(readCookie(request, 'session'));
    if (previous.success) await store.revokeSession(previous.data);
    saveCookie(reply, 'session', token, sessionLifetimeSeconds);
    return { signedIn: true };
  };
  const profileReply = (request: FastifyRequest, reply: FastifyReply) =>
    activeSession(request)
      .then(({ account }) => asProfile(account))
      .catch((error: unknown) => authError(error, reply));

  app.addHook('onClose', async () => {
    cache.disconnect();
    await database.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    if (
      /^\/api\/(auth|me)(\/|$)/u.test(request.url) ||
      request.url.startsWith('/auth/callback')
    ) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Referrer-Policy', 'no-referrer');
    }
  });

  const workspace = agentStore(database.db);
  const team = teamStore(database.db);
  const billing =
    env.STRIPE_TEST_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_TEST_PRICE
      ? stripeBilling(database.db, {
          key: env.STRIPE_TEST_KEY,
          webhook: env.STRIPE_WEBHOOK_SECRET,
          price: env.STRIPE_TEST_PRICE,
          origin,
          renewalCredits: env.STRIPE_RENEWAL_CREDITS,
        })
      : null;
  const hosting = siteHosting(app, workspace, origin, env.SITE_BASE_DOMAIN);
  billing?.register(app);
  registerGrowth(app, {
    env,
    db: database.db,
    store: workspace,
    requireOrigin: originTab,
    identify: async (request) => (await activeSession(request)).account.id,
    reportError: authError,
    limit: allow,
  });
  const llmBase = env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
  const pageUrl = publicPageUrl(origin, env.SITE_BASE_DOMAIN);
  const readPage = pageReader(pageUrl);
  const research =
    env.SEARXNG_BASE_URL && env.LLM_MODEL && env.LLM_API_KEY
      ? {
          identity: JSON.stringify([
            env.SEARXNG_BASE_URL,
            llmBase,
            env.LLM_MODEL,
          ]),
          pageUrl,
          answer: researchAnswer({
            modelTimeoutMs: env.RESEARCH_MODEL_TIMEOUT_SECONDS * 1000,
            pageUrl,
            search: searxngSearch(searxngEndpoint(env.SEARXNG_BASE_URL)),
            read: readPage,
            complete: llmClient({
              key: env.LLM_API_KEY,
              model: env.LLM_MODEL,
              baseUrl: llmBase,
            }),
          }),
        }
      : undefined;
  registerResearch(app, {
    deadlineMs: 15_000 + env.RESEARCH_MODEL_TIMEOUT_SECONDS * 2000,
    provider: research,
    redis: cache,
    rateWindow,
    cacheKey: (parts) =>
      'brightwork:research:' +
      digest(secret, 'research-cache', JSON.stringify(parts)),
    authorize: async (request, id) => {
      try {
        originTab(request);
        const { account } = await activeSession(request);
        const access = await workspace.membership(account.id, id);
        if (!access) throw new ResearchFailure('business_not_found');
        if (access.role === 'viewer') throw new ResearchFailure('forbidden');
        return account.id;
      } catch (error) {
        if (error instanceof AuthFailure && error.statusCode === 401)
          throw new ResearchFailure('sign_in_required');
        if (error instanceof AuthFailure && error.statusCode === 403)
          throw new ResearchFailure('forbidden');
        throw error;
      }
    },
  });
  const agentEnabled = Boolean(
    process.env.LLM_API_KEY && process.env.LLM_MODEL,
  );
  const inbound = inboundMail(
    database.db,
    env.INBOUND_EMAIL_DOMAIN &&
      env.INBOUND_RESEND_API_KEY &&
      env.INBOUND_RESEND_WEBHOOK_SECRET
      ? {
          domain: env.INBOUND_EMAIL_DOMAIN,
          apiKey: env.INBOUND_RESEND_API_KEY,
          secret: env.INBOUND_RESEND_WEBHOOK_SECRET,
        }
      : undefined,
  );
  inbound.register(app);
  registerWorkspace(app, {
    store: workspace,
    team,
    domains: domainStore(database.db),
    vault: env.VAULT_KEY ? vaultStore(database.db, env.VAULT_KEY) : undefined,
    runs: runStore(database.db),
    mail: mailStore(database.db),
    inbound,
    outreachSender:
      agentEnabled && env.OUTREACH_RESEND_API_KEY && env.OUTREACH_FROM_EMAIL
        ? env.OUTREACH_FROM_EMAIL
        : undefined,
    redis: cache,
    hosting,
    siteSync:
      env.GITHUB_SITE_WORKSPACE_ID &&
      env.GITHUB_SITE_TOKEN &&
      env.GITHUB_SITE_REPO
        ? {
            workspaceId: env.GITHUB_SITE_WORKSPACE_ID,
            repo: env.GITHUB_SITE_REPO,
            branch: env.GITHUB_SITE_BRANCH ?? 'main',
            sync: githubSiteSync({
              token: env.GITHUB_SITE_TOKEN,
              repo: env.GITHUB_SITE_REPO,
              branch: env.GITHUB_SITE_BRANCH ?? 'main',
            }),
          }
        : undefined,
    readPage,
    limit: allow,
    agentEnabled,
    identify: async (request) => (await activeSession(request)).account.id,
    requireOrigin: originTab,
    reportError: authError,
  });
  app.get('/api/me/invitations', async (request, reply) => {
    try {
      const { account } = await activeSession(request);
      return { invitations: await team.inbox(account.email) };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/me/invitations/:id/accept', async (request, reply) => {
    try {
      originTab(request);
      const { account } = await activeSession(request);
      const { id } = z.object({ id: uuid }).parse(request.params);
      const workspaceId = await team.accept(id, account.id, account.email);
      if (!workspaceId)
        throw new AuthFailure(404, 'Invitation not found or expired.');
      return { workspaceId };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.get('/api/me/search-work', async (request, reply) => {
    try {
      const { account } = await activeSession(request);
      const { q, current } = z
        .object({ q: z.string().trim().min(2).max(120), current: z.uuid() })
        .parse(request.query);
      return { items: await workspace.searchWork(account.id, current, q) };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.get('/api/auth/email/code', async () => ({
    humanCheck: {
      provider: 'turnstile',
      siteKey: auth.emailEnabled ? (env.TURNSTILE_SITE_KEY ?? '') : '',
    },
    signals: { provider: 'workos_radar', clientId: '' },
    providers: { google: auth.oauthEnabled, apple: auth.oauthEnabled },
  }));
  app.post('/api/auth/email/code', async (request, reply) => {
    try {
      originTab(request);
      const body = codeRequest.parse(request.body);
      if (!auth.emailEnabled)
        throw new AuthFailure(503, 'Email sign-in is unavailable.');
      await allow('code-ip', request.ip, 10, 600);
      await allow('code-email', body.email, 4, 600);
      if (!(await auth.verifyHuman(body.humanCheck, request.ip)))
        throw new AuthFailure(
          400,
          'The security check expired. Please try again.',
        );
      const attempt = await store.beginEmail(body.email);
      try {
        await auth.sendCode(body.email, attempt.code, attempt.link);
      } catch (error) {
        await store.cancelAttempt(attempt.id);
        throw error;
      }
      return { sent: true, attempt: attempt.id, link: true };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/auth/email/verify', async (request, reply) => {
    try {
      originTab(request);
      const body = verifyRequest.parse(request.body);
      await allow('verify-ip', request.ip, 25, 600);
      return await setSession(
        request,
        reply,
        await store.verifyCode(body.attempt, body.email, body.code),
      );
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/auth/email/link', async (request, reply) => {
    try {
      originTab(request);
      const { token } = z.object({ token: tokenShape }).parse(request.body);
      await allow('link-ip', request.ip, 20, 600);
      return await setSession(request, reply, await store.verifyLink(token));
    } catch (error) {
      return authError(error, reply);
    }
  });

  app.get('/api/auth/sign-in', async (request, reply) => {
    try {
      const query = z
        .object({ provider, returnTo: z.string().max(2048).optional() })
        .parse(request.query);
      if (!auth.oauthEnabled)
        throw new AuthFailure(503, 'Social sign-in is unavailable.');
      await allow('oauth-ip', request.ip, 20, 600);
      const state = randomToken();
      const verifier = randomToken();
      await cache.set(
        'brightwork:oauth:' + digest(secret, 'oauth', state),
        JSON.stringify({
          verifier,
          returnTo: safeReturnTo(query.returnTo, origin),
        }),
        'EX',
        challengeLifetimeSeconds,
      );
      saveCookie(reply, 'oauth', state, challengeLifetimeSeconds);
      return reply.redirect(
        auth.authorizationUrl(query.provider, state, verifier),
      );
    } catch (error) {
      return authError(error, reply);
    }
  });
  const callback = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { code, state } = z
        .object({ code: z.string().min(1).max(2048), state: tokenShape })
        .parse(request.query);
      if (!sameToken(state, readCookie(request, 'oauth') ?? ''))
        throw new AuthFailure(403, 'Invalid sign-in state.');
      const stored = await cache.getdel(
        'brightwork:oauth:' + digest(secret, 'oauth', state),
      );
      const grant = z
        .object({ verifier: tokenShape, returnTo: z.string() })
        .parse(stored ? JSON.parse(stored) : null);
      const identity = await auth.exchangeCode(code, grant.verifier);
      await setSession(request, reply, await store.fromSocial(identity));
      saveCookie(reply, 'oauth', '', 0);
      return reply.redirect(safeReturnTo(grant.returnTo, origin));
    } catch {
      saveCookie(reply, 'oauth', '', 0);
      return reply.redirect('/sign-in?error=social');
    }
  };
  app.get('/auth/callback', callback);
  app.get('/api/auth/callback', callback);
  app.get('/api/auth/google/one-tap', async (request, reply) => {
    try {
      if (!env.GOOGLE_CLIENT_ID) return { clientId: '' };
      await allow('one-tap-ip', request.ip, 20, 600);
      const nonce = randomToken();
      await cache.set(
        'brightwork:google:' + digest(secret, 'google', nonce),
        '1',
        'EX',
        challengeLifetimeSeconds,
      );
      saveCookie(reply, 'google', nonce, challengeLifetimeSeconds);
      return { clientId: env.GOOGLE_CLIENT_ID, nonce };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/auth/google/one-tap', async (request, reply) => {
    try {
      originTab(request);
      const { credential } = z
        .object({ credential: z.string().min(1).max(16_384) })
        .parse(request.body);
      await allow('google-ip', request.ip, 20, 600);
      const nonce = tokenShape.parse(readCookie(request, 'google'));
      const identity = await auth.verifyGoogle(credential, nonce).catch(() => {
        throw new AuthFailure(401, 'Google sign-in could not be verified.');
      });
      if (
        !(await cache.getdel(
          'brightwork:google:' + digest(secret, 'google', nonce),
        ))
      )
        throw new AuthFailure(401, 'Google sign-in expired.');
      await setSession(request, reply, await store.fromSocial(identity));
      saveCookie(reply, 'google', '', 0);
      return { signedIn: true };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/auth/sign-out', async (request, reply) => {
    try {
      originTab(request);
      const token = tokenShape.safeParse(readCookie(request, 'session'));
      if (token.success) await store.revokeSession(token.data);
      saveCookie(reply, 'session', '', 0);
      return { signedOut: true };
    } catch (error) {
      return authError(error, reply);
    }
  });

  app.get('/api/me/profile', profileReply);
  app.get('/api/me/account', profileReply);
  app.patch('/api/me/account', async (request, reply) => {
    try {
      originTab(request);
      const { account } = await activeSession(request);
      const data = preferences.parse(request.body);
      // JSON object properties omitted by the client leave their stored preference intact.
      const patch = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ) as ProfileUpdate;
      return asProfile(await store.updateAccount(account.id, patch));
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/me/session', async (request, reply) => {
    try {
      originTab(request);
      empty.parse(request.body);
      const { account, session } = await activeSession(request);
      const currentBilling = await billing?.read(account.id);
      const browserLanguage = locale(request.headers['accept-language']);
      const browserTimezone = timezone(
        request.headers['x-brightwork-time-zone'] ??
          request.headers['x-foundable-time-zone'],
      );
      if (
        browserLanguage !== account.browserLanguage ||
        browserTimezone !== account.browserTimezone
      ) {
        await store.updateAccount(account.id, {
          browserLanguage,
          browserTimezone,
        });
      }
      return {
        ...asProfile({ ...account, browserLanguage, browserTimezone }),
        language: account.language ?? browserLanguage,
        background: account.background,
        adSharing: false,
        assistantAddress: '',
        session: {
          provider: session.provider,
          subject: session.subject,
          sessionId: session.id,
          email: account.email,
          name: account.name ?? '',
          googleAccount: null,
        },
        companyList: await store.companyList(account.id),
        creditBalance: await credits.open(account.id),
        billing: {
          userId: account.id,
          offers: [],
          access: {
            state: currentBilling?.paid ? 'paid' : 'free',
            paid: currentBilling?.paid ?? false,
            plan: currentBilling?.paid ? 'test-subscription' : null,
            canSpend: currentBilling?.paid ?? false,
            canGrant: false,
            companyLimit: 1,
          },
          subscription: currentBilling?.canOpenPortal
            ? {
                state: currentBilling.state,
                periodEnd: currentBilling.periodEnd,
                cancelAtPeriodEnd: currentBilling.cancelAtPeriodEnd,
              }
            : null,
          canOpenPortal: currentBilling?.canOpenPortal ?? false,
          checkoutOffers: [],
          firstMonthOffer: null,
          packs: [],
          creditIncreases: [],
          periodEndChanges: [],
          adsWallArm: 'off',
          publishableKey: '',
        },
      };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/me/presence', async (request, reply) => {
    try {
      const tab = originTab(request);
      empty.parse(request.body);
      const active = await activeSession(request);
      await cache.set(
        `brightwork:presence:${active.session.id}:${tab}`,
        active.account.id,
        'EX',
        90,
      );
      return { userId: active.account.id };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.get('/api/me/billing', async (request, reply) => {
    try {
      const { account } = await activeSession(request);
      return billing
        ? await billing.read(account.id)
        : { enabled: false, state: 'free', paid: false };
    } catch (error) {
      return authError(error, reply);
    }
  });
  for (const mode of ['checkout', 'portal'] as const) {
    app.post('/api/me/billing/' + mode, async (request, reply) => {
      try {
        originTab(request);
        const { account } = await activeSession(request);
        if (!billing)
          throw new AuthFailure(503, 'Stripe test billing is unavailable.');
        await allow('billing-' + mode, account.id, 5, 60);
        const result =
          mode === 'checkout'
            ? await billing.checkout(account.id, account.email)
            : await billing.portal(account.id);
        if (!result)
          throw new AuthFailure(
            409,
            'Check the existing subscription before opening this billing action.',
          );
        return result;
      } catch (error) {
        return authError(error, reply);
      }
    });
  }
  app.get('/api/me/credits', async (request, reply) => {
    try {
      return await credits.open((await activeSession(request)).account.id);
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.get('/api/me/credits/history', async (request, reply) => {
    try {
      const { account } = await activeSession(request);
      return await credits.history(account.id);
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.get('/api/me/companies', async (request, reply) => {
    try {
      return await store.companyList((await activeSession(request)).account.id);
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/me/companies/begin', async (request, reply) => {
    try {
      originTab(request);
      const { account } = await activeSession(request);
      const body = z
        .object({
          name: z.string().trim().min(1).max(100),
          idea: z.string().trim().max(4000).default(''),
        })
        .parse(request.body);
      await allow('business-create', account.id, 15, 3600);
      const business = await store.createBusiness(
        account.id,
        body.name,
        body.idea,
      );
      return { company: { id: business.id, name: business.name } };
    } catch (error) {
      return authError(error, reply);
    }
  });
  app.post('/api/companies/:id/opened', async (request, reply) => {
    try {
      originTab(request);
      empty.parse(request.body);
      const { account } = await activeSession(request);
      const { id } = z.object({ id: uuid }).parse(request.params);
      const business = await store.openBusiness(account.id, id);
      if (!business) throw new AuthFailure(404, 'Business not found.');
      return { userId: account.id };
    } catch (error) {
      return authError(error, reply);
    }
  });
}
