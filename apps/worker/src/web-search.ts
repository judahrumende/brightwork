import { z } from 'zod';

const citation = z.object({
  type: z.literal('url_citation'),
  url: z.url({ protocol: /^https?$/u }),
  title: z.string(),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().nonnegative(),
});
const responseSchema = z.object({
  output: z.array(
    z.object({
      type: z.string(),
      status: z.string().optional(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            annotations: z.array(z.unknown()).optional(),
          }),
        )
        .optional(),
    }),
  ),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .nullish(),
});

export function webSearch(
  config: { key: string; model: string },
  request = fetch,
) {
  return async function search(query: string) {
    const response = await request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: query,
        instructions:
          'Research the public query. Summarize the findings and cite the public pages supporting each material claim.',
        tools: [{ type: 'web_search' }],
        tool_choice: 'required',
        max_output_tokens: 2_000,
        max_tool_calls: 3,
        store: false,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error('Web search was unavailable.');
    const result = responseSchema.parse(await response.json());
    if (
      !result.output.some(
        (item) =>
          item.type === 'web_search_call' && item.status === 'completed',
      )
    )
      throw new Error(
        'The research provider returned without completing a search.',
      );
    const sections = result.output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((content) => content.type === 'output_text' && content.text)
      .map((content) => ({
        text: content.text ?? '',
        citations: (content.annotations ?? [])
          .flatMap((annotation) => {
            const parsed = citation.safeParse(annotation);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(0, 30),
      }));
    if (
      !sections.length ||
      !sections.some((section) => section.citations.length)
    )
      throw new Error('The research provider returned without cited findings.');
    return { sections, usage: result.usage };
  };
}
