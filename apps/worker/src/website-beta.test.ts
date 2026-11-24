import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { agentStore } from '@brightwork/api/agent';
import { connectDatabase } from '@brightwork/api/database';
import { agentRunner } from './agent';

const url = process.env.WEBSITE_WORKER_TEST_DATABASE_URL;

test('Pip persists an ordered plan and a pending two-page website draft', async () => {
  assert.ok(
    url,
    'Set WEBSITE_WORKER_TEST_DATABASE_URL to a disposable database',
  );
  const endpoint = new URL(url);
  assert.equal(endpoint.hostname, '127.0.0.1');
  assert.equal(endpoint.pathname, '/website_worker');
  const database = connectDatabase(url);
  const sql = database.db.$client;
  const store = agentStore(database.db);
  const businessId = randomUUID();
  const accountId = randomUUID();
  const planId = randomUUID();
  const draftId = randomUUID();
  const steps = ['Draft home and about pages', 'Ask the owner to review'];
  const homepage = '<main><h1>Studio</h1><a href="/about">About</a></main>';
  const pages = [
    { slug: 'about', title: 'About', html: '<main><h1>About</h1></main>' },
  ];

  try {
    await sql`insert into accounts (id, email) values (${accountId}, ${accountId + '@example.test'})`;
    await sql`insert into businesses (id, name) values (${businessId}, 'Studio')`;
    await sql`insert into agent_turns (id, business_id, creator_id, purpose, prompt) values
      (${planId}, ${businessId}, ${accountId}, 'plan', 'Plan a two-page studio site'),
      (${draftId}, ${businessId}, ${accountId}, 'work', 'Draft the home and about pages')`;
    const credits = { debit: async () => true };
    const runPlan = agentRunner(store, credits, async () => ({
      text: JSON.stringify({ steps }),
      calls: [],
      usage: undefined,
    }));
    await runPlan(planId);
    assert.deepEqual((await store.readTurn(businessId, planId))?.plan, steps);

    let calls = 0;
    const runDraft = agentRunner(store, credits, async (messages, tools) => {
      calls += 1;
      if (calls === 2) {
        assert.equal(messages.at(-1)?.role, 'tool');
        return { text: 'Ready for review.', calls: [], usage: undefined };
      }
      assert.equal(calls, 1);
      assert.ok(tools.some((tool) => tool.function.name === 'build'));
      return {
        text: '',
        usage: undefined,
        calls: [
          {
            id: 'fixture-build',
            type: 'function',
            function: {
              name: 'build',
              arguments: JSON.stringify({
                title: 'Studio',
                body: homepage,
                pages,
              }),
            },
          },
        ],
      };
    });
    await runDraft(draftId);
    assert.equal(calls, 2);
    assert.equal(
      (await store.readTurn(businessId, draftId))?.state,
      'completed',
    );
    const website = (await store.listArtifacts(businessId)).find(
      (artifact) => artifact.kind === 'website',
    );
    assert.equal(website?.state, 'pending');
    assert.equal(website.body, homepage);
    assert.deepEqual(website.pages, pages);
  } finally {
    try {
      await sql`delete from businesses where id = ${businessId}`;
      await sql`delete from accounts where id = ${accountId}`;
    } finally {
      await database.close();
    }
  }
});
