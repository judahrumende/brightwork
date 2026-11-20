import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  appFunctionNetworkPolicy,
  runGeneratedAppFunction,
} from '../src/workspace/generated-app-functions';

test('sandbox egress permits only the broker POST path', () => {
  assert.deepEqual(appFunctionNetworkPolicy(), 'deny-all');
  assert.deepEqual(appFunctionNetworkPolicy('api.example.test'), 'deny-all');
  assert.deepEqual(
    appFunctionNetworkPolicy('api.example.test', 'short-lived-token'),
    {
      allow: {
        'api.example.test': [
          {
            match: {
              method: ['POST'],
              path: { exact: '/__foundable/function-capabilities' },
            },
            transform: [
              { headers: { Authorization: 'Bearer short-lived-token' } },
            ],
          },
          { response: { statusCode: 403 } },
        ],
      },
    },
  );
});

test('server function execution passes only JSON context and stops the sandbox', async () => {
  const writes: { path: string; content: string }[] = [];
  let stopped = false;
  let networkHost: string | undefined;
  let networkToken: string | undefined;
  let commandEnv: Record<string, string> | undefined;
  const result = await runGeneratedAppFunction(
    'export default async ({ input }) => input',
    { input: { count: 3 }, user: null },
    async (host, token) => {
      networkHost = host;
      networkToken = token;
      return {
        writeFiles: async (files) => writes.push(...files),
        runCommand: async (command, args, options) => {
          assert.equal(command, 'node');
          assert.deepEqual(args, ['invoke.mjs']);
          assert.equal(options.timeoutMs, 5_000);
          commandEnv = options.env;
          return { exitCode: 0 };
        },
        readFileToBuffer: async () => Buffer.from('{"count":3}'),
        stop: async () => {
          stopped = true;
        },
      };
    },
    {
      url: 'https://api.example.test/__foundable/function-capabilities',
      token: 'short-lived-token',
    },
  );
  assert.deepEqual(result, { count: 3 });
  assert.deepEqual(
    JSON.parse(writes.find((file) => file.path === 'input.json')!.content),
    {
      input: { count: 3 },
      user: null,
    },
  );
  assert.equal(stopped, true);
  assert.equal(networkHost, 'api.example.test');
  assert.equal(networkToken, 'short-lived-token');
  assert.deepEqual(commandEnv, {
    FOUNDABLE_CAPABILITY_URL:
      'https://api.example.test/__foundable/function-capabilities',
  });
  assert.doesNotMatch(
    writes.find((file) => file.path === 'invoke.mjs')!.content,
    /FOUNDABLE_CAPABILITY_TOKEN/u,
  );
  assert.match(
    writes.find((file) => file.path === 'invoke.mjs')!.content,
    /context\.records/u,
  );
  assert.match(
    writes.find((file) => file.path === 'invoke.mjs')!.content,
    /page:.*operation: 'page'/u,
  );
  assert.match(
    writes.find((file) => file.path === 'invoke.mjs')!.content,
    /batch:.*operation: 'batch'/u,
  );
});

test('server function execution rejects failed and oversized results and still stops', async () => {
  let stopped = false;
  await assert.rejects(
    runGeneratedAppFunction(
      'export default async () => null',
      { input: null, user: null },
      async () => ({
        writeFiles: async () => {},
        runCommand: async () => ({ exitCode: 1 }),
        readFileToBuffer: async () => Buffer.from('null'),
        stop: async () => {
          stopped = true;
        },
      }),
    ),
    /failed to complete/u,
  );
  assert.equal(stopped, true);
  stopped = false;
  await assert.rejects(
    runGeneratedAppFunction(
      'export default async () => null',
      { input: null, user: null },
      async () => ({
        writeFiles: async () => {},
        runCommand: async () => ({ exitCode: 0 }),
        readFileToBuffer: async () => Buffer.alloc(65_537),
        stop: async () => {
          stopped = true;
        },
      }),
    ),
    /invalid result/u,
  );
  assert.equal(stopped, true);
});

test('server function execution rejects oversized JSON input before creating a sandbox', async () => {
  let created = false;
  await assert.rejects(
    runGeneratedAppFunction(
      'export default async () => null',
      { input: 'x'.repeat(16_385), user: null },
      async () => {
        created = true;
        throw new Error('must not start');
      },
    ),
    /input exceeds 16 KiB/u,
  );
  assert.equal(created, false);
});

test('server function runtime brokers batch writes and paginated reads', async (t) => {
  const calls: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        result:
          calls.at(-1)?.operation === 'batch'
            ? [{ id: 'record-1' }, { id: 'record-2' }]
            : { records: [{ id: 'record-1' }], next: null },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const directory = await mkdtemp(join(tmpdir(), 'foundable-function-'));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });

  const result = await runGeneratedAppFunction(
    `export default async ({ records }) => {
      const changed = await records.batch([
        { operation: 'create', collection: 'tasks', data: { title: 'One' } },
        { operation: 'create', collection: 'tasks', data: { title: 'Two' } },
      ]);
      const page = await records.page('tasks', 10);
      return { changed, page };
    }`,
    { input: null, user: null },
    async (host, token) => {
      assert.equal(host, '127.0.0.1');
      assert.equal(token, 'short-lived-token');
      return {
        writeFiles: async (files) => {
          await Promise.all(
            files.map(({ path, content }) =>
              writeFile(join(directory, path), content),
            ),
          );
        },
        runCommand: async (command, args, options) => {
          const child = spawn(command, args, {
            cwd: directory,
            env: { ...process.env, ...options.env },
          });
          child.stdout.pipe(options.stdout);
          child.stderr.pipe(options.stderr);
          return new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (exitCode) =>
              resolve({ exitCode: exitCode ?? 1 }),
            );
          });
        },
        readFileToBuffer: async ({ path }) => readFile(join(directory, path)),
        stop: async () => undefined,
      };
    },
    {
      url: `http://127.0.0.1:${address.port}/__foundable/function-capabilities`,
      token: 'short-lived-token',
    },
  );
  assert.deepEqual(result, {
    changed: [{ id: 'record-1' }, { id: 'record-2' }],
    page: { records: [{ id: 'record-1' }], next: null },
  });
  assert.deepEqual(calls, [
    {
      operation: 'batch',
      operations: [
        { operation: 'create', collection: 'tasks', data: { title: 'One' } },
        { operation: 'create', collection: 'tasks', data: { title: 'Two' } },
      ],
    },
    { operation: 'page', collection: 'tasks', limit: 10 },
  ]);
});
