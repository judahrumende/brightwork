import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppJobClaim } from '@brightwork/api/generated-app-jobs';
import { processGeneratedAppJob } from './app-jobs';

const claim: AppJobClaim = {
  businessId: '10000000-0000-4000-8000-000000000001',
  siteId: '20000000-0000-4000-8000-000000000002',
  environment: 'live',
  dataRevision: 0,
  schemaRevision: 1,
  id: '30000000-0000-4000-8000-000000000003',
  actorId: '40000000-0000-4000-8000-000000000004',
  actorEmail: 'user@example.test',
  collection: 'tasks',
  recordId: '50000000-0000-4000-8000-000000000005',
  action: 'complete',
  attempts: 1,
  lease: '60000000-0000-4000-8000-000000000006',
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const calls: [string, ...unknown[]][] = [];
  return {
    calls,
    jobs: {
      current: async () => true,
      finish: async (...args: unknown[]) => calls.push(['finish', ...args]),
      retry: async (...args: unknown[]) => calls.push(['retry', ...args]),
      ...((overrides.jobs as object | undefined) ?? {}),
    },
    records: {
      publicAction: async (...args: unknown[]) => {
        calls.push(['action', ...args]);
        return { id: claim.recordId };
      },
      ...((overrides.records as object | undefined) ?? {}),
    },
    users: {
      byEmail: async () => ({
        id: claim.actorId,
        email: claim.actorEmail,
        role: 'user' as const,
      }),
      ...((overrides.users as object | undefined) ?? {}),
    },
  };
}

test('app job revalidates the user and executes the current configured action', async () => {
  const deps = dependencies();
  assert.equal(await processGeneratedAppJob(claim, deps as never), 'succeeded');
  assert.deepEqual(deps.calls[0], [
    'action',
    claim.siteId,
    claim.recordId,
    claim.action,
    claim.collection,
    { id: claim.actorId, email: claim.actorEmail, role: 'user' },
    undefined,
  ]);
  assert.equal(deps.calls.at(-1)?.[0], 'finish');
});

test('preview app job uses only its synthetic revision-scoped identity', async () => {
  const deps = dependencies();
  const previewClaim = {
    ...claim,
    environment: 'preview' as const,
    dataRevision: 2,
    schemaRevision: 2,
  };
  assert.equal(
    await processGeneratedAppJob(previewClaim, deps as never),
    'succeeded',
  );
  assert.equal(deps.calls[0]?.[0], 'action');
  assert.deepEqual(deps.calls[0]?.at(-1), {
    businessId: claim.businessId,
    revision: 2,
  });
});

test('stale app revisions and removed users fail without running the action', async () => {
  const stale = dependencies({ jobs: { current: async () => false } });
  assert.equal(await processGeneratedAppJob(claim, stale as never), 'failed');
  assert.deepEqual(
    stale.calls.map(([name]) => name),
    ['finish'],
  );
  const removed = dependencies({ users: { byEmail: async () => null } });
  assert.equal(await processGeneratedAppJob(claim, removed as never), 'failed');
  assert.deepEqual(
    removed.calls.map(([name]) => name),
    ['finish'],
  );
});

test('transient worker errors release the lease through bounded retry', async () => {
  const deps = dependencies({
    records: {
      publicAction: async () => {
        throw new Error('temporary database error');
      },
    },
  });
  assert.equal(await processGeneratedAppJob(claim, deps as never), 'retry');
  assert.equal(deps.calls.at(-1)?.[0], 'retry');
});
