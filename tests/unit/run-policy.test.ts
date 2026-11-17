import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextRunStep } from '../../apps/api/src/workspace/run-policy.ts';

const now = new Date('2026-11-16T15:00:00Z');
const completed = {
  state: 'completed',
  answer: 'Done',
  updatedAt: now,
} as const;
const draft = { kind: 'website', state: 'pending', answered: false };
const question = { kind: 'question', state: 'draft', answered: false };

test('only dispatches an existing queued turn and detects an abandoned running turn', () => {
  assert.deepEqual(nextRunStep(null, [], now), { action: 'start' });
  assert.deepEqual(nextRunStep({ ...completed, state: 'queued' }, [], now), {
    action: 'dispatch',
  });
  assert.deepEqual(nextRunStep({ ...completed, state: 'running' }, [], now), {
    action: 'wait',
  });
  const previous = new Date(now.getTime() - 5 * 60_000 - 1);
  assert.deepEqual(
    nextRunStep(
      { ...completed, state: 'running', updatedAt: previous },
      [],
      now,
    ),
    {
      action: 'fail',
      reason: 'The worker stopped during this step.',
    },
  );
});

test('waits for answers and approvals before continuing the same step', () => {
  assert.deepEqual(nextRunStep(completed, [question, draft], now), {
    action: 'wait',
    for: 'answer',
  });
  const answered = { ...question, answered: true };
  assert.deepEqual(nextRunStep(completed, [answered, draft], now), {
    action: 'wait',
    for: 'approval',
  });
  assert.deepEqual(
    nextRunStep(completed, [answered, { ...draft, state: 'approved' }], now),
    { action: 'continue' },
  );
});

test('moves on after a decision and preserves a failed turn reason', () => {
  assert.deepEqual(
    nextRunStep(completed, [{ ...draft, state: 'rejected' }], now),
    { action: 'finish' },
  );
  assert.deepEqual(
    nextRunStep(
      { ...completed, state: 'failed', answer: 'Budget exhausted' },
      [],
      now,
    ),
    { action: 'fail', reason: 'Budget exhausted' },
  );
});
