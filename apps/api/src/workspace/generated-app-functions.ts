import { Sandbox, type NetworkPolicy } from '@vercel/sandbox';
import { Writable } from 'node:stream';

const outputLimit = 64 * 1024;
const invokeScript = String.raw`import * as fs from 'node:fs/promises';
const readFile = fs.readFile.bind(fs);
const writeFile = fs.writeFile.bind(fs);
const parse = JSON.parse.bind(JSON);
const stringify = JSON.stringify.bind(JSON);
const byteLength = Buffer.byteLength.bind(Buffer);
const capabilityUrl = process.env.FOUNDABLE_CAPABILITY_URL;
const capability = async (body) => {
  if (!capabilityUrl) throw new Error('Record capabilities are unavailable.');
  const response = await fetch(capabilityUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stringify(body),
  });
  const text = await response.text();
  if (byteLength(text, 'utf8') > 65536) throw new Error('Record response exceeds 64 KiB.');
  const payload = parse(text);
  if (!response.ok) throw new Error(payload.message || 'Record capability failed.');
  return payload.result;
};
const handler = (await import('./function.mjs')).default;
if (typeof handler !== 'function') throw new Error('Function must export a default handler.');
const context = parse(await readFile('./input.json', 'utf8'));
context.records = {
  list: (collection = 'records', limit = 20) => capability({ operation: 'list', collection, limit }),
  page: (collection = 'records', limit = 20, cursor) => capability({ operation: 'page', collection, limit, ...(cursor ? { cursor } : {}) }),
  create: (collection, data) => capability({ operation: 'create', collection, data }),
  update: (collection, recordId, data) => capability({ operation: 'update', collection, recordId, data }),
  remove: (collection, recordId) => capability({ operation: 'delete', collection, recordId }),
  action: (collection, recordId, action) => capability({ operation: 'action', collection, recordId, action }),
  batch: (operations) => capability({ operation: 'batch', operations }),
};
const result = await handler(context);
const encoded = stringify(result);
if (encoded === undefined) throw new Error('Function must return JSON data.');
if (byteLength(encoded, 'utf8') > 65536) throw new Error('Function result exceeds 64 KiB.');
await writeFile('./result.json', encoded);
`;

type SandboxHandle = {
  writeFiles(files: { path: string; content: string }[]): Promise<void>;
  runCommand(
    command: string,
    args: string[],
    options: {
      timeoutMs: number;
      stdout: Writable;
      stderr: Writable;
      env?: Record<string, string>;
    },
  ): Promise<{ exitCode: number }>;
  readFileToBuffer(file: { path: string }): Promise<Buffer | null>;
  stop(): Promise<unknown>;
};

export function appFunctionNetworkPolicy(
  networkHost?: string,
  capabilityToken?: string,
): NetworkPolicy {
  return networkHost && capabilityToken
    ? {
        allow: {
          [networkHost]: [
            {
              match: {
                method: ['POST'],
                path: { exact: '/__foundable/function-capabilities' },
              },
              transform: [
                { headers: { Authorization: `Bearer ${capabilityToken}` } },
              ],
            },
            { response: { statusCode: 403 } },
          ],
        },
      }
    : 'deny-all';
}

async function createSandbox(networkHost?: string, capabilityToken?: string) {
  const networkPolicy = appFunctionNetworkPolicy(networkHost, capabilityToken);
  if (process.env.VERCEL_OIDC_TOKEN) {
    return Sandbox.create({
      runtime: 'node24',
      timeout: 60_000,
      persistent: false,
      resources: { vcpus: 1 },
      networkPolicy,
    });
  }
  if (
    !process.env.VERCEL_TOKEN ||
    !process.env.VERCEL_TEAM_ID ||
    !process.env.VERCEL_PROJECT_ID
  )
    throw new Error('Generated server functions are not configured.');
  return Sandbox.create({
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    runtime: 'node24',
    timeout: 60_000,
    persistent: false,
    resources: { vcpus: 1 },
    networkPolicy,
  });
}

export async function runGeneratedAppFunction(
  source: string,
  input: {
    input: unknown;
    user: { id: string; email: string; role: string } | null;
  },
  sandboxFactory: (
    networkHost?: string,
    capabilityToken?: string,
  ) => Promise<SandboxHandle> = createSandbox,
  functionCapability?: { url: string; token: string },
) {
  if (Buffer.byteLength(JSON.stringify(input.input) ?? 'null', 'utf8') > 16_384)
    throw new Error('Function input exceeds 16 KiB.');
  const capabilityHost = functionCapability
    ? new URL(functionCapability.url).hostname
    : undefined;
  const sandbox = await sandboxFactory(
    capabilityHost,
    functionCapability?.token,
  );
  const discard = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  try {
    await sandbox.writeFiles([
      { path: 'function.mjs', content: source },
      { path: 'invoke.mjs', content: invokeScript },
      { path: 'input.json', content: JSON.stringify(input) },
    ]);
    const command = await sandbox.runCommand('node', ['invoke.mjs'], {
      timeoutMs: 5_000,
      stdout: discard,
      stderr: discard,
      ...(functionCapability
        ? {
            env: {
              FOUNDABLE_CAPABILITY_URL: functionCapability.url,
            },
          }
        : {}),
    });
    if (command.exitCode !== 0)
      throw new Error('Generated function failed to complete.');
    const result = await sandbox.readFileToBuffer({ path: 'result.json' });
    if (!result || result.byteLength > outputLimit)
      throw new Error('Generated function returned an invalid result.');
    return JSON.parse(result.toString('utf8')) as unknown;
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
