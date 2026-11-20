import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import Redis from 'ioredis';
import Fastify from 'fastify';
import {
  accounts,
  agentTurns,
  artifacts,
  businesses,
  creditEntries,
  generatedAppSourceRevisions,
  members,
  publications,
  websiteVersions,
} from '../src/db/schema';
import { agentStore } from '../src/workspace/agent-store';
import {
  GeneratedAppRecordQuotaExceeded,
  generatedAppRecords,
} from '../src/workspace/generated-app-records';
import { generatedAppUsers } from '../src/workspace/generated-app-users';
import {
  AppStorageCreditsRequired,
  generatedAppStorage,
} from '../src/workspace/generated-app-storage';
import { generatedAppJobs } from '../src/workspace/generated-app-jobs';
import { generatedAppSourceStore } from '../src/workspace/generated-app-source-store';
import { siteHosting } from '../src/workspace/publication';
import { registerWorkspace } from '../src/workspace/routes';
import { signGeneratedAppFunctionCapability } from '../src/workspace/generated-app-function-capabilities';
import { creditConfig, creditLedger } from '../src/workspace/credits';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
test(
  'generated app data validates and stays isolated across apps and workspaces',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_app_records_' + randomUUID().replaceAll('-', '');
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    const connection = postgres(url, {
      max: 5,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    const db = drizzle(connection);
    t.after(async () => {
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
      .values([{ name: 'Owner' }, { name: 'Other' }])
      .returning();
    assert.ok(owner && other);
    const [workspaceOwner] = await db
      .insert(accounts)
      .values({ email: randomUUID() + '@example.test' })
      .returning();
    assert.ok(workspaceOwner);
    await db.insert(members).values({
      businessId: owner.id,
      accountId: workspaceOwner.id,
      role: 'owner',
    });
    const site = randomUUID();
    const otherAppSite = randomUUID();
    const migrationSite = randomUUID();
    await connection`insert into workspace_artifacts (id, business_id, kind, title, body) values
      (${site}, ${owner.id}, 'website', 'App', '<main></main>'),
      (${otherAppSite}, ${owner.id}, 'website', 'Other app', '<main></main>'),
      (${migrationSite}, ${owner.id}, 'website', 'Migration app', '<main></main>')`;
    await db.insert(publications).values({
      artifactId: site,
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    await db.insert(publications).values({
      artifactId: otherAppSite,
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    await db.insert(publications).values({
      artifactId: migrationSite,
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    await db.insert(websiteVersions).values({
      artifactId: site,
      revision: 1,
      title: 'App',
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    await db.insert(websiteVersions).values({
      artifactId: otherAppSite,
      revision: 1,
      title: 'Other app',
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    const records = generatedAppRecords(db);
    const storageCredits = creditLedger(
      db,
      creditConfig.parse({ STARTER_CREDITS: '1.0000000000' }),
    );
    const storage = generatedAppStorage(db, storageCredits, '1.0000000000');
    const appJobs = generatedAppJobs(db);
    await records.configureCollection(owner.id, migrationSite, 'tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
      ],
    });
    const migrationTask = await records.upsert(
      owner.id,
      migrationSite,
      undefined,
      { title: 'Migrate me' },
      'tasks',
    );
    assert.ok(migrationTask);
    await records.configureCollection(owner.id, migrationSite, 'tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [
        { name: 'title', type: 'text', required: false },
        { name: 'name', type: 'text', required: true, unique: true },
        { name: 'status', type: 'text', required: true },
      ],
      migrations: [
        { operation: 'copyField', from: 'title', to: 'name' },
        { operation: 'setField', field: 'status', value: 'ready' },
      ],
    });
    const migratedTask = (
      await records.list(owner.id, migrationSite, 'tasks')
    )[0];
    assert.deepEqual(migratedTask?.data, {
      title: 'Migrate me',
      name: 'Migrate me',
      status: 'ready',
    });
    const competingWrites = await Promise.allSettled([
      records.upsert(
        owner.id,
        migrationSite,
        undefined,
        { name: 'Concurrent', status: 'ready' },
        'tasks',
      ),
      records.upsert(
        owner.id,
        migrationSite,
        undefined,
        { name: 'Concurrent', status: 'ready' },
        'tasks',
      ),
    ]);
    assert.equal(
      competingWrites.filter(({ status }) => status === 'fulfilled').length,
      1,
    );
    assert.equal(
      competingWrites.filter(({ status }) => status === 'rejected').length,
      1,
    );
    await assert.rejects(
      records.configureCollection(owner.id, migrationSite, 'tasks', {
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [
          { name: 'title', type: 'text', required: false },
          { name: 'name', type: 'text', required: true },
          { name: 'status', type: 'text', required: true },
        ],
        migrations: [{ operation: 'copyField', from: 'title', to: 'name' }],
      }),
      /conflicts with existing app data/u,
    );
    assert.deepEqual(
      (await records.list(owner.id, migrationSite, 'tasks')).find(
        ({ id }) => id === migrationTask.id,
      )?.data,
      { title: 'Migrate me', name: 'Migrate me', status: 'ready' },
    );
    await records.configureCollection(owner.id, migrationSite, 'tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'status', type: 'text', required: true },
      ],
      migrations: [{ operation: 'removeField', field: 'title' }],
    });
    assert.deepEqual(
      (await records.list(owner.id, migrationSite, 'tasks')).find(
        ({ id }) => id === migrationTask.id,
      )?.data,
      { name: 'Migrate me', status: 'ready' },
    );
    await records.configureCollection(owner.id, migrationSite, 'accounts', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [{ name: 'email', type: 'text', required: true }],
    });
    const duplicateAccounts = await Promise.all([
      records.upsert(
        owner.id,
        migrationSite,
        undefined,
        { email: 'same@example.test' },
        'accounts',
      ),
      records.upsert(
        owner.id,
        migrationSite,
        undefined,
        { email: 'same@example.test' },
        'accounts',
      ),
    ]);
    assert.ok(duplicateAccounts.every(Boolean));
    await assert.rejects(
      records.configureCollection(owner.id, migrationSite, 'accounts', {
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [{ name: 'email', type: 'text', required: true, unique: true }],
      }),
      /Existing app records contain duplicate values for unique field email/u,
    );
    const duplicateAccountRows = await records.list(
      owner.id,
      migrationSite,
      'accounts',
    );
    assert.equal(duplicateAccountRows.length, 2);
    assert.ok(duplicateAccountRows[0]);
    await records.remove(
      owner.id,
      migrationSite,
      duplicateAccountRows[0].id,
      'accounts',
    );
    await records.configureCollection(owner.id, migrationSite, 'accounts', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [{ name: 'email', type: 'text', required: true, unique: true }],
      actions: [
        {
          name: 'reuse_email',
          label: 'Reuse existing email',
          field: 'email',
          value: 'same@example.test',
        },
      ],
    });
    await assert.rejects(
      records.upsert(
        owner.id,
        migrationSite,
        undefined,
        { email: 'same@example.test' },
        'accounts',
      ),
      /value for email is already in use/u,
    );
    await assert.rejects(
      records.publicBatch(migrationSite, [
        {
          operation: 'create',
          collection: 'accounts',
          data: { email: 'batch@example.test' },
        },
        {
          operation: 'create',
          collection: 'accounts',
          data: { email: 'batch@example.test' },
        },
      ]),
      /value for email is already in use/u,
    );
    assert.equal(
      (await records.list(owner.id, migrationSite, 'accounts')).length,
      1,
    );
    const actionAccount = await records.upsert(
      owner.id,
      migrationSite,
      undefined,
      { email: 'other@example.test' },
      'accounts',
    );
    assert.ok(actionAccount);
    await assert.rejects(
      records.publicAction(
        migrationSite,
        actionAccount.id,
        'reuse_email',
        'accounts',
      ),
      /value for email is already in use/u,
    );
    assert.ok(
      (await records.activity(owner.id, migrationSite)).some(
        ({ action, targetId }) =>
          action === 'record.schema_migrated' && targetId === migrationTask.id,
      ),
    );
    await assert.rejects(
      records.configureCollection(owner.id, migrationSite, 'tasks', {
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [{ name: 'required_new', type: 'text', required: true }],
        migrations: [{ operation: 'renameField', from: 'name', to: 'renamed' }],
      }),
      /conflicts with existing app data/u,
    );
    assert.deepEqual(
      (await records.list(owner.id, migrationSite, 'tasks')).find(
        ({ id }) => id === migrationTask.id,
      )?.data,
      { name: 'Migrate me', status: 'ready' },
    );
    const created = await records.upsert(owner.id, site, undefined, {
      label: 'hello',
    });
    assert.ok(created);
    assert.equal(created.collection, 'records');
    assert.equal((await records.list(owner.id, site)).length, 1);
    const otherAppRecord = await records.upsert(
      owner.id,
      otherAppSite,
      undefined,
      { label: 'Separate app record' },
    );
    assert.ok(otherAppRecord);
    assert.equal(
      (await records.list(owner.id, site)).some(
        ({ id }) => id === otherAppRecord.id,
      ),
      false,
    );
    assert.equal(
      (await records.list(owner.id, otherAppSite))[0]?.id,
      otherAppRecord.id,
    );
    await records.audit(
      owner.id,
      site,
      'fixture-actor',
      'record.created',
      created.id,
    );
    const activity = await records.activity(owner.id, site);
    assert.equal(activity[0]?.action, 'record.created');
    assert.equal(activity[0]?.actorId, 'fixture-actor');
    assert.equal((await records.activity(other.id, site)).length, 0);
    const task = await records.upsert(
      owner.id,
      site,
      undefined,
      { label: 'Task record' },
      'tasks',
    );
    assert.ok(task);
    assert.equal((await records.list(owner.id, site, 'tasks')).length, 1);
    assert.equal((await records.list(owner.id, site, 'notes')).length, 0);
    await records.configureCollection(owner.id, site, 'typed_tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [
        { name: 'title', type: 'text', required: true, unique: true },
        { name: 'estimate', type: 'number', required: false },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
      ],
      actions: [
        {
          name: 'mark_shipped',
          label: 'Mark shipped',
          field: 'status',
          value: 'shipped',
        },
      ],
    });
    assert.equal(
      (await records.collections(owner.id, otherAppSite)).some(
        ({ name }) => name === 'typed_tasks',
      ),
      false,
    );
    const typedTask = await records.upsert(
      owner.id,
      site,
      undefined,
      { title: 'Ship' },
      'typed_tasks',
    );
    assert.ok(typedTask);
    assert.equal(typedTask.data.status, 'open');
    const draftRecord = await records.publicUpsert(
      site,
      undefined,
      { title: 'Draft-only task' },
      'typed_tasks',
      undefined,
      { businessId: owner.id, revision: 1 },
    );
    assert.ok(draftRecord);
    await assert.rejects(
      records.publicUpsert(
        site,
        undefined,
        { title: 'Draft-only task' },
        'typed_tasks',
        undefined,
        { businessId: owner.id, revision: 1 },
      ),
      /value for title is already in use/u,
    );
    assert.equal(
      (await records.publicList(site, 'typed_tasks'))?.some(
        ({ id }) => id === draftRecord.id,
      ),
      false,
    );
    assert.ok(
      (
        await records.publicList(site, 'typed_tasks', undefined, {
          businessId: owner.id,
          revision: 1,
        })
      )?.some(({ id }) => id === draftRecord.id),
    );
    assert.equal(
      await records.publicList(site, 'typed_tasks', undefined, {
        businessId: other.id,
        revision: 1,
      }),
      null,
    );
    assert.equal(
      await records.publicList(site, 'typed_tasks', undefined, {
        businessId: owner.id,
        revision: 2,
      }),
      null,
    );
    assert.equal(
      (await records.list(owner.id, site, 'typed_tasks')).some(
        ({ id }) => id === draftRecord.id,
      ),
      false,
    );
    const users = generatedAppUsers(db, 'generated-app-user-test-secret');
    const challenge = await users.challenge(site, 'User@Example.test');
    const session = await users.verify(site, challenge.id, challenge.code);
    assert.ok(session);
    const appUser = await users.user(site, session);
    assert.equal(appUser?.role, 'user');
    assert.ok(appUser);
    assert.equal(await users.user(otherAppSite, session), null);
    assert.equal((await users.list(owner.id, otherAppSite)).length, 0);
    const appFile = await storage.put(site, appUser, {
      name: 'private.txt',
      mime: 'text/plain',
      data: Buffer.from('first app').toString('base64'),
    });
    assert.ok(appFile);
    const storageAnalytics = await records.analytics(owner.id, site);
    assert.equal(storageAnalytics.fileCount, 1);
    assert.equal(
      storageAnalytics.storageBytes,
      String(Buffer.byteLength('first app')),
    );
    assert.equal(storageAnalytics.storageCredits, '0.0000085831');
    const blockedUpload = await storage
      .put(site, appUser, {
        name: 'large.bin',
        mime: 'application/pdf',
        data: Buffer.alloc(1_048_576).toString('base64'),
      })
      .catch((error: unknown) => error);
    assert.ok(blockedUpload instanceof AppStorageCreditsRequired);
    assert.equal(await storage.remove(site, appFile.id, appUser), true);
    assert.equal((await records.analytics(owner.id, site)).storageCredits, '0');
    assert.equal(
      (await storageCredits.open(workspaceOwner.id)).available,
      '1.0000000000',
    );
    assert.deepEqual(
      (
        await db
          .select({ kind: creditEntries.kind, amount: creditEntries.amount })
          .from(creditEntries)
          .where(eq(creditEntries.accountId, workspaceOwner.id))
      )
        .filter(({ kind }) => kind === 'storage' || kind === 'refund')
        .map(({ kind, amount }) => [kind, amount]),
      [
        ['storage', '-0.0000085831'],
        ['refund', '0.0000085831'],
      ],
    );
    assert.equal(await storage.read(otherAppSite, appFile.id, appUser), null);
    assert.equal((await storage.list(otherAppSite, appUser)).length, 0);
    const invitation = await users.invite(
      owner.id,
      site,
      'Admin@Example.test',
      'admin',
      'fixture-owner',
    );
    assert.equal(invitation?.email, 'admin@example.test');
    assert.equal((await users.invitations(owner.id, site)).length, 1);
    const failedDeliveryChallenge = await users.challenge(
      site,
      'admin@example.test',
    );
    await assert.rejects(() =>
      users.deliverInvitation(site, failedDeliveryChallenge.id, async () => {
        throw new Error('fixture SMTP failure');
      }),
    );
    assert.equal(
      await users.verify(
        site,
        failedDeliveryChallenge.id,
        failedDeliveryChallenge.code,
      ),
      null,
    );
    const invitedChallenge = await users.challenge(site, 'admin@example.test');
    const invitedSession = await users.verify(
      site,
      invitedChallenge.id,
      invitedChallenge.code,
    );
    assert.ok(invitedSession);
    const invitedUser = await users.user(site, invitedSession);
    assert.equal(invitedUser?.role, 'admin');
    assert.equal((await users.invitations(owner.id, site)).length, 0);
    assert.ok(invitedUser);
    const http = Fastify();
    const fakeStore = {
      published: async () => ({
        document: '<!doctype html><html><body><main>Tasks</main></body></html>',
        pages: [],
        runtimeMode: 'app',
        revision: 1,
        businessId: owner.id,
        sourceDocument:
          '<!doctype html><html><head><style>main{color:rebeccapurple}</style></head><body><div id="root"></div><script type="module">document.getElementById("root").textContent="compiled app";</script></body></html>',
        sourceBuildState: 'passed',
        sourceFiles: [
          {
            path: 'src/functions/echo.mjs',
            content: 'export default async ({ input }) => input',
          },
        ],
      }),
      visit: async () => {},
      generatedStore: {},
    } as never;
    siteHosting(
      http,
      fakeStore,
      'http://dashboard.test',
      'apps.test',
      async () => {},
      undefined,
      undefined,
      records,
      users,
      undefined,
      storage,
      appJobs,
      async (source, context) => {
        assert.match(source, /export default async/u);
        return { received: context.input, user: context.user?.email ?? null };
      },
      'foundable-function-fixture-secret',
    );
    await http.ready();
    const host = `${site}.apps.test`;
    const hostedApp = await http.inject({
      method: 'GET',
      url: '/',
      headers: { host },
    });
    assert.equal(hostedApp.statusCode, 200, hostedApp.body);
    assert.match(hostedApp.body, /compiled app/u);
    assert.match(hostedApp.body, /<script type="module" nonce="[0-9a-f-]+">/u);
    const hostedRuntime = await http.inject({
      method: 'GET',
      url: '/_foundable/runtime.js',
      headers: { host },
    });
    assert.equal(hostedRuntime.statusCode, 200);
    assert.match(hostedRuntime.body, /foundableStorage/u);
    assert.match(hostedRuntime.body, /foundableJobs/u);
    assert.match(hostedRuntime.body, /foundableFunctions/u);
    assert.match(hostedRuntime.body, /foundable-load-more/u);
    assert.doesNotThrow(() => new Script(hostedRuntime.body));
    const functionCall = await http.inject({
      method: 'POST',
      url: '/__foundable/functions/echo',
      headers: { host, origin: `http://${host}` },
      payload: { input: { value: 'hello' } },
    });
    assert.equal(functionCall.statusCode, 200, functionCall.body);
    const functionResult = functionCall.json<{
      result: {
        received: { value: string };
        user: string | null;
      };
    }>().result;
    assert.deepEqual(functionResult.received, { value: 'hello' });
    assert.equal(functionResult.user, null);
    const liveCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: site,
        revision: 1,
        environment: 'live',
        user: null,
      },
    );
    await records.configureCollection(owner.id, site, 'function_tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [
        { name: 'title', type: 'text', required: true },
        {
          name: 'status',
          type: 'text',
          required: true,
          defaultValue: 'pending',
        },
      ],
      actions: [
        {
          name: 'mark_done',
          label: 'Mark done',
          field: 'status',
          value: 'done',
        },
      ],
    });
    const functionRecord = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${liveCapability}`,
      },
      payload: {
        operation: 'create',
        collection: 'function_tasks',
        data: { title: 'Created in isolated function' },
      },
    });
    assert.equal(functionRecord.statusCode, 200, functionRecord.body);
    assert.equal(
      functionRecord.json<{ result: { data: { title: string } } }>().result.data
        .title,
      'Created in isolated function',
    );
    const functionRecordId = functionRecord.json<{ result: { id: string } }>()
      .result.id;
    const batchToken = () =>
      signGeneratedAppFunctionCapability('foundable-function-fixture-secret', {
        businessId: owner.id,
        siteId: site,
        revision: 1,
        environment: 'live',
        user: null,
      });
    const batchCreate = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${await batchToken()}`,
      },
      payload: {
        operation: 'batch',
        operations: [
          {
            operation: 'create',
            collection: 'function_tasks',
            data: { title: 'Batch A' },
          },
          {
            operation: 'create',
            collection: 'function_tasks',
            data: { title: 'Batch B' },
          },
        ],
      },
    });
    assert.equal(batchCreate.statusCode, 200, batchCreate.body);
    const batchRecords = batchCreate.json<{ result: { id: string }[] }>()
      .result;
    assert.equal(batchRecords.length, 2);
    const batchChange = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${await batchToken()}`,
      },
      payload: {
        operation: 'batch',
        operations: [
          {
            operation: 'update',
            collection: 'function_tasks',
            recordId: batchRecords[0]!.id,
            data: { title: 'Batch updated', status: 'done' },
          },
          {
            operation: 'delete',
            collection: 'function_tasks',
            recordId: batchRecords[1]!.id,
          },
        ],
      },
    });
    assert.equal(batchChange.statusCode, 200, batchChange.body);
    const failedBatch = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${await batchToken()}`,
      },
      payload: {
        operation: 'batch',
        operations: [
          {
            operation: 'create',
            collection: 'function_tasks',
            data: { title: 'Must roll back' },
          },
          {
            operation: 'update',
            collection: 'function_tasks',
            recordId: randomUUID(),
            data: { title: 'Missing', status: 'done' },
          },
        ],
      },
    });
    assert.equal(failedBatch.statusCode, 403);
    assert.equal(
      (await records.list(owner.id, site, 'function_tasks')).some(
        ({ data }) => data.title === 'Must roll back',
      ),
      false,
    );
    const secondMutationWithSameCapability = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${liveCapability}`,
      },
      payload: {
        operation: 'update',
        collection: 'function_tasks',
        recordId: functionRecordId,
        data: { title: 'Must not be updated by the same invocation' },
      },
    });
    assert.equal(secondMutationWithSameCapability.statusCode, 409);
    const concurrentCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: site,
        revision: 1,
        environment: 'live',
        user: null,
      },
    );
    const concurrentMutations = await Promise.all([
      http.inject({
        method: 'POST',
        url: '/__foundable/function-capabilities',
        headers: {
          host: 'dashboard.test',
          authorization: `Bearer ${concurrentCapability}`,
        },
        payload: {
          operation: 'create',
          collection: 'function_tasks',
          data: { title: 'Concurrent mutation A' },
        },
      }),
      http.inject({
        method: 'POST',
        url: '/__foundable/function-capabilities',
        headers: {
          host: 'dashboard.test',
          authorization: `Bearer ${concurrentCapability}`,
        },
        payload: {
          operation: 'create',
          collection: 'function_tasks',
          data: { title: 'Concurrent mutation B' },
        },
      }),
    ]);
    assert.deepEqual(
      concurrentMutations.map(({ statusCode }) => statusCode).sort(),
      [200, 409],
    );
    const functionList = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${liveCapability}`,
      },
      payload: { operation: 'list', collection: 'function_tasks', limit: 5 },
    });
    assert.equal(functionList.statusCode, 200, functionList.body);
    assert.equal(
      functionList
        .json<{ result: { id: string; data: { title: string } }[] }>()
        .result.find(({ id }) => id === functionRecordId)?.data.title,
      'Created in isolated function',
    );
    assert.equal(
      functionList.json<{ result: { data: { status: string } }[] }>().result[0]
        ?.data.status,
      'pending',
    );
    const functionUpdate = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${await signGeneratedAppFunctionCapability(
          'foundable-function-fixture-secret',
          {
            businessId: owner.id,
            siteId: site,
            revision: 1,
            environment: 'live',
            user: null,
          },
        )}`,
      },
      payload: {
        operation: 'update',
        collection: 'function_tasks',
        recordId: functionRecordId,
        data: { title: 'Updated in function', status: 'pending' },
      },
    });
    assert.equal(functionUpdate.statusCode, 200, functionUpdate.body);
    const functionAction = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${await signGeneratedAppFunctionCapability(
          'foundable-function-fixture-secret',
          {
            businessId: owner.id,
            siteId: site,
            revision: 1,
            environment: 'live',
            user: null,
          },
        )}`,
      },
      payload: {
        operation: 'action',
        collection: 'function_tasks',
        recordId: functionRecordId,
        action: 'mark_done',
      },
    });
    assert.equal(functionAction.statusCode, 200, functionAction.body);
    assert.equal(
      functionAction.json<{ result: { data: { status: string } } }>().result
        .data.status,
      'done',
    );
    const wrongTenantCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: other.id,
        siteId: site,
        revision: 1,
        environment: 'live',
        user: null,
      },
    );
    const wrongTenantWrite = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${wrongTenantCapability}`,
      },
      payload: {
        operation: 'create',
        collection: 'function_tasks',
        data: { title: 'Must remain isolated' },
      },
    });
    assert.equal(wrongTenantWrite.statusCode, 403);
    const staleRevisionCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: site,
        revision: 2,
        environment: 'live',
        user: null,
      },
    );
    const staleRevisionWrite = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${staleRevisionCapability}`,
      },
      payload: {
        operation: 'create',
        collection: 'function_tasks',
        data: { title: 'Must not reach another revision' },
      },
    });
    assert.equal(staleRevisionWrite.statusCode, 403);
    const previewCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: site,
        revision: 1,
        environment: 'preview',
        user: { id: appUser.id, email: appUser.email, role: appUser.role },
      },
    );
    const previewFunctionWrite = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${previewCapability}`,
      },
      payload: {
        operation: 'create',
        collection: 'function_tasks',
        data: { title: 'Preview function data' },
      },
    });
    assert.equal(
      previewFunctionWrite.statusCode,
      200,
      previewFunctionWrite.body,
    );
    assert.equal(
      (await records.list(owner.id, site, 'function_tasks')).length,
      3,
    );
    assert.equal(
      (
        await records.publicList(site, 'function_tasks', appUser, {
          businessId: owner.id,
          revision: 1,
        })
      )?.[0]?.data.title,
      'Preview function data',
    );
    await records.configureCollection(
      owner.id,
      site,
      'private_function_tasks',
      {
        readAccess: 'authenticated',
        writeAccess: 'authenticated',
        ownerScoped: true,
        fields: [{ name: 'title', type: 'text', required: true }],
        actions: [],
      },
    );
    const privateDenied = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${liveCapability}`,
      },
      payload: { operation: 'list', collection: 'private_function_tasks' },
    });
    assert.equal(privateDenied.statusCode, 403);
    const authenticatedCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: site,
        revision: 1,
        environment: 'live',
        user: { id: appUser.id, email: appUser.email, role: appUser.role },
      },
    );
    const privateAllowed = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${authenticatedCapability}`,
      },
      payload: { operation: 'list', collection: 'private_function_tasks' },
    });
    assert.equal(privateAllowed.statusCode, 200, privateAllowed.body);
    assert.deepEqual(privateAllowed.json().result, []);
    const revokedUserCapability = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: site,
        revision: 1,
        environment: 'live',
        user: {
          id: randomUUID(),
          email: appUser.email,
          role: 'admin',
        },
      },
    );
    const revokedUserAccess = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${revokedUserCapability}`,
      },
      payload: { operation: 'list', collection: 'private_function_tasks' },
    });
    assert.equal(revokedUserAccess.statusCode, 401);
    const deletedFunctionRecord = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${await signGeneratedAppFunctionCapability(
          'foundable-function-fixture-secret',
          {
            businessId: owner.id,
            siteId: site,
            revision: 1,
            environment: 'live',
            user: null,
          },
        )}`,
      },
      payload: {
        operation: 'delete',
        collection: 'function_tasks',
        recordId: functionRecordId,
      },
    });
    assert.equal(deletedFunctionRecord.statusCode, 200);
    assert.equal(deletedFunctionRecord.json().result, true);
    const functionCrossOrigin = await http.inject({
      method: 'POST',
      url: '/__foundable/functions/echo',
      headers: { host, origin: 'https://evil.test' },
      payload: { input: null },
    });
    assert.equal(functionCrossOrigin.statusCode, 404);
    const stored = await http.inject({
      method: 'POST',
      url: '/__foundable/storage',
      headers: {
        host,
        origin: `http://${host}`,
        cookie: `bw-app-user=${session}`,
      },
      payload: {
        name: 'note.txt',
        mime: 'text/plain',
        data: Buffer.from('hello').toString('base64'),
      },
    });
    assert.equal(stored.statusCode, 201, stored.body);
    const fileId = stored.json<{ file: { id: string } }>().file.id;
    const unaffordableUpload = await http.inject({
      method: 'POST',
      url: '/__foundable/storage',
      headers: {
        host,
        origin: `http://${host}`,
        cookie: `bw-app-user=${session}`,
      },
      payload: {
        name: 'large.pdf',
        mime: 'application/pdf',
        data: Buffer.alloc(1_048_576).toString('base64'),
      },
    });
    assert.equal(unaffordableUpload.statusCode, 402);
    assert.match(
      unaffordableUpload.json<{ message: string }>().message,
      /needs more Foundable credits/u,
    );
    const listedFiles = await http.inject({
      method: 'GET',
      url: '/__foundable/storage',
      headers: { host, cookie: `bw-app-user=${session}` },
    });
    assert.equal(listedFiles.statusCode, 200, listedFiles.body);
    assert.equal(
      listedFiles.json<{ files: { id: string }[] }>().files[0]?.id,
      fileId,
    );
    const fileContent = await http.inject({
      method: 'GET',
      url: `/__foundable/storage/${fileId}`,
      headers: { host, cookie: `bw-app-user=${session}` },
    });
    assert.equal(
      Buffer.from(
        fileContent.json<{ file: { data: string } }>().file.data,
        'base64',
      ).toString(),
      'hello',
    );
    const anotherChallenge = await users.challenge(
      site,
      'another@example.test',
    );
    const anotherSession = await users.verify(
      site,
      anotherChallenge.id,
      anotherChallenge.code,
    );
    assert.ok(anotherSession);
    const privateFile = await http.inject({
      method: 'GET',
      url: `/__foundable/storage/${fileId}`,
      headers: { host, cookie: `bw-app-user=${anotherSession}` },
    });
    assert.equal(privateFile.statusCode, 404);
    const removedFile = await http.inject({
      method: 'DELETE',
      url: `/__foundable/storage/${fileId}`,
      headers: {
        host,
        origin: `http://${host}`,
        cookie: `bw-app-user=${session}`,
      },
    });
    assert.equal(removedFile.statusCode, 204);
    const scheduled = await http.inject({
      method: 'POST',
      url: '/__foundable/jobs',
      headers: {
        host,
        origin: `http://${host}`,
        cookie: `bw-app-user=${session}`,
      },
      payload: {
        id: randomUUID(),
        collection: 'typed_tasks',
        recordId: typedTask.id,
        action: 'mark_shipped',
        runAt: new Date(Date.now() + 15_000).toISOString(),
      },
    });
    assert.equal(scheduled.statusCode, 202, scheduled.body);
    const scheduledJob = scheduled.json<{ job: { id: string } }>().job;
    const claimedJob = await appJobs.claim(new Date(Date.now() + 20_000));
    assert.equal(claimedJob?.id, scheduledJob.id);
    assert.equal(await appJobs.current(claimedJob!), true);
    const scheduledActor = await users.byEmail(site, 'user@example.test');
    assert.ok(scheduledActor);
    const actionResult = await records.publicAction(
      site,
      claimedJob!.recordId,
      claimedJob!.action,
      claimedJob!.collection,
      scheduledActor,
    );
    assert.equal(actionResult?.data.status, 'shipped');
    assert.equal(await appJobs.finish(claimedJob!), true);
    assert.equal(
      (await appJobs.listForUser(site, scheduledActor))[0]?.state,
      'succeeded',
    );
    const leaseJob = await appJobs.enqueue(owner.id, site, scheduledActor, {
      id: randomUUID(),
      collection: 'typed_tasks',
      recordId: typedTask.id,
      action: 'mark_shipped',
      runAt: new Date(Date.now() + 15_000).toISOString(),
    });
    assert.ok(leaseJob);
    assert.equal(
      (await appJobs.listForUser(otherAppSite, scheduledActor)).length,
      0,
    );
    const firstLease = await appJobs.claim(new Date(Date.now() + 20_000));
    assert.equal(firstLease?.id, leaseJob.id);
    const reclaimedLease = await appJobs.claim(new Date(Date.now() + 81_000));
    assert.equal(reclaimedLease?.id, leaseJob.id);
    assert.equal(reclaimedLease?.attempts, 2);
    assert.notEqual(reclaimedLease?.lease, firstLease?.lease);
    assert.equal(
      await appJobs.retry(reclaimedLease!, new Error('retry once')),
      true,
    );
    const finalLease = await appJobs.claim(new Date(Date.now() + 40_000));
    assert.equal(finalLease?.id, leaseJob.id);
    assert.equal(finalLease?.attempts, 3);
    assert.equal(
      await appJobs.retry(finalLease!, new Error('final retry')),
      true,
    );
    assert.equal(
      (await appJobs.listForUser(site, scheduledActor)).find(
        (job) => job.id === leaseJob.id,
      )?.state,
      'failed',
    );
    assert.doesNotMatch(hostedApp.body, /<main>Tasks<\/main>/u);
    assert.match(
      hostedApp.headers['content-security-policy'] ?? '',
      /script-src 'self' 'nonce-/u,
    );
    assert.match(hostedApp.body, /_foundable\/runtime\.js/u);
    const actionPath = `/__foundable/records/${typedTask.id}/actions?collection=typed_tasks`;
    const publicAction = await http.inject({
      method: 'POST',
      url: actionPath,
      headers: { host, origin: `http://${host}` },
      payload: { action: 'mark_shipped' },
    });
    assert.equal(publicAction.statusCode, 200, publicAction.body);
    const list = await http.inject({
      method: 'GET',
      url: '/__foundable/records?collection=typed_tasks',
      headers: { host },
    });
    assert.equal(list.json().records[0].actions[0].label, 'Mark shipped');
    await records.configureCollection(owner.id, site, 'typed_tasks', {
      readAccess: 'public',
      writeAccess: 'authenticated',
      ownerScoped: false,
      fields: [
        { name: 'title', type: 'text', required: true, unique: true },
        { name: 'estimate', type: 'number', required: false },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
      ],
      actions: [
        {
          name: 'mark_shipped',
          label: 'Mark shipped',
          field: 'status',
          value: 'shipped',
        },
      ],
    });
    const anonymousDenied = await http.inject({
      method: 'POST',
      url: actionPath,
      headers: { host, origin: `http://${host}` },
      payload: { action: 'mark_shipped' },
    });
    assert.equal(anonymousDenied.statusCode, 404);
    const signedInAllowed = await http.inject({
      method: 'POST',
      url: actionPath,
      headers: {
        host,
        origin: `http://${host}`,
        cookie: `bw-app-user=${session}`,
      },
      payload: { action: 'mark_shipped' },
    });
    assert.equal(signedInAllowed.statusCode, 200, signedInAllowed.body);
    await records.configureCollection(owner.id, site, 'typed_tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [
        { name: 'title', type: 'text', required: true, unique: true },
        { name: 'estimate', type: 'number', required: false },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
      ],
      actions: [
        {
          name: 'mark_shipped',
          label: 'Mark shipped',
          field: 'status',
          value: 'shipped',
        },
      ],
    });
    const shippedTask = await records.publicAction(
      site,
      typedTask.id,
      'mark_shipped',
      'typed_tasks',
    );
    assert.equal(shippedTask?.data.status, 'shipped');
    assert.equal(
      (await records.activity(owner.id, site))[0]?.action,
      'record.workflow_action',
    );
    await assert.rejects(() =>
      records.upsert(owner.id, site, undefined, { title: 5 }, 'typed_tasks'),
    );
    await assert.rejects(() =>
      records.upsert(
        owner.id,
        site,
        undefined,
        { title: 'Ship', extra: true },
        'typed_tasks',
      ),
    );
    const analytics = await records.analytics(owner.id, site);
    assert.equal(analytics.recordCount, 5);
    assert.equal(analytics.collectionCount, 5);
    const paginationSite = randomUUID();
    await connection`insert into workspace_artifacts (id, business_id, kind, title, body)
      values (${paginationSite}, ${owner.id}, 'website', 'Pagination fixture', '<main></main>')`;
    await db.insert(websiteVersions).values({
      artifactId: paginationSite,
      revision: 1,
      title: 'Pagination fixture',
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    await db.insert(publications).values({
      artifactId: paginationSite,
      draftRevision: 1,
      document: '<!doctype html><html><body></body></html>',
      pages: [],
      runtimeMode: 'app',
    });
    await records.configureCollection(owner.id, paginationSite, 'tasks', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
    });
    await connection`insert into generated_app_records
      (site_id, environment, data_revision, id, collection, data, created_at, updated_at)
      select ${paginationSite}, 'live', 0, gen_random_uuid(), 'tasks', jsonb_build_object('n', n),
        now() - n * interval '1 microsecond', now() - n * interval '1 microsecond'
      from generate_series(1, 101) as seed(n)`;
    const firstRecordPage = await http.inject({
      method: 'GET',
      url: '/__foundable/records?collection=tasks',
      headers: { host: `${paginationSite}.apps.test` },
    });
    assert.equal(firstRecordPage.statusCode, 200, firstRecordPage.body);
    assert.equal(firstRecordPage.json().records.length, 100);
    assert.equal('cursorUpdatedAt' in firstRecordPage.json().records[0], false);
    assert.ok(firstRecordPage.json().next);
    const nextRecordPage = firstRecordPage.json<{
      next: { before: string; id: string };
    }>().next;
    assert.match(nextRecordPage.before, /\.\d{6}Z$/u);
    const secondRecordPage = await http.inject({
      method: 'GET',
      url:
        '/__foundable/records?collection=tasks&before=' +
        encodeURIComponent(nextRecordPage.before) +
        '&id=' +
        nextRecordPage.id,
      headers: { host: `${paginationSite}.apps.test` },
    });
    assert.equal(secondRecordPage.statusCode, 200, secondRecordPage.body);
    assert.equal(secondRecordPage.json().records.length, 1);
    assert.equal(secondRecordPage.json().next, null);
    const dashboardPageOne = await records.list(
      owner.id,
      paginationSite,
      'tasks',
      undefined,
      101,
      true,
    );
    assert.equal(dashboardPageOne.length, 101);
    const dashboardPageTwo = await records.list(
      owner.id,
      paginationSite,
      'tasks',
      {
        updatedAt: dashboardPageOne[99]!.cursorUpdatedAt,
        id: dashboardPageOne[99]!.id,
      },
      101,
      true,
    );
    assert.equal(dashboardPageTwo.length, 1);
    await connection`insert into generated_app_files
      (site_id, environment, data_revision, id, owner_email, name, mime, bytes, created_at)
      select ${paginationSite}, 'live', 0, gen_random_uuid(),
        'file-user-' || n || '@example.test', 'file-' || n || '.txt', 'text/plain',
        decode('41', 'hex'), now() - n * interval '1 microsecond'
      from generate_series(1, 101) as seed(n)`;
    const dashboardFilePageOne = await storage.listForWorkspace(
      owner.id,
      paginationSite,
      undefined,
      101,
      true,
    );
    assert.equal(dashboardFilePageOne.length, 101);
    const dashboardFilePageTwo = await storage.listForWorkspace(
      owner.id,
      paginationSite,
      {
        createdAt: dashboardFilePageOne[99]!.cursorCreatedAt,
        id: dashboardFilePageOne[99]!.id,
      },
      101,
      true,
    );
    assert.equal(dashboardFilePageTwo.length, 1);
    await connection`insert into generated_app_jobs
      (site_id, environment, data_revision, schema_revision, id, actor_id,
        actor_email, collection, record_id, action, run_at, state, created_at)
      select ${paginationSite}, 'live', 0, 1, gen_random_uuid(), gen_random_uuid(),
        'job-user-' || n || '@example.test', 'tasks', gen_random_uuid(), 'mark_done',
        now() + n * interval '1 microsecond', 'succeeded', now() - n * interval '1 microsecond'
      from generate_series(1, 101) as seed(n)`;
    const dashboardJobPageOne = await appJobs.listForWorkspace(
      owner.id,
      paginationSite,
      undefined,
      101,
      true,
    );
    assert.equal(dashboardJobPageOne.length, 101);
    const dashboardJobPageTwo = await appJobs.listForWorkspace(
      owner.id,
      paginationSite,
      {
        runAt: dashboardJobPageOne[99]!.cursorRunAt,
        createdAt: dashboardJobPageOne[99]!.cursorCreatedAt,
        id: dashboardJobPageOne[99]!.id,
      },
      101,
      true,
    );
    assert.equal(dashboardJobPageTwo.length, 1);
    await connection`insert into generated_app_users (site_id, email, role, created_at, updated_at)
      select ${paginationSite}, 'page-user-' || n || '@example.test', 'user',
        now() - n * interval '1 microsecond', now() - n * interval '1 microsecond'
      from generate_series(1, 101) as seed(n)`;
    await connection`insert into generated_app_invites (site_id, email, role, invited_by, expires_at, created_at)
      select ${paginationSite}, 'page-invite-' || n || '@example.test', 'user', ${workspaceOwner.id},
        now() + interval '7 days', now() - n * interval '1 microsecond'
      from generate_series(1, 101) as seed(n)`;
    await connection`insert into generated_app_activity (site_id, actor_id, action, target_id, created_at)
      select ${paginationSite}, ${workspaceOwner.id}, 'record.created', gen_random_uuid(),
        now() - n * interval '1 microsecond'
      from generate_series(1, 101) as seed(n)`;
    const dashboardUsersPageOne = await users.list(
      owner.id,
      paginationSite,
      undefined,
      101,
      true,
    );
    const dashboardUsersPageTwo = await users.list(
      owner.id,
      paginationSite,
      {
        createdAt: dashboardUsersPageOne[99]!.cursorCreatedAt,
        id: dashboardUsersPageOne[99]!.id,
      },
      101,
      true,
    );
    assert.equal(dashboardUsersPageTwo.length, 1);
    const dashboardInvitationsPageOne = await users.invitations(
      owner.id,
      paginationSite,
      undefined,
      101,
      true,
    );
    const dashboardInvitationsPageTwo = await users.invitations(
      owner.id,
      paginationSite,
      {
        createdAt: dashboardInvitationsPageOne[99]!.cursorCreatedAt,
        id: dashboardInvitationsPageOne[99]!.id,
      },
      101,
      true,
    );
    assert.equal(dashboardInvitationsPageTwo.length, 1);
    const dashboardActivityPageOne = await records.activity(
      owner.id,
      paginationSite,
      undefined,
      101,
      true,
    );
    const dashboardActivityPageTwo = await records.activity(
      owner.id,
      paginationSite,
      {
        createdAt: dashboardActivityPageOne[99]!.cursorCreatedAt,
        id: dashboardActivityPageOne[99]!.id,
      },
      101,
      true,
    );
    assert.equal(dashboardActivityPageTwo.length, 1);
    const functionPageToken = await signGeneratedAppFunctionCapability(
      'foundable-function-fixture-secret',
      {
        businessId: owner.id,
        siteId: paginationSite,
        revision: 1,
        environment: 'live',
        user: null,
      },
    );
    const functionPageOne = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${functionPageToken}`,
      },
      payload: { operation: 'page', collection: 'tasks', limit: 20 },
    });
    assert.equal(functionPageOne.statusCode, 200, functionPageOne.body);
    const functionPage = functionPageOne.json<{
      result: {
        records: { id: string }[];
        next: { before: string; id: string } | null;
      };
    }>().result;
    assert.equal(functionPage.records.length, 20);
    assert.ok(functionPage.next);
    const functionPageTwo = await http.inject({
      method: 'POST',
      url: '/__foundable/function-capabilities',
      headers: {
        host: 'dashboard.test',
        authorization: `Bearer ${functionPageToken}`,
      },
      payload: {
        operation: 'page',
        collection: 'tasks',
        limit: 20,
        cursor: functionPage.next,
      },
    });
    assert.equal(functionPageTwo.statusCode, 200, functionPageTwo.body);
    assert.equal(
      functionPageTwo.json<{ result: { records: { id: string }[] } }>().result
        .records.length,
      20,
    );
    assert.notEqual(
      functionPageTwo.json<{ result: { records: { id: string }[] } }>().result
        .records[0]?.id,
      functionPage.records[0]?.id,
    );
    await assert.rejects(() =>
      records.upsert(owner.id, site, undefined, { label: 'bad' }, '../private'),
    );
    await assert.rejects(() =>
      records.configureCollection(owner.id, site, 'invalid_default', {
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [
          {
            name: 'count',
            type: 'number',
            required: false,
            defaultValue: 'many',
          },
        ],
      }),
    );
    await assert.rejects(() =>
      records.configureCollection(owner.id, site, 'invalid_action', {
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [{ name: 'count', type: 'number', required: false }],
        actions: [{ name: 'bad', label: 'Bad', field: 'count', value: 'many' }],
      }),
    );
    assert.equal((await records.list(other.id, site)).length, 0);
    await assert.rejects(() => records.upsert(owner.id, site, undefined, []));
    await assert.rejects(() =>
      records.upsert(owner.id, site, undefined, { data: 'x'.repeat(17_000) }),
    );
    assert.equal(await records.remove(owner.id, site, created.id), true);
    assert.equal((await records.list(owner.id, site)).length, 4);
    const toolCallId = randomUUID();
    const [turn] = await db
      .insert(agentTurns)
      .values({
        businessId: owner.id,
        prompt: 'Build a task app.',
        state: 'running',
        parts: [{ type: 'tool', name: 'build', toolCallId, status: 'running' }],
      })
      .returning();
    assert.ok(turn);
    const built = await agentStore(db).saveGeneratedWebsite({
      businessId: owner.id,
      turnId: turn.id,
      toolCallId,
      title: 'Built tasks',
      body: '<!doctype html><html><body><main>Tasks</main></body></html>',
      pages: [],
      runtimeMode: 'app',
      sourceFiles: [
        {
          path: 'src/App.tsx',
          content: 'export default function App(){return <main/>}',
        },
        {
          path: 'src/functions/health.mjs',
          content: 'export default async () => ({ ok: true });',
        },
      ],
      appCollections: [
        {
          name: 'tasks',
          readAccess: 'public',
          writeAccess: 'public',
          ownerScoped: false,
          fields: [
            { name: 'title', type: 'text', required: true },
            {
              name: 'status',
              type: 'text',
              required: true,
              defaultValue: 'open',
            },
          ],
        },
      ],
    });
    assert.ok(built);
    const [meterAccount] = await db
      .insert(accounts)
      .values({ email: randomUUID() + '@example.test' })
      .returning();
    assert.ok(meterAccount);
    await db.insert(creditEntries).values([
      {
        accountId: meterAccount.id,
        turnId: turn.id,
        operationKey: 'meter:model',
        kind: 'model',
        amount: '-0.2500000000',
      },
      {
        accountId: meterAccount.id,
        turnId: turn.id,
        operationKey: 'meter:tool',
        kind: 'tool',
        amount: '-0.0500000000',
      },
    ]);
    const [otherProjectTurn] = await db
      .insert(agentTurns)
      .values({
        businessId: owner.id,
        prompt: 'Build another app.',
        state: 'completed',
      })
      .returning();
    assert.ok(otherProjectTurn);
    await db
      .update(websiteVersions)
      .set({ turnId: otherProjectTurn.id })
      .where(eq(websiteVersions.artifactId, otherAppSite));
    await db.insert(creditEntries).values({
      accountId: meterAccount.id,
      turnId: otherProjectTurn.id,
      operationKey: 'other-project:model',
      kind: 'model',
      amount: '-9.0000000000',
    });
    await connection`insert into media_jobs
      (id, business_id, account_id, site_id, kind, prompt, credits, state) values
      (${randomUUID()}, ${owner.id}, ${meterAccount.id}, ${built.id}, 'image', 'logo', 2, 'completed'),
      (${randomUUID()}, ${owner.id}, ${meterAccount.id}, ${built.id}, 'image', 'failed logo', 3, 'failed'),
      (${randomUUID()}, ${owner.id}, ${meterAccount.id}, ${otherAppSite}, 'video', 'other app', 8, 'completed')`;
    const metered = await records.analytics(owner.id, built.id);
    assert.equal(metered.modelCredits, 0.25);
    assert.equal(metered.toolCredits, 0.05);
    assert.equal(metered.totalCredits, 0.3);
    assert.equal(metered.mediaJobs, 1);
    assert.equal(metered.mediaCredits, '2.0000000000');
    const source = await agentStore(db).appSourceRevision(
      owner.id,
      built.id,
      built.revision,
    );
    assert.deepEqual(source?.sourceFiles, [
      {
        path: 'src/App.tsx',
        content: 'export default function App(){return <main/>}',
      },
      {
        path: 'src/functions/health.mjs',
        content: 'export default async () => ({ ok: true });',
      },
    ]);
    assert.match(source?.sourceHash ?? '', /^[0-9a-f]{64}$/u);
    assert.equal(source?.buildState, 'queued');
    assert.ok(source);
    assert.equal(
      await agentStore(db).appSourceRevision(
        other.id,
        built.id,
        built.revision,
      ),
      null,
    );
    const sourceBuilds = generatedAppSourceStore(db);
    const buildJob = await sourceBuilds.claim();
    assert.equal(buildJob?.siteId, built.id);
    assert.equal(buildJob?.buildState, 'building');
    assert.equal(buildJob?.buildAttempts, 1);
    const builtPreviewDocument = '<!doctype html><html><body></body></html>';
    assert.equal(
      await sourceBuilds.finish(built.id, built.revision, {
        passed: true,
        log: 'typecheck and build passed',
        previewDocument: builtPreviewDocument,
      }),
      true,
    );
    assert.equal(await sourceBuilds.claim(), null);
    const verifiedToolCallId = randomUUID();
    const [verifiedTurn] = await db
      .insert(agentTurns)
      .values({
        businessId: owner.id,
        prompt: 'Build a verified task app.',
        state: 'running',
        parts: [
          {
            type: 'tool',
            name: 'build',
            toolCallId: verifiedToolCallId,
            status: 'running',
          },
        ],
      })
      .returning();
    assert.ok(verifiedTurn);
    const verifiedBuild = await agentStore(db).saveGeneratedWebsite({
      businessId: owner.id,
      turnId: verifiedTurn.id,
      toolCallId: verifiedToolCallId,
      title: 'Verified tasks',
      body: '<!doctype html><html><body><main>Tasks</main></body></html>',
      pages: [],
      runtimeMode: 'app',
      sourceFiles: [
        {
          path: 'src/App.tsx',
          content: 'export default function App(){return <main/>}',
        },
      ],
      sourceBuildResult: {
        log: 'typecheck and production build passed',
        previewDocument: builtPreviewDocument,
      },
    });
    assert.ok(verifiedBuild);
    const verifiedPreview = await agentStore(db).appSourcePreview(
      owner.id,
      verifiedBuild.id,
      verifiedBuild.revision,
    );
    assert.equal(verifiedPreview?.buildState, 'passed');
    assert.equal(verifiedPreview?.previewDocument, builtPreviewDocument);
    await db.insert(generatedAppSourceRevisions).values({
      siteId: built.id,
      revision: 99,
      sourceFiles: [
        {
          path: 'src/App.tsx',
          content: 'export default function App(){return <main/>}',
        },
      ],
      sourceHash: 'fixture-hash',
      buildState: 'queued',
    });
    const interruptedBuild = await sourceBuilds.claim();
    assert.equal(interruptedBuild?.buildAttempts, 1);
    await db
      .update(generatedAppSourceRevisions)
      .set({ buildLeaseUntil: new Date(Date.now() - 1_000) })
      .where(eq(generatedAppSourceRevisions.revision, 99));
    const reclaimedBuild = await sourceBuilds.claim();
    assert.equal(reclaimedBuild?.buildAttempts, 2);
    await db
      .update(generatedAppSourceRevisions)
      .set({ buildLeaseUntil: new Date(Date.now() - 1_000) })
      .where(eq(generatedAppSourceRevisions.revision, 99));
    assert.equal(await sourceBuilds.claim(), null);
    const [exhaustedBuild] = await db
      .select()
      .from(generatedAppSourceRevisions)
      .where(eq(generatedAppSourceRevisions.revision, 99));
    assert.equal(exhaustedBuild?.buildState, 'failed');
    const provisioned = await records.collections(owner.id, built.id);
    assert.deepEqual(provisioned.find((row) => row.name === 'tasks')?.fields, [
      { name: 'title', type: 'text', required: true },
      { name: 'status', type: 'text', required: true, defaultValue: 'open' },
    ]);
    await db
      .update(artifacts)
      .set({ state: 'approved' })
      .where(eq(artifacts.id, built.id));
    assert.equal(
      await agentStore(db).publish(owner.id, built.id, built.revision, true),
      true,
    );
    assert.equal(
      (await agentStore(db).published(built.id))?.sourceDocument,
      builtPreviewDocument,
    );
    await records.configureCollection(owner.id, built.id, 'hidden', {
      readAccess: 'admin',
      writeAccess: 'admin',
      ownerScoped: false,
      fields: [{ name: 'secret', type: 'text', required: true }],
    });
    const hiddenRecord = await records.publicUpsert(
      built.id,
      undefined,
      { secret: 'workspace-only' },
      'hidden',
      { id: randomUUID(), email: 'admin@example.test', role: 'admin' },
    );
    assert.ok(hiddenRecord);
    await assert.rejects(
      records.configureCollection(owner.id, built.id, 'hidden', {
        readAccess: 'admin',
        writeAccess: 'admin',
        ownerScoped: false,
        fields: [
          { name: 'secret', type: 'text', required: true },
          { name: 'label', type: 'text', required: true },
        ],
      }),
      /existing app data/u,
    );
    const safeHiddenSchema = await records.configureCollection(
      owner.id,
      built.id,
      'hidden',
      {
        readAccess: 'admin',
        writeAccess: 'admin',
        ownerScoped: false,
        fields: [
          { name: 'secret', type: 'text', required: true },
          {
            name: 'label',
            type: 'text',
            required: true,
            defaultValue: 'legacy',
          },
        ],
      },
    );
    assert.equal(safeHiddenSchema?.fields.length, 2);
    assert.ok(
      (
        await records.publicList(built.id, 'hidden', {
          id: randomUUID(),
          email: 'admin@example.test',
          role: 'admin',
        })
      )?.some(
        ({ id, data }) => id === hiddenRecord.id && data.label === 'legacy',
      ),
    );
    assert.equal(await records.publicList(built.id, 'hidden'), null);
    const nextDraft = await agentStore(db).editWebsite(
      owner.id,
      built.id,
      1,
      'Built tasks',
      '<!doctype html><html><body><main>Tasks v2</main></body></html>',
    );
    assert.equal(nextDraft?.revision, 2);
    await connection`delete from generated_app_collections
      where site_id = ${built.id} and revision = 2 and name = 'hidden'`;
    await db
      .update(artifacts)
      .set({ state: 'approved' })
      .where(eq(artifacts.id, built.id));
    assert.equal(
      await agentStore(db).publish(owner.id, built.id, 2, true),
      false,
    );
    assert.equal(
      (await agentStore(db).published(built.id))?.sourceDocument,
      builtPreviewDocument,
    );
    await connection`update generated_app_collections
      set fields = ${JSON.stringify([
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
        { name: 'done', type: 'boolean', required: true },
      ])}::jsonb
      where site_id = ${built.id} and revision = 2 and name = 'tasks'`;
    assert.deepEqual(
      (await records.collections(owner.id, built.id)).find(
        (row) => row.name === 'tasks',
      )?.fields,
      [
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
      ],
    );
    const survivingRecord = await records.publicUpsert(
      built.id,
      undefined,
      { title: 'Still valid after deployment' },
      'tasks',
    );
    assert.ok(survivingRecord);
    await assert.rejects(
      records.publicUpsert(built.id, undefined, { done: true }, 'tasks'),
    );
    const revisionTwoPreview =
      '<!doctype html><html><body><main>Tasks v2</main></body></html>';
    await db.insert(generatedAppSourceRevisions).values({
      siteId: built.id,
      revision: 2,
      sourceFiles: source.sourceFiles,
      sourceHash: source.sourceHash,
      buildState: 'passed',
      buildLog: 'typecheck and build passed',
      previewDocument: revisionTwoPreview,
      builtAt: new Date(),
    });
    const deploymentStore = agentStore(db);
    const originalDeployment = (
      await deploymentStore.deployments(owner.id, built.id)
    ).find(({ revision }) => revision === 1);
    assert.ok(originalDeployment);
    assert.equal(
      await deploymentStore.publish(owner.id, built.id, 2, true),
      false,
    );
    await connection`update generated_app_collections
      set fields = ${JSON.stringify([
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'text', required: true, defaultValue: 'open' },
        { name: 'done', type: 'boolean', required: true, defaultValue: false },
      ])}::jsonb
      where site_id = ${built.id} and revision = 2 and name = 'tasks'`;
    assert.equal(
      await deploymentStore.publish(owner.id, built.id, 2, true),
      true,
    );
    assert.equal(
      (await deploymentStore.published(built.id))?.sourceDocument,
      revisionTwoPreview,
    );
    assert.ok(
      (await records.list(owner.id, built.id, 'tasks')).some(
        ({ id, data }) => id === survivingRecord.id && data.done === false,
      ),
    );
    const migrationActivity =
      await connection`select id from generated_app_activity
      where site_id = ${built.id} and environment = 'live' and data_revision = 0
        and action = 'record.schema_migrated' and target_id = ${survivingRecord.id}`;
    assert.equal(migrationActivity.length, 1);
    assert.equal(await records.publicList(built.id, 'hidden'), null);
    const currentDeployment = (
      await deploymentStore.deployments(owner.id, built.id)
    ).find(({ unpublishedAt }) => unpublishedAt === null);
    assert.ok(currentDeployment);
    const rollback = await deploymentStore.rollbackDeployment(
      owner.id,
      built.id,
      originalDeployment.id,
      currentDeployment.id,
    );
    assert.ok(rollback);
    assert.equal((await deploymentStore.published(built.id))?.revision, 1);
    const restoredForProvider = await deploymentStore.liveDeployment(
      owner.id,
      built.id,
      rollback.id,
    );
    assert.equal(restoredForProvider?.runtimeMode, 'app');
    assert.equal(restoredForProvider?.source?.sourceHash, source.sourceHash);
    assert.equal(restoredForProvider?.source?.buildState, 'passed');
    assert.deepEqual(
      restoredForProvider?.source?.sourceFiles,
      source.sourceFiles,
    );
    assert.ok(
      (await records.list(owner.id, built.id, 'tasks')).some(
        ({ id }) => id === survivingRecord.id,
      ),
    );
    assert.ok(
      await records.publicList(built.id, 'hidden', {
        id: randomUUID(),
        email: 'admin@example.test',
        role: 'admin',
      }),
    );
    assert.equal(await records.publicList(built.id, 'hidden'), null);
    assert.equal(appUser?.email, 'user@example.test');
    assert.equal(appUser?.role, 'user');
    assert.ok(appUser);
    const privateCollection = await records.configureCollection(
      owner.id,
      site,
      'private-notes',
      {
        readAccess: 'authenticated',
        writeAccess: 'authenticated',
        ownerScoped: true,
      },
    );
    assert.equal(privateCollection?.ownerScoped, true);
    assert.equal(await records.publicList(site, 'private-notes'), null);
    const firstNote = await records.publicUpsert(
      site,
      undefined,
      { note: 'Private to first user' },
      'private-notes',
      appUser,
    );
    assert.ok(firstNote);
    const secondChallenge = await users.challenge(site, 'second@example.test');
    const secondSession = await users.verify(
      site,
      secondChallenge.id,
      secondChallenge.code,
    );
    assert.ok(secondSession);
    const secondUser = await users.user(site, secondSession);
    assert.ok(secondUser);
    const secondNote = await records.publicUpsert(
      site,
      undefined,
      { note: 'Private to second user' },
      'private-notes',
      secondUser,
    );
    assert.ok(secondNote);
    assert.equal(
      (await records.publicList(site, 'private-notes', appUser))?.length,
      1,
    );
    assert.equal(
      (await records.publicList(site, 'private-notes', secondUser))?.length,
      1,
    );
    const promoted = await users.setRole(owner.id, site, appUser.id, 'admin');
    assert.equal(promoted?.role, 'admin');
    const promotedUser = await users.user(site, session);
    assert.equal(promotedUser?.role, 'admin');
    assert.equal(
      (
        await records.publicList(
          site,
          'private-notes',
          promotedUser ?? undefined,
        )
      )?.length,
      2,
    );
    const collections = await records.collections(owner.id, site);
    assert.ok(collections.some((item) => item.name === 'private-notes'));
    const adminEdit = await records.publicUpsert(
      site,
      secondNote.id,
      { note: 'Updated by admin' },
      'private-notes',
      promotedUser ?? undefined,
    );
    assert.ok(adminEdit);
    const secondUsersNotes = await records.publicList(
      site,
      'private-notes',
      secondUser,
    );
    assert.equal(secondUsersNotes?.[0]?.data.note, 'Updated by admin');
    assert.equal(
      (await users.setRole(owner.id, site, secondUser.id, 'admin'))?.role,
      'admin',
    );
    assert.equal((await users.list(other.id, site)).length, 0);
    assert.equal(await users.remove(owner.id, site, invitedUser.id), true);
    assert.equal(await users.remove(owner.id, site, appUser.id), true);
    assert.equal(await users.user(site, session), null);
    const rejoinedInvite = await users.invite(
      owner.id,
      site,
      appUser.email,
      'user',
      'fixture-owner',
    );
    assert.ok(rejoinedInvite);
    const rejoinedChallenge = await users.challenge(site, appUser.email);
    const rejoinedSession = await users.verify(
      site,
      rejoinedChallenge.id,
      rejoinedChallenge.code,
    );
    assert.ok(rejoinedSession);
    assert.notEqual(rejoinedSession, session);
    assert.equal(await users.user(site, session), null);
    assert.equal(
      (await users.user(site, rejoinedSession))?.email,
      appUser.email,
    );
    assert.equal(await users.remove(owner.id, site, secondUser.id), false);
    assert.equal(
      await users.setRole(owner.id, site, secondUser.id, 'user'),
      null,
    );

    const quotaSite = randomUUID();
    await connection`insert into workspace_artifacts (id, business_id, kind, title, body)
      values (${quotaSite}, ${owner.id}, 'website', 'Quota fixture', '<main></main>')`;
    await connection`insert into generated_app_records
      (site_id, environment, data_revision, id, collection, data)
      select ${quotaSite}, 'live', 0, gen_random_uuid(), 'records', jsonb_build_object('n', n)
      from generate_series(1, 9999) n`;
    const quotaRace = await Promise.allSettled([
      records.upsert(owner.id, quotaSite, undefined, { label: 'one' }),
      records.upsert(owner.id, quotaSite, undefined, { label: 'two' }),
    ]);
    assert.equal(
      quotaRace.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const quotaRejection = quotaRace.find(
      (result) => result.status === 'rejected',
    );
    assert.ok(quotaRejection?.status === 'rejected');
    assert.ok(quotaRejection.reason instanceof GeneratedAppRecordQuotaExceeded);
    const [quotaCount] = await connection`select count(*)::int as count
      from generated_app_records where site_id = ${quotaSite} and environment = 'live' and data_revision = 0`;
    assert.equal(quotaCount?.count, 10_000);
    await db.insert(websiteVersions).values({
      artifactId: quotaSite,
      revision: 1,
      title: 'Quota fixture',
      document: '<!doctype html><html><body></body></html>',
      runtimeMode: 'app',
    });
    await db.insert(publications).values({
      artifactId: quotaSite,
      draftRevision: 1,
      document: '<!doctype html><html><body></body></html>',
      pages: [],
      runtimeMode: 'app',
    });
    await records.configureCollection(owner.id, quotaSite, 'records', {
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
    });
    const quotaResponse = await http.inject({
      method: 'POST',
      url: '/__foundable/records',
      headers: {
        host: `${quotaSite}.apps.test`,
        origin: `http://${quotaSite}.apps.test`,
      },
      payload: { label: 'over quota' },
    });
    assert.equal(quotaResponse.statusCode, 429, quotaResponse.body);
    assert.match(quotaResponse.json().message, /10,000-record limit/u);
    await http.close();
    const [existingQuotaRecord] =
      await connection`select id from generated_app_records
      where site_id = ${quotaSite} and environment = 'live' and data_revision = 0 limit 1`;
    assert.ok(existingQuotaRecord);
    assert.ok(
      await records.upsert(owner.id, quotaSite, existingQuotaRecord.id, {
        label: 'updated',
      }),
    );
    const secondSite = randomUUID();
    await connection`insert into workspace_artifacts (id, business_id, kind, title, body)
      values (${secondSite}, ${owner.id}, 'website', 'Separate quota fixture', '<main></main>')`;
    assert.ok(
      await records.upsert(owner.id, secondSite, undefined, {
        label: 'independent quota',
      }),
    );

    if (redisUrl) {
      const [ownerAccount, adminAccount, viewerAccount] = await db
        .insert(accounts)
        .values([
          { email: 'preview-owner@example.test' },
          { email: 'preview-admin@example.test' },
          { email: 'preview-viewer@example.test' },
        ])
        .returning();
      assert.ok(ownerAccount && adminAccount && viewerAccount);
      await db.insert(members).values([
        { businessId: owner.id, accountId: ownerAccount.id, role: 'owner' },
        { businessId: owner.id, accountId: adminAccount.id, role: 'admin' },
        { businessId: owner.id, accountId: viewerAccount.id, role: 'viewer' },
      ]);
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
      const rateLimits: [string, string, number, number][] = [];
      const deliveredInvitations: {
        email: string;
        code: string;
        application: string;
        signInUrl?: string;
      }[] = [];
      const refundCalls: [string, string, string, number, string][] = [];
      const app = Fastify();
      t.after(async () => {
        await app.close().catch(() => {});
        await redis.quit().catch(() => {});
      });
      const store = agentStore(db);
      const previewWriteScopes: {
        siteId: string;
        businessId: string;
        revision: number;
        environment?: 'live' | 'preview';
      }[] = [];
      const publicUpsert = records.publicUpsert;
      records.publicUpsert = async (...args) => {
        const preview = args[5];
        if (preview) previewWriteScopes.push({ siteId: args[0], ...preview });
        return publicUpsert(...args);
      };
      const context = {
        store,
        appRecords: records,
        appUsers: users,
        appStorage: storage,
        appJobs,
        sendAppUserCode: async (email, code, application, signInUrl) => {
          deliveredInvitations.push({ email, code, application, signInUrl });
        },
        team: {},
        commerce: undefined,
        sellerPayments: {
          refundStoreOrder: async (
            businessId: string,
            siteId: string,
            orderId: string,
            amount: number,
            requestId: string,
          ) => {
            refundCalls.push([businessId, siteId, orderId, amount, requestId]);
            return true;
          },
        },
        media: {},
        mediaRates: {},
        salesInsights: async () => ({}),
        domains: {},
        vault: undefined,
        runs: {},
        mail: {},
        inbound: {},
        sms: undefined,
        outreachSender: undefined,
        redis,
        agentEnabled: false,
        hosting: { url: () => 'https://generated-app.example.test' },
        siteSync: undefined,
        readPage: async () => null,
        limit: async (
          type: string,
          key: string,
          attempts: number,
          seconds: number,
        ) => {
          rateLimits.push([type, key, attempts, seconds]);
        },
        identify: async (request: { headers: Record<string, string> }) =>
          request.headers['x-fixture-account'] ?? '',
        requireOrigin: () => undefined,
        reportError: (
          error: unknown,
          reply: {
            code: (status: number) => { send: (body: object) => unknown };
          },
        ) => reply.code(500).send({ message: String(error) }),
      } as unknown as Parameters<typeof registerWorkspace>[1];
      registerWorkspace(app, context);
      await app.ready();
      const ownerHeaders = { 'x-fixture-account': ownerAccount.id };
      const hiddenCollectionSchema = await app.inject({
        method: 'PUT',
        url: `/api/companies/${owner.id}/work/apps/${built.id}/collections/hidden`,
        headers: ownerHeaders,
        payload: {
          readAccess: 'admin',
          writeAccess: 'admin',
          ownerScoped: false,
          fields: [
            { name: 'secret', type: 'text', required: true },
            {
              name: 'label',
              type: 'text',
              required: true,
              defaultValue: 'legacy',
            },
            { name: 'reviewed', type: 'boolean', required: true },
          ],
        },
      });
      assert.equal(hiddenCollectionSchema.statusCode, 409);
      assert.match(
        hiddenCollectionSchema.json<{ message: string }>().message,
        /existing app data/u,
      );
      assert.deepEqual(
        (await records.collections(owner.id, built.id)).find(
          ({ name }) => name === 'hidden',
        )?.fields,
        [
          { name: 'secret', type: 'text', required: true },
          {
            name: 'label',
            type: 'text',
            required: true,
            defaultValue: 'legacy',
          },
        ],
      );
      const dashboardFile = await storage.put(
        built.id,
        {
          id: randomUUID(),
          email: 'dashboard-user@example.test',
          role: 'user',
        },
        {
          name: 'dashboard.txt',
          mime: 'text/plain',
          data: Buffer.from('dashboard file').toString('base64'),
        },
      );
      assert.ok(dashboardFile);
      const dashboardFilesPath = `/api/companies/${owner.id}/work/apps/${built.id}/files`;
      const viewerRefund = await app.inject({
        method: 'POST',
        url: `/api/companies/${owner.id}/work/${built.id}/store`,
        headers: { 'x-fixture-account': viewerAccount.id },
        payload: { action: 'refund', id: randomUUID() },
      });
      assert.equal(viewerRefund.statusCode, 403, viewerRefund.body);
      assert.deepEqual(viewerRefund.json(), {
        message: 'This workspace is view only.',
      });
      const orderId = randomUUID();
      const refundRequestId = randomUUID();
      const generatedStoreService = store.generatedStore as unknown as {
        scopedStore: (businessId: string, siteId: string) => Promise<unknown>;
      };
      const originalScopedStore = generatedStoreService.scopedStore;
      generatedStoreService.scopedStore = async () => ({ paymentMode: 'test' });
      const ownerRefund = await app.inject({
        method: 'POST',
        url: `/api/companies/${owner.id}/work/${built.id}/store`,
        headers: ownerHeaders,
        payload: {
          action: 'refund',
          id: orderId,
          amount: 500,
          requestId: refundRequestId,
        },
      });
      generatedStoreService.scopedStore = originalScopedStore;
      assert.equal(ownerRefund.statusCode, 200, ownerRefund.body);
      assert.deepEqual(ownerRefund.json(), { saved: true });
      assert.deepEqual(refundCalls, [
        [owner.id, built.id, orderId, 500, refundRequestId],
      ]);
      const dashboardFiles = await app.inject({
        method: 'GET',
        url: dashboardFilesPath,
        headers: ownerHeaders,
      });
      assert.equal(dashboardFiles.statusCode, 200, dashboardFiles.body);
      assert.ok(
        dashboardFiles
          .json<{ files: { id: string; ownerEmail: string }[] }>()
          .files.some(
            (file) =>
              file.id === dashboardFile.id &&
              file.ownerEmail === 'dashboard-user@example.test',
          ),
      );
      const dashboardFileRead = await app.inject({
        method: 'GET',
        url: dashboardFilesPath + '/' + dashboardFile.id,
        headers: ownerHeaders,
      });
      assert.equal(dashboardFileRead.statusCode, 200, dashboardFileRead.body);
      assert.equal(
        Buffer.from(
          dashboardFileRead.json<{ file: { data: string } }>().file.data,
          'base64',
        ).toString(),
        'dashboard file',
      );
      const viewerDeleteFile = await app.inject({
        method: 'DELETE',
        url: dashboardFilesPath + '/' + dashboardFile.id,
        headers: { 'x-fixture-account': viewerAccount.id },
      });
      assert.equal(viewerDeleteFile.statusCode, 403);
      const ownerDeleteFile = await app.inject({
        method: 'DELETE',
        url: dashboardFilesPath + '/' + dashboardFile.id,
        headers: ownerHeaders,
      });
      assert.equal(ownerDeleteFile.statusCode, 200, ownerDeleteFile.body);
      const appUsersPath = `/api/companies/${owner.id}/work/apps/${built.id}/users`;
      const queuedDashboardJob = await appJobs.enqueue(
        owner.id,
        built.id,
        {
          id: ownerAccount.id,
          email: 'workspace-job@example.test',
          role: 'user',
        },
        {
          id: randomUUID(),
          collection: 'tasks',
          recordId: randomUUID(),
          action: 'complete',
          runAt: new Date(Date.now() + 60_000).toISOString(),
        },
      );
      assert.ok(queuedDashboardJob);
      const dashboardJobsPath = `/api/companies/${owner.id}/work/apps/${built.id}/jobs`;
      const dashboardJobs = await app.inject({
        method: 'GET',
        url: dashboardJobsPath,
        headers: ownerHeaders,
      });
      assert.equal(dashboardJobs.statusCode, 200, dashboardJobs.body);
      assert.ok(
        dashboardJobs
          .json<{ jobs: { id: string }[] }>()
          .jobs.some((job) => job.id === queuedDashboardJob.id),
      );
      const deniedJobCancel = await app.inject({
        method: 'DELETE',
        url: `${dashboardJobsPath}/${queuedDashboardJob.id}`,
        headers: { 'x-fixture-account': viewerAccount.id },
      });
      assert.equal(deniedJobCancel.statusCode, 403);
      const cancelledJob = await app.inject({
        method: 'DELETE',
        url: `${dashboardJobsPath}/${queuedDashboardJob.id}`,
        headers: ownerHeaders,
      });
      assert.equal(cancelledJob.statusCode, 200, cancelledJob.body);
      const deniedInvite = await app.inject({
        method: 'POST',
        url: appUsersPath + '/invitations',
        headers: { 'x-fixture-account': viewerAccount.id },
        payload: { email: 'new-user@example.test', role: 'user' },
      });
      assert.equal(deniedInvite.statusCode, 403);
      const acceptedInvite = await app.inject({
        method: 'POST',
        url: appUsersPath + '/invitations',
        headers: ownerHeaders,
        payload: { email: 'new-user@example.test', role: 'user' },
      });
      assert.equal(acceptedInvite.statusCode, 201, acceptedInvite.body);
      assert.equal(deliveredInvitations.length, 1);
      assert.equal(deliveredInvitations[0]?.email, 'new-user@example.test');
      assert.equal(deliveredInvitations[0]?.application, 'Built tasks');
      assert.equal(deliveredInvitations[0]?.code.length, 6);
      assert.match(
        deliveredInvitations[0]?.signInUrl ?? '',
        /^https:\/\/generated-app\.example\.test\/?\?challenge=/u,
      );
      const previewBase = `/api/companies/${owner.id}/work/apps/${site}/preview/records`;
      const previewPath = previewBase + '?revision=1&collection=typed_tasks';
      const builtWorkItem = await agentStore(db).workItem(owner.id, built.id);
      assert.equal(builtWorkItem?.revision, 2);
      const codePath = `/api/companies/${owner.id}/work/apps/${built.id}/code`;
      const codeRead = await app.inject({
        method: 'GET',
        url: codePath,
        headers: ownerHeaders,
      });
      assert.equal(codeRead.statusCode, 200, codeRead.body);
      const codeSource = codeRead.json<{
        source: { revision: number; sourceHash: string } | null;
      }>().source;
      assert.equal(codeSource?.revision, 2);
      assert.equal(codeSource?.sourceHash, source.sourceHash);
      const viewerCodeRead = await app.inject({
        method: 'GET',
        url: codePath,
        headers: { 'x-fixture-account': viewerAccount.id },
      });
      assert.equal(viewerCodeRead.statusCode, 403);
      const sourcePreviewRead = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${built.id}/preview/source?revision=2`,
        headers: ownerHeaders,
      });
      assert.deepEqual(sourcePreviewRead.json(), {
        buildState: 'passed',
        document: revisionTwoPreview,
      });
      const staleSourcePreview = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${built.id}/preview/source?revision=1`,
        headers: ownerHeaders,
      });
      assert.equal(staleSourcePreview.statusCode, 404);
      const viewerSourcePreview = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${built.id}/preview/source?revision=2`,
        headers: { 'x-fixture-account': viewerAccount.id },
      });
      assert.equal(viewerSourcePreview.statusCode, 403);
      const previewList = await app.inject({
        method: 'GET',
        url: previewPath,
        headers: ownerHeaders,
      });
      assert.equal(previewList.statusCode, 200, previewList.body);
      const previewCreate = await app.inject({
        method: 'POST',
        url: previewPath,
        headers: ownerHeaders,
        payload: { title: 'HTTP preview record' },
      });
      assert.equal(previewCreate.statusCode, 201);
      const routeWriteScope = previewWriteScopes.at(-1);
      assert.deepEqual(routeWriteScope, {
        siteId: site,
        businessId: owner.id,
        revision: 1,
      });
      assert.ok(routeWriteScope);
      const routePreviewId = previewCreate.json<{ record: { id: string } }>()
        .record.id;
      assert.ok(
        (
          await records.publicList(site, 'typed_tasks', undefined, {
            businessId: routeWriteScope.businessId,
            revision: routeWriteScope.revision,
          })
        )?.some(({ id }) => id === routePreviewId),
      );
      const [routePreviewRow] = await connection`
        select environment, data_revision, collection, data->>'title' as title
        from generated_app_records where site_id = ${site} and id = ${routePreviewId}`;
      const [routeSchema] = await connection`
        select fields from generated_app_collections
        where site_id = ${site} and revision = ${routeWriteScope.revision}
          and name = 'typed_tasks'`;
      assert.deepEqual(routePreviewRow, {
        environment: 'preview',
        data_revision: 1,
        collection: 'typed_tasks',
        title: 'HTTP preview record',
      });
      assert.equal(
        (routeSchema?.fields as { name: string; unique?: boolean }[])[0]
          ?.unique,
        true,
      );
      await assert.rejects(
        publicUpsert(
          routeWriteScope.siteId,
          undefined,
          { title: 'HTTP preview record' },
          'typed_tasks',
          undefined,
          routeWriteScope,
        ),
        /value for title is already in use/u,
      );
      const duplicatePreviewCreate = await app.inject({
        method: 'POST',
        url: previewPath,
        headers: ownerHeaders,
        payload: { title: 'HTTP preview record' },
      });
      assert.equal(duplicatePreviewCreate.statusCode, 409);
      const previewId = previewCreate.json<{ record: { id: string } }>().record
        .id;
      const previewAction = await app.inject({
        method: 'POST',
        url: `${previewBase}/${previewId}/actions?revision=1&collection=typed_tasks`,
        headers: ownerHeaders,
        payload: { action: 'mark_shipped' },
      });
      assert.equal(previewAction.statusCode, 200, previewAction.body);
      assert.equal(
        previewAction.json<{ record: { data: { status: string } } }>().record
          .data.status,
        'shipped',
      );
      const previewUpdate = await app.inject({
        method: 'PUT',
        url: `${previewBase}/${previewId}?revision=1&collection=typed_tasks`,
        headers: ownerHeaders,
        payload: { title: 'HTTP preview updated', status: 'open' },
      });
      assert.equal(previewUpdate.statusCode, 200, previewUpdate.body);
      assert.equal(
        (await records.publicList(site, 'typed_tasks'))?.some(
          ({ id }) => id === previewId,
        ),
        false,
      );
      assert.equal(
        (await records.list(owner.id, site, 'typed_tasks')).some(
          ({ id }) => id === previewId,
        ),
        false,
      );
      const stalePreview = await app.inject({
        method: 'GET',
        url: previewPath.replace('revision=1', 'revision=2'),
        headers: ownerHeaders,
      });
      assert.equal(stalePreview.statusCode, 409);
      const viewerPreview = await app.inject({
        method: 'GET',
        url: previewPath,
        headers: { 'x-fixture-account': viewerAccount.id },
      });
      assert.equal(viewerPreview.statusCode, 403);
      const adminPreview = await app.inject({
        method: 'GET',
        url: previewPath,
        headers: { 'x-fixture-account': adminAccount.id },
      });
      assert.equal(adminPreview.statusCode, 200);
      const authenticatedPreviewPath =
        previewBase + '?revision=1&collection=private-notes';
      const privatePreviewCreate = await app.inject({
        method: 'POST',
        url: authenticatedPreviewPath,
        headers: ownerHeaders,
        payload: { note: 'Synthetic preview admin record' },
      });
      assert.equal(
        privatePreviewCreate.statusCode,
        201,
        privatePreviewCreate.body,
      );
      const privatePreviewList = await app.inject({
        method: 'GET',
        url: authenticatedPreviewPath,
        headers: ownerHeaders,
      });
      assert.equal(privatePreviewList.statusCode, 200);
      assert.ok(
        privatePreviewList
          .json<{ records: { data: { note: string } }[] }>()
          .records.some(
            ({ data }) => data.note === 'Synthetic preview admin record',
          ),
      );
      const previewFile = await app.inject({
        method: 'POST',
        url: `/api/companies/${owner.id}/work/apps/${site}/preview/storage?revision=1`,
        headers: ownerHeaders,
        payload: {
          name: 'preview.txt',
          mime: 'text/plain',
          data: Buffer.from('preview-only').toString('base64'),
        },
      });
      assert.equal(previewFile.statusCode, 201, previewFile.body);
      const previewFileId = previewFile.json<{ file: { id: string } }>().file
        .id;
      assert.equal(
        (
          await storage.list(
            site,
            {
              id: ownerAccount.id,
              email: `preview-${ownerAccount.id}@preview.invalid`,
              role: 'admin',
            },
            'live',
            0,
          )
        ).length,
        0,
      );
      const previewFileRead = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${site}/preview/storage/${previewFileId}?revision=1`,
        headers: ownerHeaders,
      });
      assert.equal(previewFileRead.statusCode, 200, previewFileRead.body);
      assert.equal(
        Buffer.from(
          previewFileRead.json<{ file: { data: string } }>().file.data,
          'base64',
        ).toString(),
        'preview-only',
      );
      const previewJob = await app.inject({
        method: 'POST',
        url: `/api/companies/${owner.id}/work/apps/${site}/preview/jobs?revision=1`,
        headers: ownerHeaders,
        payload: {
          id: randomUUID(),
          collection: 'typed_tasks',
          recordId: previewId,
          action: 'mark_shipped',
          runAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      assert.equal(previewJob.statusCode, 202, previewJob.body);
      const previewJobId = previewJob.json<{ job: { id: string } }>().job.id;
      const previewJobList = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${site}/preview/jobs?revision=1`,
        headers: ownerHeaders,
      });
      assert.ok(
        previewJobList
          .json<{ jobs: { id: string }[] }>()
          .jobs.some((job) => job.id === previewJobId),
      );
      const previewJobCancel = await app.inject({
        method: 'DELETE',
        url: `/api/companies/${owner.id}/work/apps/${site}/preview/jobs/${previewJobId}?revision=1`,
        headers: ownerHeaders,
      });
      assert.equal(previewJobCancel.statusCode, 204);
      assert.ok(
        rateLimits.some(
          ([type, , attempts, seconds]) =>
            type === 'app-preview' && attempts === 120 && seconds === 60,
        ),
      );
      assert.ok(
        rateLimits.some(
          ([type, , attempts, seconds]) =>
            type === 'app-preview' && attempts === 60 && seconds === 60,
        ),
      );
      const previewDelete = await app.inject({
        method: 'DELETE',
        url: `${previewBase}/${previewId}?revision=1&collection=typed_tasks`,
        headers: ownerHeaders,
      });
      assert.equal(previewDelete.statusCode, 204);
      assert.equal(
        (
          await records.publicList(site, 'typed_tasks', undefined, {
            businessId: owner.id,
            revision: 1,
          })
        )?.some(({ id }) => id === previewId),
        false,
      );
      const appBeforeStoreDraft = await store.workItem(owner.id, built.id);
      assert.equal(appBeforeStoreDraft?.runtimeMode, 'app');
      assert.ok(appBeforeStoreDraft);
      const storeDraftToolCallId = randomUUID();
      const [storeDraftTurn] = await db
        .insert(agentTurns)
        .values({
          businessId: owner.id,
          prompt: 'Convert the draft to a store.',
          state: 'running',
          parts: [
            {
              type: 'tool',
              name: 'build',
              toolCallId: storeDraftToolCallId,
              status: 'running',
            },
          ],
        })
        .returning();
      assert.ok(storeDraftTurn);
      const pendingStoreDraft = await store.saveGeneratedWebsite({
        businessId: owner.id,
        turnId: storeDraftTurn.id,
        toolCallId: storeDraftToolCallId,
        title: appBeforeStoreDraft.title,
        body: appBeforeStoreDraft.body,
        pages: appBeforeStoreDraft.pages,
        runtimeMode: 'store',
        storeCurrency: 'AUD',
        base: {
          id: appBeforeStoreDraft.id,
          revision: appBeforeStoreDraft.revision,
          state: appBeforeStoreDraft.state,
        },
      });
      assert.ok(pendingStoreDraft);
      const dualModeDraft = await store.workItem(owner.id, built.id);
      assert.equal(dualModeDraft?.runtimeMode, 'store');
      assert.equal(dualModeDraft?.isApp, true);
      assert.equal(
        dualModeDraft?.appRevision,
        (await store.published(built.id))?.revision,
      );
      const dashboardCodeDuringStoreDraft = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${built.id}/code`,
        headers: ownerHeaders,
      });
      assert.equal(
        dashboardCodeDuringStoreDraft.statusCode,
        200,
        dashboardCodeDuringStoreDraft.body,
      );
      assert.equal(
        dashboardCodeDuringStoreDraft.json<{ source: { revision: number } }>()
          .source.revision,
        (await store.published(built.id))?.revision,
      );
      const filesDuringStoreDraft = await app.inject({
        method: 'GET',
        url: `/api/companies/${owner.id}/work/apps/${built.id}/files`,
        headers: ownerHeaders,
      });
      assert.equal(filesDuringStoreDraft.statusCode, 200);
      const inviteDuringStoreDraft = await app.inject({
        method: 'POST',
        url: appUsersPath + '/invitations',
        headers: ownerHeaders,
        payload: { email: 'still-live@example.test', role: 'user' },
      });
      assert.equal(
        inviteDuringStoreDraft.statusCode,
        201,
        inviteDuringStoreDraft.body,
      );
      assert.ok(
        await store.decide(
          owner.id,
          built.id,
          pendingStoreDraft.revision,
          true,
          ownerAccount.id,
        ),
      );
      assert.ok(
        await store.publish(
          owner.id,
          built.id,
          pendingStoreDraft.revision,
          true,
        ),
      );
      assert.equal((await store.workItem(owner.id, built.id))?.isApp, false);
      const inactiveAppUsers = await app.inject({
        method: 'GET',
        url: appUsersPath,
        headers: ownerHeaders,
      });
      assert.equal(inactiveAppUsers.statusCode, 404);
      const inactiveAppInvite = await app.inject({
        method: 'POST',
        url: appUsersPath + '/invitations',
        headers: ownerHeaders,
        payload: { email: 'inactive-app@example.test', role: 'user' },
      });
      assert.equal(inactiveAppInvite.statusCode, 404);
      await app.close();
      await redis.quit();
    }
  },
);
