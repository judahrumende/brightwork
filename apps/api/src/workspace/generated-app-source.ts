import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';

const sourceFile = z.object({
  path: z.string().max(128),
  content: z.string().min(1).max(30_000),
});

export const generatedAppSourceFiles = z
  .array(sourceFile)
  .min(1)
  .max(11)
  .superRefine((files, context) => {
    if (!files.some(({ path }) => path === 'src/App.tsx'))
      context.addIssue({
        code: 'custom',
        message: 'Generated app source must include src/App.tsx.',
      });
    if (new Set(files.map(({ path }) => path)).size !== files.length)
      context.addIssue({
        code: 'custom',
        message: 'Generated app source paths must be unique.',
      });
    const functions = files.filter(({ path }) =>
      path.startsWith('src/functions/'),
    );
    const components = files.filter(({ path }) =>
      path.startsWith('src/components/'),
    );
    const functionNames = new Set(
      functions.map(({ path }) =>
        path.slice('src/functions/'.length, -'.mjs'.length),
      ),
    );
    const app = files.find(({ path }) => path === 'src/App.tsx');
    const browserFiles = files.filter(
      ({ path }) =>
        path === 'src/App.tsx' || path.startsWith('src/components/'),
    );
    if (
      files.some(
        ({ path }) =>
          path !== 'src/App.tsx' &&
          path !== 'src/styles.css' &&
          !/^src\/components\/[a-z][a-z0-9-]{0,47}\.tsx$/u.test(path) &&
          !/^src\/functions\/[a-z][a-z0-9-]{0,47}\.mjs$/u.test(path),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Generated app source contains an unsupported file path.',
      });
    if (functions.length > 5)
      context.addIssue({
        code: 'custom',
        message: 'Generated apps may define at most five server functions.',
      });
    if (components.length > 4)
      context.addIssue({
        code: 'custom',
        message: 'Generated apps may define at most four reusable components.',
      });
    if (functions.some(({ content }) => content.length > 20_000))
      context.addIssue({
        code: 'custom',
        message: 'Each server function must be 20 KiB or smaller.',
      });
    const filePaths = new Set(files.map(({ path }) => path));
    for (const file of browserFiles)
      for (const [, specifier] of file.content.matchAll(
        /\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/gu,
      )) {
        const target = posix.normalize(
          posix.join(posix.dirname(file.path), specifier!),
        );
        if (
          specifier !== 'react' &&
          (!specifier!.startsWith('.') ||
            !target.startsWith('src/components/') ||
            !filePaths.has(target.endsWith('.tsx') ? target : `${target}.tsx`))
        )
          context.addIssue({
            code: 'custom',
            message: `Browser source has an unsupported import "${specifier}" in ${file.path}.`,
          });
      }
    for (const [, name] of app?.content.matchAll(
      /window\.foundableFunctions\.invoke\(\s*['"]([a-z][a-z0-9-]{0,47})['"]/gu,
    ) ?? [])
      if (!functionNames.has(name!))
        context.addIssue({
          code: 'custom',
          message: `App invokes missing server function "${name}".`,
        });
    if (
      files.reduce(
        (size, file) => size + Buffer.byteLength(file.content, 'utf8'),
        0,
      ) > 45_000
    )
      context.addIssue({
        code: 'custom',
        message: 'Generated app source exceeds 45 KiB.',
      });
  });

export type GeneratedAppSourceFile = z.infer<typeof sourceFile>;

export function generatedAppSourceHash(files: GeneratedAppSourceFile[]) {
  const normalized = generatedAppSourceFiles.parse(files);
  normalized.sort((a, b) => a.path.localeCompare(b.path));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
