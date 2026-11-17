import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyTurnChanges,
  readTurnSnapshot,
} from '../../apps/web/src/workbench/turn-events.ts';
import type { Turn } from '../../apps/web/src/workbench/turn-events.ts';

const previous: Turn = {
  id: 'turn-1',
  prompt: 'Write an outline',
  text: '',
  parts: [],
  status: 'running',
  revision: 3,
};

test('accepts a new revision and preserves token usage', () => {
  const next = applyTurnChanges(previous, {
    id: previous.id,
    from: 3,
    changes: [
      { op: 'set', path: ['text'], value: 'The outline is ready.' },
      {
        op: 'set',
        path: ['parts'],
        value: [{ type: 'text', text: 'The outline is ready.' }],
      },
      { op: 'set', path: ['status'], value: 'completed' },
      { op: 'set', path: ['revision'], value: 6 },
      {
        op: 'set',
        path: ['usage'],
        value: { inputTokens: 20, outputTokens: 5 },
      },
    ],
  });
  assert.equal(next?.revision, 6);
  assert.equal(next?.status, 'completed');
  assert.deepEqual(next?.usage, { inputTokens: 20, outputTokens: 5 });
  assert.equal(previous.text, '');
});

test('rejects stale, malformed and misplaced stream events', () => {
  assert.equal(
    readTurnSnapshot({ ...previous, status: 'future' }, previous.id),
    null,
  );
  assert.equal(readTurnSnapshot(previous, 'turn-2'), null);
  const changes = [
    { op: 'set', path: ['revision'], value: 6 },
    { op: 'set', path: ['parts'], value: [null] },
  ];
  assert.equal(
    applyTurnChanges(previous, { id: previous.id, from: 3, changes }),
    null,
  );
  assert.equal(
    applyTurnChanges(previous, {
      id: previous.id,
      from: 4,
      changes: [changes[0]],
    }),
    null,
  );
  assert.equal(
    applyTurnChanges(previous, {
      id: previous.id,
      from: 3,
      changes: [{ op: 'set', path: ['revision'], value: 2 }],
    }),
    null,
  );
});
