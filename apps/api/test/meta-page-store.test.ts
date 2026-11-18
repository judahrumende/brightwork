import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { authEnv } from '../src/auth/config';
import { businesses } from '../src/db/schema';
import { workspaceMetaPages } from '../src/growth/meta-page-store';
import { registerGrowth } from '../src/growth/routes';
import type { agentStore } from '../src/workspace/agent-store';

const url = process.env.TEST_DATABASE_URL;
test(
  'Meta lifecycle scopes signed comments and reserves replies before posting',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_meta_' + randomUUID().replaceAll('-', '');
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    const connection = postgres(url, {
      max: 5,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    const db = drizzle(connection);
    const app = Fastify();
    t.after(async () => {
      await app.close();
      await connection.end();
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    });
    await admin`create schema ${admin(schema)}`;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      migrationsSchema: schema,
    });
    const [owner, other] = await db
      .insert(businesses)
      .values([{ name: 'Meta fixture' }, { name: 'Separate business' }])
      .returning();
    assert.ok(owner && other);

    const secret = 'synthetic-meta-app-secret';
    const verifyToken = 'synthetic-verification-token';
    const token = 'synthetic-page-token';
    const replacement = 'replacement-page-token';
    let activeToken = token;
    let subscribed = 0;
    let sent = 0;
    let ambiguous = false;
    const vaultKey = '12'.repeat(32);
    const transport: typeof fetch = async (target, options) => {
      const path = new URL(String(target)).pathname;
      assert.equal(
        new Headers(options?.headers).get('authorization'),
        'Bearer ' + activeToken,
      );
      if (path.endsWith('/me'))
        return Response.json({ id: '500', name: 'Fixture Page' });
      if (path.endsWith('/500/subscribed_apps')) {
        subscribed += 1;
        return Response.json({ success: true });
      }
      assert.ok(path.endsWith('/500_30/comments'));
      sent += 1;
      if (ambiguous) throw new Error('response lost');
      return Response.json({ id: '500_41' });
    };
    const pages = workspaceMetaPages(
      db,
      { vaultKey, appSecret: secret, verifyToken },
      transport,
    );
    registerGrowth(app, {
      env: authEnv.parse({
        VAULT_KEY: vaultKey,
        GROWTH_META_APP_SECRET: secret,
        GROWTH_META_VERIFY_TOKEN: verifyToken,
      }),
      db,
      transport,
      store: {
        membership: async (actor: string, businessId: string) =>
          actor === businessId ? { role: 'owner' } : undefined,
      } as ReturnType<typeof agentStore>,
      identify: async (request) => String(request.headers['x-test-business']),
      requireOrigin: () => {},
      limit: async () => {},
      reportError: (error) => {
        throw error;
      },
    });
    const readSocial = (route: string, actor = owner.id, business = owner.id) =>
      app.inject({
        url: `/api/companies/${business}/social/${route}`,
        headers: { 'x-test-business': actor },
      });
    const urlPath = '/api/webhooks/meta/pages';
    const challenge = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': verifyToken,
      'hub.challenge': '5522',
    });
    assert.equal((await app.inject(urlPath + '?' + challenge)).body, '5522');
    challenge.set('hub.verify_token', 'incorrect');
    assert.equal((await app.inject(urlPath + '?' + challenge)).statusCode, 403);
    const input = { pageId: '500', token };
    assert.equal(
      await pages.connect(owner.id, { ...input, pageId: '501' }),
      false,
    );
    assert.equal(await pages.connect(owner.id, input), true);
    assert.equal(await pages.connect(other.id, input), false);
    assert.equal(subscribed, 1);
    assert.deepEqual(await pages.connection(owner.id), {
      pageId: '500',
      name: 'Fixture Page',
      connected: true,
    });
    assert.deepEqual((await readSocial('accounts')).json(), {
      items: [
        {
          platform: 'facebook',
          pageId: '500',
          name: 'Fixture Page',
          connected: true,
        },
      ],
    });
    const capabilities = await readSocial('capabilities');
    assert.equal(capabilities.statusCode, 200);
    assert.equal(capabilities.json().platforms[0].publish, true);
    assert.deepEqual(capabilities.json().platforms[0].inbox, ['comment']);

    function deliver(
      verb: string,
      time: number,
      id = '500_30',
      page = '500',
      key = secret,
    ) {
      const payload = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: page,
            time,
            changes: [
              {
                field: 'feed',
                value: {
                  item: 'comment',
                  verb,
                  comment_id: id,
                  post_id: '500_20',
                  message: verb + '-body',
                },
              },
            ],
          },
        ],
      });
      return app.inject({
        method: 'POST',
        url: urlPath,
        payload,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256':
            'sha256=' + createHmac('sha256', key).update(payload).digest('hex'),
        },
      });
    }
    assert.equal(
      (await deliver('add', 100, '500_30', '500', 'incorrect')).statusCode,
      403,
    );
    assert.equal((await deliver('add', 100, '500_30', '501')).statusCode, 204);
    assert.equal((await pages.threads(owner.id)).comments.length, 0);
    assert.equal((await deliver('add', 100)).statusCode, 204);
    assert.equal((await deliver('add', 100)).statusCode, 204);
    assert.equal((await deliver('edit', 103)).statusCode, 204);
    assert.equal((await deliver('edit', 102)).statusCode, 204);
    assert.equal(
      (await pages.threads(owner.id)).comments[0]?.updatedAt.getTime(),
      103_000,
    );
    assert.equal((await pages.threads(other.id)).comments.length, 0);
    const reply = { id: randomUUID(), commentId: '500_30', body: 'Answer' };
    assert.match((await pages.reply(other.id, reply)).error ?? '', /Connect/);
    await Promise.all([
      pages.reply(owner.id, reply),
      pages.reply(owner.id, reply),
    ]);
    assert.deepEqual(await pages.reply(owner.id, reply), {
      status: 'published',
      providerId: '500_41',
    });
    assert.equal(sent, 1);
    const retry = { ...reply, id: randomUUID() };
    ambiguous = true;
    assert.equal((await pages.reply(owner.id, retry)).status, 'needs_review');
    assert.equal((await pages.reply(owner.id, retry)).status, 'needs_review');
    assert.equal(sent, 2);
    const allReplies = await readSocial('replies');
    assert.equal(allReplies.statusCode, 200);
    assert.deepEqual(
      new Set(allReplies.json().items.map((item: { id: string }) => item.id)),
      new Set([reply.id, retry.id]),
    );
    assert.deepEqual(
      (await readSocial('replies?waiting=true&limit=1'))
        .json()
        .items.map((item: { id: string }) => item.id),
      [retry.id],
    );
    const actions = (
      await readSocial('provider-actions?state=published')
    ).json().actions;
    assert.equal(actions.length, 1);
    assert.equal(actions[0].providerId, '500_41');
    assert.equal('body' in actions[0], false);
    assert.deepEqual(
      (await readSocial('replies', other.id, other.id)).json().items,
      [],
    );
    for (const route of [
      'capabilities',
      'accounts',
      'replies',
      'provider-actions',
    ]) {
      assert.equal((await readSocial(route, other.id)).statusCode, 404);
    }
    await deliver('remove', 105);
    await deliver('add', 104);
    assert.equal((await pages.threads(owner.id)).comments.length, 0);
    await pages.disconnect(owner.id);
    assert.equal(
      (await readSocial('accounts')).json().items[0].connected,
      false,
    );
    assert.equal(
      (await readSocial('capabilities')).json().platforms[0].publish,
      false,
    );
    assert.equal(await pages.provider(owner.id), null);
    await deliver('add', 110, '500_31');
    assert.equal((await pages.threads(owner.id)).comments.length, 0);
    activeToken = replacement;
    assert.equal(
      await pages.connect(owner.id, { pageId: '500', token: replacement }),
      true,
    );
    assert.equal(subscribed, 2);
    await deliver('add', 111, '500_32');
    assert.equal((await pages.threads(owner.id)).comments[0]?.id, '500_32');
  },
);
