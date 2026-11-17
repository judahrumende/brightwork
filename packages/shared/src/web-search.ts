import { z } from 'zod';

export const webSearchRequest = z.strictObject({
  question: z.string().trim().min(3).max(500),
});

const sourceId = z.string().regex(/^s[1-5]$/u);
export const publicSearchHits = z.object({
  hits: z
    .array(
      z.object({
        title: z.string(),
        url: z.url({ protocol: /^https?$/u }),
        excerpt: z.string().nullable(),
      }),
    )
    .max(5),
});
export type PublicSearchHits = z.infer<typeof publicSearchHits>;
const excerpt = z
  .string()
  .min(1)
  .max(280)
  .refine((value) => Boolean(value.trim()));
const citation = z.strictObject({ sourceId, evidence: excerpt });
const source = z.strictObject({
  id: sourceId,
  title: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => Boolean(value.trim())),
  url: z
    .url({ protocol: /^https?$/u })
    .max(2048)
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.href === value &&
        !url.username &&
        !url.password &&
        !url.port &&
        !value.includes('#')
      );
    }),
  snippet: excerpt,
});

export const webSearchResponse = z
  .strictObject({
    answer: z
      .array(
        z.strictObject({
          text: z
            .string()
            .min(1)
            .max(360)
            .refine((value) => Boolean(value.trim())),
          citations: z.array(citation).min(1).max(3),
        }),
      )
      .min(1)
      .max(6),
    sources: z.array(source).min(1).max(5),
  })
  .refine(({ answer, sources }) => {
    if (new Set(sources.map(({ url }) => url)).size !== sources.length)
      return false;
    const firstUsed = new Map<string, string>();
    for (const { citations } of answer) {
      if (
        new Set(citations.map(({ sourceId }) => sourceId)).size !==
        citations.length
      )
        return false;
      for (const { sourceId, evidence } of citations) {
        if (!firstUsed.has(sourceId)) firstUsed.set(sourceId, evidence);
      }
    }
    return (
      firstUsed.size === sources.length &&
      [...firstUsed].every(([id, evidence], index) => {
        const row = sources[index];
        return (
          id === `s${index + 1}` && row?.id === id && row.snippet === evidence
        );
      })
    );
  });

export const webSearchError = z.strictObject({
  code: z.enum([
    'invalid_request',
    'sign_in_required',
    'forbidden',
    'business_not_found',
    'request_too_large',
    'unsupported_media_type',
    'no_evidence',
    'rate_limited',
    'upstream_error',
    'unavailable',
    'deadline_exceeded',
  ]),
  message: z.string().min(1),
});

export type WebSearchCode = z.infer<typeof webSearchError>['code'];
export type WebSearchResponse = z.infer<typeof webSearchResponse>;
