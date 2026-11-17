import { z } from 'zod';

export const runPlan = z
  .array(z.string().trim().min(1).max(2_000))
  .min(1)
  .max(11);

export function readRunPlan(text: string) {
  if (text.length > 16_000) return null;
  try {
    const clean = text
      .trim()
      .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, '$1');
    const result = z.object({ steps: runPlan }).safeParse(JSON.parse(clean));
    return result.success ? [...new Set(result.data.steps)] : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
