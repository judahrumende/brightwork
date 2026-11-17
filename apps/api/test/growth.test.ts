import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { authEnv } from '../src/auth/config';
import type { Database } from '../src/db/database';
import type { agentStore } from '../src/workspace/agent-store';
import { googleListing, metaAds, metaPage } from '../src/growth/providers';
import { registerGrowth } from '../src/growth/routes';

const id = 'a11713fb-627d-4c64-851b-aa8e246b7437';
const other = 'b11713fb-627d-4c64-851b-aa8e246b7437';

test('Meta writes the selected Page content and keeps the token out of the URL', async () => {
  const page = metaPage('50', 'page-token', async (url, init) => {
    assert.equal(String(url), 'https://graph.facebook.com/v27.0/50/feed');
    assert.equal(init?.method, 'POST');
    assert.equal(
      new Headers(init.headers).get('Authorization'),
      'Bearer page-token',
    );
    assert.equal(String(init.body), 'message=Reviewed+draft');
    return Response.json({ id: '50_2' });
  });
  assert.equal(await page.publish('Reviewed draft'), '50_2');
});

test('Meta campaign controls enforce account ownership and avoid archived campaigns', async () => {
  const calls: string[] = [];
  let account = '999';
  let status = 'PAUSED';
  const ads = metaAds('50', 'ads-token', async (_url, init) => {
    calls.push(init?.method ?? 'GET');
    return Response.json(
      init?.method === 'POST'
        ? { success: true }
        : { account_id: account, status },
    );
  });
  assert.equal(await ads.setStatus('11', 'ACTIVE'), false);
  account = '50';
  status = 'ARCHIVED';
  assert.equal(await ads.setStatus('11', 'ACTIVE'), false);
  status = 'PAUSED';
  assert.equal(await ads.setStatus('11', 'ACTIVE'), true);
  assert.deepEqual(calls, ['GET', 'GET', 'GET', 'POST']);
});

test('Google uses a field mask and only changes the description', async () => {
  const google = googleListing('12', 'google-token', async (url, init) => {
    assert.equal(
      String(url),
      'https://mybusinessbusinessinformation.googleapis.com/v1/locations/12?updateMask=profile.description',
    );
    assert.equal(init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(init.body)), {
      profile: { description: 'Updated text' },
    });
    return Response.json({
      title: 'Example',
      profile: { description: 'Updated text' },
    });
  });
  assert.equal(
    (await google.update('Updated text')).profile?.description,
    'Updated text',
  );
});

test('workspace gates prevent cross-workspace access, unapproved origins and viewer writes', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let role = 'viewer';
  let allowed = true;
  let saved = 0;
  registerGrowth(app, {
    env: authEnv.parse({
      GROWTH_WORKSPACE_ID: id,
      GROWTH_META_PAGE_ID: '50',
      GROWTH_META_PAGE_TOKEN: 'test',
    }),
    db: {} as Database,
    store: {
      membership: async () => (allowed ? { role } : undefined),
      saveArtifact: async () => {
        saved++;
        return {};
      },
    } as unknown as ReturnType<typeof agentStore>,
    identify: async () => id,
    requireOrigin: (request) => {
      if (request.headers.origin !== 'http://127.0.0.1:5173')
        throw new Error('invalid origin');
    },
    reportError: (_error, reply) =>
      reply.code(403).send({ message: 'Origin rejected' }),
    limit: async () => {},
  });
  const options = {
    method: 'POST' as const,
    url: `/api/companies/${id}/growth/posts`,
    payload: { title: 'Draft', body: 'Text' },
    headers: { origin: 'http://127.0.0.1:5173' },
  };
  assert.equal((await app.inject(options)).statusCode, 403);
  assert.equal(
    (await app.inject(`/api/companies/${other}/growth`)).json().social,
    false,
  );
  role = 'member';
  assert.equal((await app.inject({ ...options, headers: {} })).statusCode, 403);
  assert.equal((await app.inject(options)).statusCode, 200);
  assert.equal(saved, 1);
  allowed = false;
  assert.equal(
    (await app.inject(`/api/companies/${id}/growth`)).statusCode,
    404,
  );
});
