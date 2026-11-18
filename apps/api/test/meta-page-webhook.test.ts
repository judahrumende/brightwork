import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  readPageCommentChanges,
  verifyMetaWebhook,
} from '../src/growth/meta-page-webhook';

test('Meta verifies the original bytes and selects Page feed comment changes', () => {
  const input = {
    object: 'page',
    entry: [
      {
        id: '500',
        time: 1_790_000_000,
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: '500_30',
              post_id: '500_20',
              message: 'Question',
            },
          },
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'remove',
              comment_id: '500_31',
              post_id: '500_20',
              parent_id: '500_30',
            },
          },
          { field: 'feed', value: { item: 'like', verb: 'add' } },
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: '../me',
              post_id: '500_20',
            },
          },
          { field: 'messages', value: {} },
        ],
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(input, null, 2));
  const secret = 'synthetic-app-secret';
  const signature =
    'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyMetaWebhook(secret, raw, signature), true);
  assert.equal(
    verifyMetaWebhook(secret, Buffer.from(JSON.stringify(input)), signature),
    false,
  );
  assert.equal(verifyMetaWebhook('other-secret', raw, signature), false);
  assert.equal(verifyMetaWebhook(secret, raw, 'sha256=0'), false);
  const changes = readPageCommentChanges(input);
  assert.deepEqual(
    changes?.map(({ id, parentId, body }) => ({ id, parentId, body })),
    [
      { id: '500_30', parentId: '500_20', body: 'Question' },
      { id: '500_31', parentId: '500_30', body: null },
    ],
  );
  assert.equal(readPageCommentChanges({ ...input, object: 'instagram' }), null);
});

test('Meta verifies the Page identity, subscribes to feed and sends a reply to one comment', async () => {
  const requests: [string, string, string][] = [];
  const { metaPage } = await import('../src/growth/providers');
  const page = metaPage(
    '500',
    'synthetic-page-token',
    async (input, options) => {
      const url = new URL(String(input));
      assert.equal(
        new Headers(options?.headers).get('authorization'),
        'Bearer synthetic-page-token',
      );
      assert.equal(url.searchParams.has('access_token'), false);
      requests.push([
        url.pathname,
        options?.method ?? 'GET',
        String(options?.body ?? ''),
      ]);
      if (url.pathname.endsWith('/me'))
        return Response.json({ id: '500', name: 'Fixture Page' });
      if (url.pathname.endsWith('/subscribed_apps'))
        return Response.json({ success: true });
      return Response.json({ id: '500_41' });
    },
  );
  assert.deepEqual(await page.verify(), { id: '500', name: 'Fixture Page' });
  assert.equal(await page.subscribeToFeed(), true);
  assert.equal(await page.reply('500_30', 'Reviewed reply'), '500_41');
  await assert.rejects(page.reply('../me', 'Unsafe target'));
  assert.deepEqual(requests, [
    ['/v27.0/me', 'GET', ''],
    ['/v27.0/500/subscribed_apps', 'POST', 'subscribed_fields=feed'],
    ['/v27.0/500_30/comments', 'POST', 'message=Reviewed+reply'],
  ]);
  const wrong = metaPage('501', 'fixture', async () =>
    Response.json({ id: '500', name: 'Wrong Page' }),
  );
  assert.equal(await wrong.verify(), null);
});
