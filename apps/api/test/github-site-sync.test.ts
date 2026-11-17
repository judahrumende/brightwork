import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubSiteSync } from '../src/workspace/github-site-sync';

test('GitHub sync replaces only the site subtree and refuses a competing branch update', async () => {
  const parent = '1'.repeat(40);
  const base = '2'.repeat(40);
  const siteTree = '3'.repeat(40);
  const newTree = '4'.repeat(40);
  const commit = '5'.repeat(40);
  const site = {
    id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
    revision: 2,
    html: '<h1>Home</h1>',
    pages: [{ slug: 'about', title: 'About', html: '<h1>About</h1>' }],
  };
  for (const mode of ['published', 'unchanged', 'conflict']) {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const sync = githubSiteSync(
      { repo: 'example/sites', branch: 'public/main', token: 'fixture-token' },
      async (url, options) => {
        const target = new URL(String(url));
        assert.equal(target.origin, 'https://api.github.com');
        assert.equal(target.search, '');
        assert.equal(
          new Headers(options?.headers).get('Authorization'),
          'Bearer fixture-token',
        );
        calls.push({
          path: target.pathname,
          method: options?.method ?? '',
          body: options?.body ? JSON.parse(String(options.body)) : null,
        });
        const responses = [
          { object: { sha: parent } },
          { tree: { sha: base } },
          { sha: siteTree },
          { sha: mode === 'unchanged' ? base : newTree },
          { sha: commit },
          { object: { sha: commit } },
        ];
        return Response.json(responses[calls.length - 1], {
          status: calls.length === 6 && mode === 'conflict' ? 422 : 200,
        });
      },
    );
    const result = await sync(site);
    assert.equal(
      calls[0]?.path,
      '/repos/example/sites/git/ref/heads/public/main',
    );
    assert.deepEqual(calls[2]?.body, {
      tree: [
        {
          path: 'index.html',
          content: site.html,
          mode: '100644',
          type: 'blob',
        },
        {
          path: 'about/index.html',
          content: '<h1>About</h1>',
          mode: '100644',
          type: 'blob',
        },
      ],
    });
    assert.deepEqual(calls[3]?.body, {
      base_tree: base,
      tree: [
        {
          path: 'sites/' + site.id,
          mode: '040000',
          type: 'tree',
          sha: siteTree,
        },
      ],
    });
    if (mode === 'unchanged') {
      assert.equal(calls.length, 4);
      assert.deepEqual(result, {
        url: 'https://github.com/example/sites/commit/' + parent,
        changed: false,
      });
    } else {
      assert.deepEqual(calls[5], {
        path: '/repos/example/sites/git/refs/heads/public/main',
        method: 'PATCH',
        body: { sha: commit, force: false },
      });
      assert.deepEqual(
        result,
        mode === 'conflict'
          ? null
          : {
              url: 'https://github.com/example/sites/commit/' + commit,
              changed: true,
            },
      );
    }
  }
});
