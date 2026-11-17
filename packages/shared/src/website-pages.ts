import { z } from 'zod';

const reserved = new Set(['api', 'auth', 'health']);
export const websitePageSlug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .refine((slug) => !reserved.has(slug));

export const websitePages = z
  .array(
    z.object({
      slug: websitePageSlug,
      title: z.string().trim().min(1).max(160),
      html: z.string().trim().min(1).max(60_000),
    }),
  )
  .max(7)
  .refine(
    (pages) => new Set(pages.map((page) => page.slug)).size === pages.length,
    {
      message: 'Use a different address for each page.',
    },
  )
  .refine(
    (pages) =>
      pages.reduce((size, page) => size + page.html.length, 0) <= 160_000,
    {
      message: 'The additional pages are too large.',
    },
  );

export type WebsitePage = z.infer<typeof websitePages>[number];

export function websiteDocument(
  document: string,
  pages: WebsitePage[],
  slug: string,
) {
  return slug === ''
    ? document
    : (pages.find((page) => page.slug === slug)?.html ?? null);
}
