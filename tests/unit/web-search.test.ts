import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webSearch } from '../../apps/worker/src/web-search.ts';

test('public web search requests provenance and keeps valid citation ranges', async () => {
  const valid = {
    type: 'url_citation',
    title: 'Example',
    url: 'https://example.test/',
    start_index: 0,
    end_index: 8,
  };
  const search = webSearch(
    { key: 'fixture', model: 'fixture-model' },
    async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.input, 'Public query');
      assert.equal(payload.store, false);
      assert.deepEqual(payload.tools, [{ type: 'web_search' }]);
      return Response.json({
        output: [
          { type: 'web_search_call', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Research results',
                annotations: [valid, { ...valid, url: 'javascript:alert(1)' }],
              },
            ],
          },
        ],
        usage: { input_tokens: 16, output_tokens: 8 },
      });
    },
  );
  assert.deepEqual(await search('Public query'), {
    sections: [{ text: 'Research results', citations: [valid] }],
    usage: { input_tokens: 16, output_tokens: 8 },
  });
});

test('reports a provider result that lacks a completed search', async () => {
  const search = webSearch({ key: 'fixture', model: 'fixture' }, async () =>
    Response.json({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Unverified answer' }],
        },
      ],
    }),
  );
  await assert.rejects(search('Public query'), /without completing a search/);
});
