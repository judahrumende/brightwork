import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { authEnv } from '../src/auth/config';
import { registerAuth } from '../src/auth/routes';
import { authStore } from '../src/auth/store';
import { connectDatabase } from '../src/db/database';
import { agentStore } from '../src/workspace/agent-store';
import { runStore } from '../src/workspace/run-store';
import { artifacts } from '../src/db/schema';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const capture = resolve(
  root,
  process.argv[2] ?? 'kit/har/foundable-loggedin-full-tour.har',
);
const source = 'https://foundable.com';
const { log } = JSON.parse(await readFile(capture, 'utf8')) as {
  log: { entries: { request: { url: string } }[] };
};
const workspaceIds = new Set<string>();
const historyVisits = new Map<string, number>();
const creationVisits = new Map<string, number>();
for (const entry of log.entries) {
  const url = new URL(entry.request.url);
  const workspace = url.pathname.match(
    /^\/api\/companies\/([0-9a-f-]{36})(?:\/|$)/u,
  )?.[1];
  if (url.origin !== source || !workspace) continue;
  workspaceIds.add(workspace);
  const creation = url.pathname.match(
    /\/creations\/([0-9a-f-]{36})(?:\/|$)/u,
  )?.[1];
  if (creation)
    creationVisits.set(creation, (creationVisits.get(creation) ?? 0) + 1);
  const history = url.pathname.match(
    /\/ted\/unattended\/([0-9a-f-]{36})$/u,
  )?.[1];
  if (history)
    historyVisits.set(history, (historyVisits.get(history) ?? 0) + 1);
}
assert.equal(
  workspaceIds.size,
  1,
  'This tour fixture must contain one captured workspace.',
);

const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const databaseUrl = new URL(
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
);
const redisUrl = new URL(process.env.REDIS_URL ?? '');
assert.ok(
  localHosts.has(databaseUrl.hostname),
  'Use a loopback fixture database.',
);
assert.ok(
  localHosts.has(redisUrl.hostname),
  'Use a loopback fixture Redis instance.',
);
const schema = 'replay_' + randomUUID().replaceAll('-', '');
const admin = postgres(databaseUrl.href, { max: 1, onnotice: () => {} });
databaseUrl.searchParams.set('search_path', schema);
const database = connectDatabase(databaseUrl.href);
const server = Fastify();
const secret = randomUUID();
try {
  await admin`create schema ${admin(schema)}`;
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    migrationsSchema: schema,
  });
  const store = authStore(database.db, secret);
  const { link } = await store.beginEmail('replay-owner@example.test');
  const token = await store.verifyLink(link);
  assert.ok(token);
  const account = await store.readSession(token);
  assert.ok(account);
  const workspace = await store.createBusiness(
    account.account.id,
    'Replay workspace',
    '',
  );
  const runs = runStore(database.db);
  const run = await runs.create(workspace.id, account.account.id, {
    goal: 'Launch a fixture business',
    steps: ['Draft a homepage', 'Plan launch outreach'],
    creditLimit: '5',
    publishWebsites: false,
  });
  assert.ok(run);
  const work = await runs.advance();
  assert.ok(work?.turnId);
  await database.db.insert(artifacts).values({
    businessId: workspace.id,
    turnId: work.turnId,
    kind: 'question',
    title: 'Which audience?',
    body: 'The homepage needs a target audience.',
    state: 'pending',
  });
  await runs.control(workspace.id, run.id, 'pause');
  const workStore = agentStore(database.db);
  await workStore.saveArtifact({
    businessId: workspace.id,
    kind: 'email',
    title: 'Fixture email draft',
    body: 'Review this outreach message.',
    state: 'pending',
  });
  await workStore.saveArtifact({
    businessId: workspace.id,
    kind: 'post',
    title: 'Fixture social post',
    body: 'Review this announcement.',
    state: 'pending',
  });
  const website = await workStore.saveArtifact({
    businessId: workspace.id,
    kind: 'website',
    title: 'Fixture website',
    body: '<p>Review the new homepage.</p>',
    state: 'pending',
  });
  const fixtureIds = Object.fromEntries(
    [...workspaceIds].map((id) => [id, workspace.id]),
  );
  const [primaryHistory] = [...historyVisits].sort((a, b) => b[1] - a[1]);
  if (primaryHistory) fixtureIds[primaryHistory[0]] = run.id;
  const [primaryCreation] = [...creationVisits].sort((a, b) => b[1] - a[1]);
  if (primaryCreation) fixtureIds[primaryCreation[0]] = website.id;
  const origin = 'http://127.0.0.1:5190';
  registerAuth(
    server,
    authEnv.parse({
      APP_ORIGIN: origin,
      AUTH_SECRET: secret,
      DATABASE_URL: databaseUrl.href,
      REDIS_URL: redisUrl.href,
    }),
  );
  await server.listen({ host: '127.0.0.1', port: 5190 });
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'scripts/replay-har.mjs', capture, origin],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        HAR_FIXTURE_SOURCE_ORIGIN: source,
        HAR_FIXTURE_ID_MAP: JSON.stringify(fixtureIds),
        HAR_FIXTURE_COOKIE: 'bw-session=' + token,
      },
    },
  );
  const [status] = await once(child, 'exit');
  process.exitCode = status ?? 1;
} finally {
  await server.close();
  await database.close();
  await admin`drop schema if exists ${admin(schema)} cascade`;
  await admin.end();
}
