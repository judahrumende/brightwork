import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInSkillInstructions } from '../../apps/worker/src/built-in-skills.ts';
import { requestsStore } from '../../apps/worker/src/store-intent.ts';

test('every website build automatically gets design system guidance', () => {
  for (const stage of ['plan', 'render'] as const)
    assert.ok(builtInSkillInstructions(stage, { store: false }).length > 0);
});

test('store builds automatically add storefront guidance at both stages', () => {
  for (const stage of ['plan', 'render'] as const) {
    const generic = builtInSkillInstructions(stage, { store: false }).join(
      '\n',
    );
    const store = builtInSkillInstructions(stage, { store: true }).join('\n');
    assert.ok(store.length > generic.length);
    assert.match(store, /catalog/u);
  }
});

test('store intent detects ordinary shopping requests without treating data storage as a store', () => {
  assert.equal(
    requestsStore('Make an online shop for handmade candles.'),
    true,
  );
  assert.equal(
    requestsStore('Build an ecommerce site to sell products online.'),
    true,
  );
  assert.equal(
    requestsStore('Create a dashboard that stores customer records.'),
    false,
  );
});
