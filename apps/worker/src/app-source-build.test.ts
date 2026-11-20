import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { appFiles, buildGeneratedAppSource } from './app-source-build';

test('compiled-preview inliner embeds JavaScript and CSS without external assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'foundable-app-build-'));
  try {
    await mkdir(path.join(root, 'dist/assets'), { recursive: true });
    await mkdir(path.join(root, 'scripts'));
    await writeFile(
      path.join(root, 'scripts/inline-build.mjs'),
      appFiles.find((file) => file.path === 'scripts/inline-build.mjs')!
        .content,
    );
    await writeFile(
      path.join(root, 'dist/index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
    );
    await writeFile(
      path.join(root, 'dist/assets/app.js'),
      `const root = document.getElementById("root"); const markup = '<script type="module" crossorigin src="/assets/index.js"></script><link rel="stylesheet" href="/unrelated.css">'; const marker = "</script>"; const replacement = "$&";`,
    );
    await writeFile(
      path.join(root, 'dist/assets/app.css'),
      'body{color:rebeccapurple;content:"$&"}',
    );
    await promisify(execFile)(process.execPath, ['scripts/inline-build.mjs'], {
      cwd: root,
    });
    const compiled = await readFile(
      path.join(root, 'dist/preview.html'),
      'utf8',
    );
    assert.match(compiled, /<script type="module">const root/u);
    assert.ok(compiled.includes('<\\/script>'));
    assert.ok(
      compiled.includes(
        '<style>body{color:rebeccapurple;content:"$&"}</style>',
      ),
    );
    const markup = compiled.replace(
      /<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/giu,
      '<$1$2></$1>',
    );
    assert.doesNotMatch(markup, /<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('isolated app builds use the fixed template and always stop the sandbox', async () => {
  const written: { path: string; content: string }[] = [];
  const commands: string[] = [];
  let networkLocked = false;
  let stopped = false;
  const result = await buildGeneratedAppSource(
    [
      {
        path: 'src/App.tsx',
        content: 'export default function App(){return <main/>}',
      },
      {
        path: 'src/components/summary-card.tsx',
        content: 'export function SummaryCard(){return <section/>}',
      },
      { path: 'src/styles.css', content: 'main{color:rebeccapurple}' },
      {
        path: 'src/functions/health.mjs',
        content: 'export default async () => ({ ok: true });',
      },
    ],
    async () => ({
      writeFiles: async (files) => {
        written.push(...files);
      },
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(' '));
        assert.equal(networkLocked, commands.length > 2);
        return {
          exitCode: 0,
          stdout: async () => 'ok',
          stderr: async () => '',
        };
      },
      readFileToBuffer: async () =>
        Buffer.from('<html><script type="module"></script></html>'),
      update: async (params) => {
        assert.deepEqual(params, { networkPolicy: 'deny-all' });
        networkLocked = true;
      },
      stop: async () => {
        stopped = true;
      },
    }),
  );
  assert.equal(result.passed, true);
  assert.equal(
    result.previewDocument,
    '<html><script type="module"></script></html>',
  );
  assert.deepEqual(commands, [
    'npm ci --ignore-scripts --no-audit --no-fund',
    'npm ci --prefix browser-check --ignore-scripts --no-audit --no-fund',
    'npm run typecheck',
    'node --check src/functions/health.mjs',
    'npm run build',
    'node browser-check/verify-preview.mjs',
  ]);
  assert.ok(written.some((file) => file.path === 'package-lock.json'));
  assert.ok(
    written.some((file) => file.path === 'browser-check/package-lock.json'),
  );
  assert.ok(
    written.some((file) => file.path === 'browser-check/verify-preview.mjs'),
  );
  const exportedPackage = JSON.parse(
    written.find((file) => file.path === 'package.json')?.content ?? '{}',
  );
  assert.equal(exportedPackage.name, 'foundable-generated-app');
  assert.equal('@sparticuz/chromium' in exportedPackage.dependencies, false);
  assert.equal('playwright-core' in exportedPackage.dependencies, false);
  const exportedLock = JSON.parse(
    written.find((file) => file.path === 'package-lock.json')?.content ?? '{}',
  );
  assert.equal(exportedLock.lockfileVersion, 3);
  assert.equal(exportedLock.name, exportedPackage.name);
  assert.deepEqual(
    exportedLock.packages[''].dependencies,
    exportedPackage.dependencies,
  );
  const browserPackage = JSON.parse(
    written.find((file) => file.path === 'browser-check/package.json')
      ?.content ?? '{}',
  );
  const browserLock = JSON.parse(
    written.find((file) => file.path === 'browser-check/package-lock.json')
      ?.content ?? '{}',
  );
  assert.equal(browserPackage.name, 'foundable-browser-check');
  assert.deepEqual(
    browserLock.packages[''].dependencies,
    browserPackage.dependencies,
  );
  assert.equal(
    written.filter((file) => file.path === 'src/styles.css').length,
    1,
  );
  assert.ok(
    written.some((file) => file.path === 'src/components/summary-card.tsx'),
  );
  assert.ok(
    written
      .find((file) => file.path === 'src/styles.css')
      ?.content.includes('rebeccapurple'),
  );
  assert.equal(stopped, true);
});

test('a failed source build reports diagnostics and stops the sandbox', async () => {
  let stopped = false;
  const result = await buildGeneratedAppSource(
    [
      {
        path: 'src/App.tsx',
        content: 'export default function App(){return <main/>}',
      },
    ],
    async () => ({
      writeFiles: async () => {},
      runCommand: async () => ({
        exitCode: 1,
        stdout: async () => '',
        stderr: async () => 'TS2322 type failure',
      }),
      readFileToBuffer: async () => null,
      update: async () => {},
      stop: async () => {
        stopped = true;
      },
    }),
  );
  assert.equal(result.passed, false);
  assert.match(result.log, /TS2322/u);
  assert.equal(stopped, true);
});

test('browser verification failures fail the app build and retain diagnostics', async () => {
  let stopped = false;
  const commands: string[] = [];
  const result = await buildGeneratedAppSource(
    [
      {
        path: 'src/App.tsx',
        content: 'export default function App(){return <main/>}',
      },
    ],
    async () => ({
      writeFiles: async () => {},
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(' '));
        const failed = args.join(' ') === 'browser-check/verify-preview.mjs';
        return {
          exitCode: failed ? 1 : 0,
          stdout: async () => '',
          stderr: async () =>
            failed ? '375px: horizontal overflow is 50px.' : '',
        };
      },
      readFileToBuffer: async () => Buffer.from('<html/>'),
      update: async () => {},
      stop: async () => {
        stopped = true;
      },
    }),
  );
  assert.equal(result.passed, false);
  assert.match(result.log, /horizontal overflow/u);
  assert.equal(commands.at(-1), 'node browser-check/verify-preview.mjs');
  assert.equal(stopped, true);
});
