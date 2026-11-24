import { z } from 'zod';
import { PIP_BASE_URL, PIP_MODEL } from './pip-routing.ts';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };
export type Tool = {
  type: 'function';
  function: { name: string; description: string; parameters: object };
};

const callSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const completion = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(callSchema).optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export function llmClient(
  config: { key: string; model: string; baseUrl: string },
  request = fetch,
) {
  const base = new URL(config.baseUrl.replace(/\/+$/u, '') + '/');
  const desktop = process.env.BRIGHTWORK_DESKTOP_PIP === '1';
  const guarded = desktop || base.hostname === 'openrouter.ai';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    !(base.protocol === 'https:' || (local && base.protocol === 'http:'))
  ) {
    throw new Error('Configure an HTTPS LLM endpoint or a local runner');
  }
  const endpoint = new URL('chat/completions', base);
  return async (
    messages: Message[],
    tools: Tool[],
    options: { signal?: AbortSignal; maxTokens?: number } = {},
  ) => {
    if (
      guarded &&
      (!desktop ||
        base.href !== `${PIP_BASE_URL}/` ||
        config.model !== PIP_MODEL)
    )
      throw new Error(
        'Pip inference requires the desktop OpenRouter configuration.',
      );
    const maxTokens = options.maxTokens ?? 2048;
    const response = guarded
      ? await (await import('./pip-budget.ts')).pipBudget(config.key, request)(
          {
            messages,
            ...(tools.length ? { tools } : {}),
            max_tokens: maxTokens,
          },
          options.signal ?? AbortSignal.timeout(75_000),
        )
      : await request(endpoint, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + config.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            ...(tools.length
              ? { tools, tool_choice: 'auto', parallel_tool_calls: false }
              : {}),
            max_completion_tokens: maxTokens,
          }),
          redirect: 'error',
          signal: options.signal ?? AbortSignal.timeout(75_000),
        });
    if (!response.ok) throw new Error(`LLM returned status ${response.status}`);
    const result = completion.parse(await response.json());
    const message = result.choices[0]?.message;
    if (!message) throw new Error('LLM returned no response');
    return {
      text: message.content ?? '',
      calls: message.tool_calls ?? [],
      usage: result.usage,
    };
  };
}
