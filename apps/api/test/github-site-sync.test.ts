import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedAppSourceHash } from '../src/workspace/generated-app-source';
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

test('GitHub source sync commits a runnable fixed template and immutable app source', async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const sync = githubSiteSync(
    { repo: 'example/sites', branch: 'main', token: 'fixture-token' },
    async (url, options) => {
      const target = new URL(String(url));
      calls.push({
        path: target.pathname,
        method: options?.method ?? '',
        body: options?.body ? JSON.parse(String(options.body)) : null,
      });
      const responses = [
        { object: { sha: '1'.repeat(40) } },
        { tree: { sha: '2'.repeat(40) } },
        { sha: '3'.repeat(40) },
        { sha: '4'.repeat(40) },
        { sha: '5'.repeat(40) },
        { object: { sha: '5'.repeat(40) } },
      ];
      return Response.json(responses[calls.length - 1]);
    },
  );
  const files = [
    { path: 'src/App.tsx', content: 'export default function App() {}' },
    { path: 'src/styles.css', content: 'main { color: navy; }' },
  ];
  const result = await sync({
    id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
    revision: 7,
    source: {
      sourceHash: generatedAppSourceHash(files),
      buildState: 'passed',
      sourceFiles: files,
    },
  });
  const subtree = (
    calls[2]?.body as { tree: { path: string; content: string }[] }
  ).tree;
  const entries = new Map(subtree.map(({ path, content }) => [path, content]));
  assert.equal(entries.get('app/package.json') !== undefined, true);
  assert.match(entries.get('app/package.json') ?? '', /"react":"19\.3\.1"/u);
  const packageLock = JSON.parse(
    entries.get('app/package-lock.json') ?? 'null',
  ) as { lockfileVersion: number };
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(entries.get('app/src/App.tsx'), files[0]?.content);
  assert.equal(entries.get('app/src/styles.css'), files[1]?.content);
  assert.match(entries.get('app/README.md') ?? '', /Foundable app runtime/u);
  const project = JSON.parse(
    entries.get('app/foundable-project.json') ?? 'null',
  ) as Record<string, unknown>;
  assert.deepEqual(project, {
    format: 'foundable-app-project-v1',
    revision: 7,
    sourceHash: generatedAppSourceHash(files),
    runtime: 'node22+',
    framework: 'vite-react-typescript',
    entrypoint: 'src/main.tsx',
    commands: ['npm ci', 'npm run typecheck', 'npm run build'],
    output: 'dist/preview.html',
    backend: 'Foundable managed app runtime',
  });
  const manifest = JSON.parse(
    entries.get('app/foundable-source.json') ?? 'null',
  ) as Record<string, unknown>;
  assert.deepEqual(manifest, {
    format: 'foundable-app-source-v1',
    revision: 7,
    sourceHash: generatedAppSourceHash(files),
    buildState: 'passed',
    files,
  });
  assert.deepEqual(result, {
    url: 'https://github.com/example/sites/commit/' + '5'.repeat(40),
    changed: true,
  });
});

test('GitHub source sync rejects invalid paths or a stale source hash before contacting GitHub', async () => {
  let requests = 0;
  const sync = githubSiteSync(
    { repo: 'example/sites', branch: 'main', token: 'fixture-token' },
    async () => {
      requests += 1;
      return Response.json({});
    },
  );
  const validFiles = [
    { path: 'src/App.tsx', content: 'export default function App() {}' },
  ];
  await assert.rejects(
    sync({
      id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
      revision: 8,
      source: {
        sourceHash: generatedAppSourceHash(validFiles),
        buildState: 'passed',
        sourceFiles: [{ path: '../secrets', content: 'invalid path' }],
      },
    }),
  );
  await assert.rejects(
    sync({
      id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
      revision: 8,
      source: {
        sourceHash: 'a'.repeat(64),
        buildState: 'passed',
        sourceFiles: validFiles,
      },
    }),
    /does not match its manifest/u,
  );
  assert.equal(requests, 0);
});
