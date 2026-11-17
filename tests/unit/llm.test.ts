import assert from 'node:assert/strict';
import { test } from 'node:test';
import { llmClient } from '../../apps/api/src/llm.ts';

test('Pip sends the configured model and reads the response and token usage', async () => {
  const request = (input: URL | string | Request, options?: RequestInit) => {
    assert.equal(String(input), 'https://example.test/v1/chat/completions');
    assert.equal(options?.redirect, 'error');
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      'Bearer dev-fixture',
    );
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model, 'demo-model');
    assert.deepEqual(payload.messages, [
      { role: 'user', content: 'Write a plan' },
    ]);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Here is the plan.' } }],
          usage: { prompt_tokens: 18, completion_tokens: 6 },
        }),
        { status: 200 },
      ),
    );
  };
  const client = llmClient(
    {
      baseUrl: 'https://example.test/v1/',
      key: 'dev-fixture',
      model: 'demo-model',
    },
    request,
  );
  assert.deepEqual(
    await client([{ role: 'user', content: 'Write a plan' }], []),
    {
      text: 'Here is the plan.',
      calls: [],
      usage: { prompt_tokens: 18, completion_tokens: 6 },
    },
  );
});

test('Pip rejects insecure remote provider URLs', () => {
  assert.throws(
    () =>
      llmClient({
        baseUrl: 'http://example.test/v1',
        key: 'fixture',
        model: 'demo',
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      llmClient({
        baseUrl: 'ftp://localhost/v1',
        key: 'fixture',
        model: 'demo',
      }),
    /HTTPS/,
  );
  assert.doesNotThrow(() =>
    llmClient({
      baseUrl: 'http://localhost:11434/v1',
      key: 'fixture',
      model: 'demo',
    }),
  );
});
