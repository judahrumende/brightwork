import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatedAppFunctionOperation,
  signGeneratedAppFunctionCapability,
  verifyGeneratedAppFunctionCapability,
} from '../src/workspace/generated-app-function-capabilities';

test('function capability tokens bind revision, environment, and app user', async () => {
  const secret = 'fixture-only-function-capability-secret';
  const claims = {
    businessId: '00000000-0000-4000-8000-000000000001',
    siteId: '00000000-0000-4000-8000-000000000002',
    revision: 4,
    environment: 'preview' as const,
    user: {
      id: 'workspace-user-1',
      email: 'preview@example.test',
      role: 'admin' as const,
    },
  };
  const token = await signGeneratedAppFunctionCapability(secret, claims);
  const verified = await verifyGeneratedAppFunctionCapability(secret, token);
  assert.deepEqual(
    {
      businessId: verified?.businessId,
      siteId: verified?.siteId,
      revision: verified?.revision,
      environment: verified?.environment,
      user: verified?.user,
    },
    claims,
  );
  assert.match(verified?.jti ?? '', /^[0-9a-f-]{36}$/u);
  assert.equal(
    await verifyGeneratedAppFunctionCapability('other-secret', token),
    null,
  );
});

test('function record capability requests validate collection operations and limits', () => {
  assert.deepEqual(
    generatedAppFunctionOperation.parse({
      operation: 'list',
      collection: 'orders',
    }),
    { operation: 'list', collection: 'orders', limit: 20 },
  );
  assert.deepEqual(
    generatedAppFunctionOperation.parse({
      operation: 'page',
      collection: 'orders',
    }),
    { operation: 'page', collection: 'orders', limit: 20 },
  );
  assert.throws(() =>
    generatedAppFunctionOperation.parse({
      operation: 'page',
      collection: 'orders',
      cursor: { before: 'not-a-timestamp', id: 'invalid' },
    }),
  );
  assert.throws(() =>
    generatedAppFunctionOperation.parse({
      operation: 'delete',
      collection: '../other-site',
      recordId: '00000000-0000-4000-8000-000000000001',
    }),
  );
  assert.throws(() =>
    generatedAppFunctionOperation.parse({
      operation: 'list',
      collection: 'orders',
      limit: 500,
    }),
  );
});
