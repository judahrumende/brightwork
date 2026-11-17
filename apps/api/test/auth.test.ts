import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { authEnv } from '../src/auth/config';
import { registerAuth } from '../src/auth/routes';
import { pkceChallenge } from '../src/auth/tokens';
import { connectDatabase } from '../src/db/database';
import {
  agentTurns,
  artifacts,
  calendarEvents,
  members,
} from '../src/db/schema';
import { agentStore } from '../src/workspace/agent-store';

const { TEST_DATABASE_URL, TEST_MAILPIT_URL, REDIS_URL } = process.env;
const origin = 'http://127.0.0.1:5173';

test(
  'email and OAuth sign-in establish sessions and isolate workspace records',
  { skip: !(TEST_DATABASE_URL && TEST_MAILPIT_URL && REDIS_URL) },
  async () => {
    assert.ok(TEST_DATABASE_URL && TEST_MAILPIT_URL && REDIS_URL);
    const fixture = randomUUID();
    const schema = 'auth_fixture_' + fixture.replaceAll('-', '');
    const url = new URL(TEST_DATABASE_URL);
    url.searchParams.set('search_path', schema);
    const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    const database = connectDatabase(url.href);
    const server = Fastify();
    const email = `owner-${fixture}@example.test`;
    const headers = { origin, 'x-session-id': fixture };
    const cookieFrom = (
      values: string | string[] | number | undefined,
      name: string,
    ) => {
      const cookie = (Array.isArray(values) ? values : [values])
        .find(
          (value) => typeof value === 'string' && value.startsWith(name + '='),
        )
        ?.toString()
        .split(';')[0];
      assert.ok(cookie, `Expected ${name} cookie`);
      return cookie;
    };

    function post(path: string, payload: object, cookie = '') {
      return server.inject({
        method: 'POST',
        url: path,
        headers: { ...headers, cookie },
        payload,
      });
    }

    async function deliverCode() {
      const response = await post('/api/auth/email/code', {
        email,
        humanCheck: 'fixture-turnstile-token',
      });
      assert.equal(response.statusCode, 200);
      const search = new URL('/api/v1/search', TEST_MAILPIT_URL);
      search.searchParams.set('query', 'to:' + email);
      const result = await fetch(search);
      assert.equal(result.status, 200);
      const { messages } = (await result.json()) as {
        messages: { ID: string }[];
      };
      assert.ok(messages[0]);
      const message = await fetch(
        new URL('/api/v1/message/' + messages[0].ID, TEST_MAILPIT_URL),
      );
      assert.equal(message.status, 200);
      const { Text } = (await message.json()) as { Text: string };
      const code = Text.match(/sign-in code is (\d{6})/u)?.[1];
      const token = Text.match(/#token=([\w-]+)/u)?.[1];
      assert.ok(
        code && token,
        'Mailpit received an email with a code and link',
      );
      return {
        attempt: response.json<{ attempt: string }>().attempt,
        code,
        token,
      };
    }

    async function company(cookie: string, name: string) {
      const response = await post('/api/me/companies/begin', { name }, cookie);
      assert.equal(response.statusCode, 200);
      return response.json<{ company: { id: string } }>().company.id;
    }

    async function session(cookie: string) {
      const response = await post('/api/me/session', {}, cookie);
      assert.equal(response.statusCode, 200);
      return response.json<{
        companyList: {
          userId: string;
          lastOpened: string | null;
          companies: { id: string }[];
        };
        session: { email: string };
      }>();
    }

    const exchanges = new Map<string, string>();
    let verifiedChallenges = 0;
    try {
      await admin`create schema ${admin(schema)}`;
      await migrate(database.db, {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
        migrationsSchema: schema,
      });
      registerAuth(
        server,
        authEnv.parse({
          APP_ORIGIN: origin,
          SITE_BASE_DOMAIN: 'sites.example.test',
          DATABASE_URL: url.href,
          REDIS_URL,
          AUTH_SECRET: 'fixture-key-' + fixture,
          SMTP_HOST: process.env.SMTP_HOST ?? '127.0.0.1',
          SMTP_PORT: process.env.SMTP_PORT,
          MAIL_FROM: 'Brightwork <hello@brightwork.test>',
          TURNSTILE_SITE_KEY: 'fixture-site-key',
          TURNSTILE_SECRET_KEY: 'fixture-turnstile-secret',
          WORKOS_CLIENT_ID: 'fixture-client',
          WORKOS_API_KEY: 'fixture-workos-key',
        }),
        async (input, init) => {
          const target = String(input);
          if (
            target ===
            'https://challenges.cloudflare.com/turnstile/v0/siteverify'
          ) {
            assert.ok(init?.body instanceof URLSearchParams);
            assert.equal(init.body.get('response'), 'fixture-turnstile-token');
            verifiedChallenges += 1;
            return Response.json({
              success: true,
              hostname: '127.0.0.1',
              action: 'email-code',
            });
          }
          assert.equal(
            target,
            'https://api.workos.com/user_management/authenticate',
          );
          assert.equal(typeof init?.body, 'string');
          const body = JSON.parse(String(init?.body)) as {
            code: string;
            code_verifier: string;
          };
          const challenge = exchanges.get(body.code);
          assert.ok(challenge);
          assert.equal(pkceChallenge(body.code_verifier), challenge);
          return Response.json({
            user: {
              id: body.code,
              email: body.code + '@example.test',
              email_verified: true,
            },
          });
        },
      );

      const code = await deliverCode();
      const verification = { email, code: code.code, attempt: code.attempt };
      const signIn = await post('/api/auth/email/verify', verification);
      assert.equal(signIn.statusCode, 200);
      const cookie = cookieFrom(signIn.headers['set-cookie'], 'bw-session');
      assert.equal(
        (await post('/api/auth/email/verify', verification)).statusCode,
        401,
      );
      assert.equal(
        (await post('/api/auth/email/link', { token: code.token })).statusCode,
        401,
      );

      const studio = await company(cookie, 'Synthetic Studio');
      const shop = await company(cookie, 'Synthetic Shop');
      assert.equal(
        (await post(`/api/companies/${studio}/opened`, {}, cookie)).statusCode,
        200,
      );
      const owner = await session(cookie);
      assert.equal(owner.companyList.lastOpened, studio);

      const link = await deliverCode();
      const magic = await post('/api/auth/email/link', { token: link.token });
      assert.equal(magic.statusCode, 200);
      const freshCookie = cookieFrom(magic.headers['set-cookie'], 'bw-session');
      const reopened = await session(freshCookie);
      assert.equal(reopened.session.email, email);
      assert.equal(reopened.companyList.lastOpened, studio);
      assert.equal(
        (await post('/api/auth/email/link', { token: link.token })).statusCode,
        401,
      );
      assert.equal(verifiedChallenges, 2);

      const socialCookies = new Map<string, string>();
      for (const provider of ['GoogleOAuth', 'AppleOAuth']) {
        const query = new URLSearchParams({ provider, returnTo: '/home' });
        const start = await server.inject('/api/auth/sign-in?' + query);
        assert.equal(start.statusCode, 302);
        const authorization = new URL(String(start.headers.location));
        assert.equal(authorization.origin, 'https://api.workos.com');
        assert.equal(authorization.searchParams.get('provider'), provider);
        const state = authorization.searchParams.get('state');
        const challenge = authorization.searchParams.get('code_challenge');
        assert.ok(state && challenge);
        const callbackQuery = new URLSearchParams({
          code: provider.toLowerCase() + '-' + fixture,
          state,
        });
        exchanges.set(callbackQuery.get('code')!, challenge);
        const callbackUrl = '/auth/callback?' + callbackQuery;
        const oauthCookie = cookieFrom(start.headers['set-cookie'], 'bw-oauth');
        const invalid = await server.inject(callbackUrl);
        assert.equal(invalid.headers.location, '/sign-in?error=social');
        const callback = await server.inject({
          url: callbackUrl,
          headers: { cookie: oauthCookie },
        });
        assert.equal(callback.headers.location, '/home');
        const oauthSession = cookieFrom(
          callback.headers['set-cookie'],
          'bw-session',
        );
        socialCookies.set(provider, oauthSession);
        assert.deepEqual(
          (await session(oauthSession)).companyList.companies,
          [],
        );
        const replay = await server.inject({
          url: callbackUrl,
          headers: { cookie: oauthCookie },
        });
        assert.equal(replay.headers.location, '/sign-in?error=social');
      }

      const separateCookie = socialCookies.get('AppleOAuth');
      const collaboratorCookie = socialCookies.get('GoogleOAuth');
      assert.ok(separateCookie && collaboratorCookie);
      const other = await company(separateCookie, 'Separate Fixture');
      const [turn] = await database.db
        .insert(agentTurns)
        .values({ businessId: studio, prompt: 'Synthetic private chat' })
        .returning({ id: agentTurns.id });
      const [draft, file, shopWork] = await database.db
        .insert(artifacts)
        .values([
          {
            businessId: studio,
            kind: 'website',
            title: 'Synthetic site draft',
            body: '<h1>Studio</h1>',
            state: 'pending',
          },
          {
            businessId: studio,
            kind: 'document',
            title: 'Synthetic file',
            body: 'Private file',
          },
          {
            businessId: shop,
            kind: 'document',
            title: 'Synthetic shop file',
            body: 'Other accessible workspace',
          },
        ])
        .returning({ id: artifacts.id });
      assert.ok(turn && draft && file && shopWork);
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 86_400_000);
      const nextDay = new Date(tomorrow.getTime() + 86_400_000);
      await database.db.insert(calendarEvents).values({
        businessId: studio,
        title: 'Synthetic private calendar event',
        timezone: 'UTC',
        startsAt: today,
        endsAt: tomorrow,
      });
      const calendar =
        '/schedule/occurrences?' +
        new URLSearchParams({
          from: today.toISOString(),
          to: nextDay.toISOString(),
        });
      for (const path of [
        '/pip/turns',
        `/work/${draft.id}`,
        `/work/${file.id}`,
        calendar,
      ]) {
        assert.equal(
          (
            await server.inject({
              url: `/api/companies/${studio}` + path,
              headers: { cookie: freshCookie },
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await server.inject({
              url: `/api/companies/${studio}` + path,
              headers: { cookie: separateCookie },
            })
          ).statusCode,
          404,
        );
      }
      assert.equal(
        (
          await server.inject({
            url: `/api/companies/${studio}/pip/turns/${turn.id}/events`,
            headers: { cookie: separateCookie },
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await server.inject({
            url: `/api/companies/${other}/work/${draft.id}`,
            headers: { cookie: separateCookie },
          })
        ).statusCode,
        404,
      );

      const search =
        '/api/me/search-work?' +
        new URLSearchParams({ q: 'Synthetic', current: studio });
      const readSearch = async (cookie: string) =>
        (await server.inject({ url: search, headers: { cookie } })).json<{
          items: { id: string }[];
        }>().items;
      const results = await readSearch(freshCookie);
      assert.deepEqual(
        new Set(results.map((item) => item.id)),
        new Set([draft.id, file.id, shopWork.id]),
      );
      assert.equal(results.at(-1)?.id, shopWork.id);
      assert.deepEqual(await readSearch(separateCookie), []);

      const withFiles = await agentStore(database.db).addTurn(
        studio,
        owner.companyList.userId,
        'Use the attached brief',
        [
          {
            name: 'private.txt',
            content: 'Synthetic attachment for the studio only.',
          },
        ],
      );
      assert.ok(withFiles.attachments[0]);
      const chatUrl = `/api/companies/${studio}/pip/turns`;
      const downloadPath =
        chatUrl +
        '/' +
        withFiles.id +
        '/attachments/' +
        withFiles.attachments[0].id;
      const attachment = await server.inject({
        url: downloadPath,
        headers: { cookie: freshCookie },
      });
      assert.equal(attachment.statusCode, 200);
      assert.match(
        String(attachment.headers['content-disposition']),
        /^attachment;/u,
      );
      assert.equal(
        attachment.body,
        'Synthetic attachment for the studio only.',
      );
      assert.equal(
        (
          await server.inject({
            url: downloadPath,
            headers: { cookie: separateCookie },
          })
        ).statusCode,
        404,
      );
      const earlier = await server.inject({
        url: chatUrl + '?before=' + withFiles.id,
        headers: { cookie: freshCookie },
      });
      assert.equal(earlier.statusCode, 200);
      assert.deepEqual(
        earlier.json<{ turns: { id: string }[] }>().turns.map((row) => row.id),
        [turn.id],
      );

      const notifications = `/api/companies/${studio}/notifications`;
      const markRead = `/api/companies/${studio}/run/read`;
      const history = async (cookie: string) => {
        const reply = await server.inject({
          url: notifications,
          headers: { cookie },
        });
        assert.equal(reply.statusCode, 200);
        return reply.json<{
          items: {
            key: string;
            readAt: string | null;
            resolvedAt: string | null;
          }[];
          unread: number;
        }>();
      };
      const initial = await history(freshCookie);
      assert.equal(initial.unread, 1);
      assert.deepEqual(
        initial.items.map(({ key }) => key),
        [`creation:${draft.id}:1`],
      );
      assert.equal(
        (
          await server.inject({
            url: notifications,
            headers: { cookie: separateCookie },
          })
        ).statusCode,
        404,
      );
      const collaborator = await session(collaboratorCookie);
      await database.db.insert(members).values({
        businessId: studio,
        accountId: collaborator.companyList.userId,
        role: 'viewer',
      });
      assert.equal(
        (await post(markRead, { all: true }, freshCookie)).statusCode,
        200,
      );
      assert.equal((await history(freshCookie)).unread, 0);
      assert.equal((await history(collaboratorCookie)).unread, 1);
      await database.db
        .update(artifacts)
        .set({ revision: 2 })
        .where(eq(artifacts.id, draft.id));
      const revised = await history(freshCookie);
      assert.deepEqual(
        revised.items.map(({ key, resolvedAt }) => [key, Boolean(resolvedAt)]),
        [
          [`creation:${draft.id}:2`, false],
          [`creation:${draft.id}:1`, true],
        ],
      );
      assert.equal(revised.unread, 1);

      const site = await agentStore(database.db).saveArtifact({
        businessId: studio,
        kind: 'website',
        state: 'pending',
        title: 'Publish fixture',
        body: '<h1>First published home</h1>',
        pages: [
          { slug: 'about', title: 'About', html: '<h1>First about</h1>' },
        ],
      });
      const work = `/api/companies/${studio}/work/${site.id}`;
      const host = site.id + '.sites.example.test';
      const visit = (url: string, suppliedCookie = '') =>
        server.inject({ url, headers: { host, cookie: suppliedCookie } });
      assert.equal((await visit('/')).statusCode, 404);
      assert.equal((await visit(work, freshCookie)).statusCode, 404);
      assert.equal(
        (await visit('/api/auth/email/code', freshCookie)).statusCode,
        404,
      );
      assert.equal(
        (
          await post(
            work + '/decision',
            { approve: true, revision: 1 },
            freshCookie,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await post(
            work + '/publish',
            { publish: true, revision: 1 },
            freshCookie,
          )
        ).statusCode,
        200,
      );
      const live = await visit('/about');
      assert.equal(live.statusCode, 200);
      assert.match(live.body, /First about/);
      assert.match(String(live.headers['content-security-policy']), /sandbox/);
      assert.equal(live.headers['set-cookie'], undefined);

      const deployments = async () => {
        const response = await server.inject({
          url: work + '/deployments',
          headers: { cookie: freshCookie },
        });
        assert.equal(response.statusCode, 200);
        return response.json<{
          deployments: {
            id: string;
            revision: number;
            unpublishedAt: string | null;
            rollbackSourceId: string | null;
          }[];
        }>().deployments;
      };
      const [initialDeployment] = await deployments();
      assert.ok(initialDeployment);
      const edit = await server.inject({
        method: 'PATCH',
        url: work + '/website',
        headers: { ...headers, cookie: freshCookie },
        payload: {
          revision: 1,
          title: site.title,
          body: '<h1>Second home</h1>',
          pages: [
            { slug: 'about', title: 'About', html: '<h1>Second about</h1>' },
          ],
        },
      });
      assert.equal(edit.statusCode, 200);
      assert.match((await visit('/about')).body, /First about/);
      assert.equal(
        (
          await post(
            work + '/publish',
            { publish: true, revision: 2 },
            freshCookie,
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await post(
            work + '/decision',
            { approve: true, revision: 2 },
            freshCookie,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await post(
            work + '/publish',
            { publish: true, revision: 2 },
            freshCookie,
          )
        ).statusCode,
        200,
      );
      assert.match((await visit('/about')).body, /Second about/);
      const [current] = await deployments();
      assert.ok(current);
      const rollbackPath =
        work + '/deployments/' + initialDeployment.id + '/rollback';
      assert.equal(
        (
          await post(
            rollbackPath,
            { expectedLive: current.id },
            collaboratorCookie,
          )
        ).statusCode,
        403,
      );
      const attempts = await Promise.all([
        post(rollbackPath, { expectedLive: current.id }, freshCookie),
        post(rollbackPath, { expectedLive: current.id }, freshCookie),
      ]);
      assert.deepEqual(
        attempts.map((result) => result.statusCode).sort(),
        [200, 409],
      );
      assert.match((await visit('/about')).body, /First about/);
      const [restored] = await deployments();
      assert.equal(restored?.rollbackSourceId, initialDeployment.id);
      assert.equal(
        (await agentStore(database.db).workItem(studio, site.id))?.revision,
        2,
      );
      const rejectedImport = await post(
        `/api/companies/${studio}/work/websites/import`,
        { url: 'http://127.0.0.1/' },
        freshCookie,
      );
      assert.equal(rejectedImport.statusCode, 422);
    } finally {
      await server.close();
      await database.close();
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    }
  },
);
