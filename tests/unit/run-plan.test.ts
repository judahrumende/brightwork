import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRunPlan } from '../../apps/api/src/workspace/run-plan.ts';

test('accepts ordered steps and normalizes model JSON and duplicate tasks', () => {
  assert.deepEqual(
    readRunPlan(
      '```json\n{"steps":[" Draft a page ","Research", "Research"]}\n```',
    ),
    ['Draft a page', 'Research'],
  );
});

test('rejects malformed, oversized, or empty Run plans', () => {
  for (const input of [
    'I will do it',
    '{"steps":[]}',
    '{"steps":[" "]}',
    '{"steps":[{"send":"email"}]}',
    JSON.stringify({
      steps: Array.from({ length: 12 }, (_, i) => 'Step ' + i),
    }),
  ])
    assert.equal(readRunPlan(input), null);
});
