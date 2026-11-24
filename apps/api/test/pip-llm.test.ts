import assert from 'node:assert/strict';
import { test } from 'node:test';
import { llmClient } from '../src/llm';

test('desktop LLM rejects model and endpoint overrides before sending', async (t) => {
  const previous = process.env.BRIGHTWORK_DESKTOP_PIP;
  process.env.BRIGHTWORK_DESKTOP_PIP = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.BRIGHTWORK_DESKTOP_PIP;
    else process.env.BRIGHTWORK_DESKTOP_PIP = previous;
  });

  let requests = 0;
  const request: typeof fetch = async () => {
    requests += 1;
    return Response.json({ choices: [{ message: { content: 'unexpected' } }] });
  };
  const modelOverride = llmClient(
    {
      key: 'fixture-key',
      model: 'another-model',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    request,
  );
  const endpointOverride = llmClient(
    {
      key: 'fixture-key',
      model: 'z-ai/glm-5.3-flash',
      baseUrl: 'https://llm.example.test/v1',
    },
    request,
  );

  await assert.rejects(modelOverride([], []));
  await assert.rejects(endpointOverride([], []));
  assert.equal(requests, 0);
});
