import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCreditConfig } from '../src/workspace/credits';

test('production requires an explicit generated-app storage credit rate', () => {
  assert.throws(
    () => parseCreditConfig({ NODE_ENV: 'production' }),
    /APP_STORAGE_CREDITS_PER_MIB must be explicitly set/u,
  );
  assert.equal(
    parseCreditConfig({
      NODE_ENV: 'production',
      APP_STORAGE_CREDITS_PER_MIB: '0',
    }).APP_STORAGE_CREDITS_PER_MIB,
    '0',
  );
});

test('local environments keep the zero-charge storage default', () => {
  assert.equal(
    parseCreditConfig({ NODE_ENV: 'test' }).APP_STORAGE_CREDITS_PER_MIB,
    '0.0000000000',
  );
});
