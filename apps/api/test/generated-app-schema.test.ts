import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appCollectionDefinitions } from '../src/workspace/generated-app-records';

test('app collections default to authenticated owner-scoped access', () => {
  assert.deepEqual(
    appCollectionDefinitions.parse([
      {
        name: 'tasks',
        fields: [{ name: 'title', type: 'text', required: true }],
      },
    ]),
    [
      {
        name: 'tasks',
        readAccess: 'authenticated',
        writeAccess: 'authenticated',
        ownerScoped: true,
        fields: [{ name: 'title', type: 'text', required: true }],
        actions: [],
      },
    ],
  );
});

test('public app collections must explicitly disable owner scoping', () => {
  assert.throws(() =>
    appCollectionDefinitions.parse([
      {
        name: 'catalog',
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: true,
        fields: [],
      },
    ]),
  );
  assert.deepEqual(
    appCollectionDefinitions.parse([
      {
        name: 'catalog',
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [],
      },
    ])[0],
    {
      name: 'catalog',
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [],
      actions: [],
    },
  );
});
