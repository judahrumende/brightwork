import { randomUUID } from 'node:crypto';
import { z } from 'zod';

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

export function llmTimeoutMs(host: string, configured?: number) {
  return (
    configured ??
    (['localhost', '127.0.0.1', '[::1]'].includes(host) ? 180_000 : 75_000)
  );
}

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
const ollamaCompletion = z.object({
  message: z.object({
    content: z.string().nullable().optional(),
    tool_calls: z
      .array(
        z.object({
          function: z.object({
            name: z.string(),
            arguments: z.unknown().optional(),
          }),
        }),
      )
      .optional(),
  }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

function ollamaMessages(messages: Message[]) {
  return messages.map((message) => {
    if (message.role === 'tool')
      return { role: 'tool', content: message.content };
    if (message.role === 'assistant')
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...(message.tool_calls?.length
          ? {
              tool_calls: message.tool_calls.map((call) => ({
                function: {
                  name: call.function.name,
                  arguments: JSON.parse(call.function.arguments) as unknown,
                },
              })),
            }
          : {}),
      };
    return { role: message.role, content: message.content };
  });
}

export function llmClient(
  config: {
    key: string;
    model: string;
    baseUrl: string;
    timeoutMs?: number;
    apiStyle?: 'openai' | 'ollama';
  },
  request = fetch,
) {
  const base = new URL(config.baseUrl.replace(/\/+$/u, '') + '/');
  const apiStyle = config.apiStyle ?? 'openai';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    !(base.protocol === 'https:' || (local && base.protocol === 'http:'))
  ) {
    throw new Error('Configure an HTTPS LLM endpoint or a local runner');
  }
  if (
    apiStyle === 'ollama' &&
    base.pathname.replace(/\/+$/u, '').endsWith('/v1')
  )
    base.pathname = base.pathname.replace(/\/v1\/?$/u, '') || '/';
  const endpoint = new URL(
    apiStyle === 'ollama' ? 'api/chat' : 'chat/completions',
    base,
  );
  return async (
    messages: Message[],
    tools: Tool[],
    options: { signal?: AbortSignal; maxTokens?: number; json?: object } = {},
  ) => {
    if (apiStyle === 'ollama') {
      const response = await request(endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: ollamaMessages(messages),
          stream: false,
          ...(tools.length ? { tools } : {}),
          ...(options.json ? { format: options.json } : {}),
          options: { num_predict: options.maxTokens ?? 2048 },
        }),
        redirect: 'error',
        signal:
          options.signal ??
          AbortSignal.timeout(llmTimeoutMs(base.hostname, config.timeoutMs)),
      });
      if (!response.ok)
        throw new Error(`LLM returned status ${response.status}`);
      const result = ollamaCompletion.parse(await response.json());
      return {
        text: result.message.content ?? '',
        calls: (result.message.tool_calls ?? []).map((call) => ({
          id: randomUUID(),
          type: 'function' as const,
          function: {
            name: call.function.name,
            arguments:
              typeof call.function.arguments === 'string'
                ? call.function.arguments
                : (JSON.stringify(call.function.arguments ?? {}) ?? '{}'),
          },
        })),
        usage:
          result.prompt_eval_count === undefined ||
          result.eval_count === undefined
            ? undefined
            : {
                prompt_tokens: result.prompt_eval_count,
                completion_tokens: result.eval_count,
              },
      };
    }
    const response = await request(endpoint, {
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
        max_completion_tokens: options.maxTokens ?? 2048,
        ...(options.json
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'website_plan', schema: options.json },
              },
            }
          : {}),
      }),
      redirect: 'error',
      signal:
        options.signal ??
        AbortSignal.timeout(llmTimeoutMs(base.hostname, config.timeoutMs)),
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
