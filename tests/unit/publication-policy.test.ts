import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicationAction } from '../../apps/api/src/workspace/publication-policy.ts';

test('a revised draft needs its own approval before replacing a live revision', () => {
  assert.equal(publicationAction(true, 'pending', 2, 1), 'reject');
  assert.equal(publicationAction(true, 'rejected', 2, 1), 'reject');
  assert.equal(publicationAction(true, 'approved', 2, 1), 'publish');
  assert.equal(publicationAction(true, 'approved', 2, 2), 'unchanged');
});

test('owners can take the live snapshot down while another revision is in review', () => {
  assert.equal(publicationAction(false, 'pending', 2, 1), 'unpublish');
  assert.equal(publicationAction(false, 'pending', 2, undefined), 'unchanged');
});
