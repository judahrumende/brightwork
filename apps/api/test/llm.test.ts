import assert from 'node:assert/strict';
import test from 'node:test';
import { llmClient, llmTimeoutMs } from '../src/llm';

test('local LLM runners get a longer timeout, with an explicit override', () => {
  assert.equal(llmTimeoutMs('127.0.0.1'), 180_000);
  assert.equal(llmTimeoutMs('localhost'), 180_000);
  assert.equal(llmTimeoutMs('api.example.test'), 75_000);
  assert.equal(llmTimeoutMs('127.0.0.1', 120_000), 120_000);
});

test('Ollama uses native structured outputs and adapts tool messages', async () => {
  let endpoint: string | undefined;
  let body: Record<string, unknown> | undefined;
  const client = llmClient(
    {
      key: 'local-test-key',
      model: 'fixture-model',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiStyle: 'ollama',
    },
    async (input, init) => {
      endpoint = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        message: {
          role: 'assistant',
          content: 'done',
          tool_calls: [
            { function: { name: 'build', arguments: { targetId: 'site-1' } } },
          ],
        },
        prompt_eval_count: 12,
        eval_count: 4,
      });
    },
  );
  const schema = { type: 'object', properties: { route: { type: 'string' } } };
  const result = await client(
    [
      { role: 'system', content: 'Plan the build.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'openai-call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"id":"site-1"}' },
          },
        ],
      },
      { role: 'tool', content: 'Found site', tool_call_id: 'openai-call-1' },
    ],
    [
      {
        type: 'function',
        function: {
          name: 'build',
          description: 'Build a website',
          parameters: { type: 'object' },
        },
      },
    ],
    { json: schema, maxTokens: 512 },
  );

  assert.equal(endpoint, 'http://127.0.0.1:11434/api/chat');
  assert.equal(body?.stream, false);
  assert.deepEqual(body?.format, schema);
  assert.deepEqual(body?.options, { num_predict: 512 });
  assert.deepEqual((body?.messages as unknown[])[1], {
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'lookup', arguments: { id: 'site-1' } } }],
  });
  assert.equal(result.text, 'done');
  assert.equal(result.calls[0]?.function.name, 'build');
  assert.deepEqual(JSON.parse(result.calls[0]?.function.arguments ?? ''), {
    targetId: 'site-1',
  });
  assert.deepEqual(result.usage, { prompt_tokens: 12, completion_tokens: 4 });
});

test('OpenAI-compatible LLM remains the default API style', async () => {
  let endpoint: string | undefined;
  const client = llmClient(
    {
      key: 'fixture-key',
      model: 'fixture-model',
      baseUrl: 'https://llm.example.test/v1',
    },
    async (input) => {
      endpoint = String(input);
      return Response.json({
        choices: [{ message: { content: 'done' } }],
      });
    },
  );
  const result = await client([], []);
  assert.equal(endpoint, 'https://llm.example.test/v1/chat/completions');
  assert.equal(result.text, 'done');
});
