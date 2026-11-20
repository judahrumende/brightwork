import generatedAppPackageLock from './generated-app-package-lock.json' with { type: 'json' };

export type GeneratedAppTemplateFile = { path: string; content: string };

export const generatedAppTemplateFiles: GeneratedAppTemplateFile[] = [
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'foundable-generated-app',
      private: true,
      scripts: {
        typecheck: 'tsc --noEmit',
        build: 'vite build && node scripts/inline-build.mjs',
      },
      dependencies: { react: '19.3.1', 'react-dom': '19.3.1' },
      devDependencies: {
        '@types/react': '19.3.0',
        '@types/react-dom': '19.3.0',
        typescript: '5.9.3',
        vite: '7.3.8',
      },
    }),
  },
  {
    path: 'package-lock.json',
    content: JSON.stringify(generatedAppPackageLock),
  },
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Foundable app preview</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  },
  {
    path: 'tsconfig.json',
    content: JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src'],
    }),
  },
  {
    path: 'src/main.tsx',
    content:
      "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n",
  },
  {
    path: 'src/foundable.d.ts',
    content:
      'export {}; declare global { interface Window { foundableFunctions: { invoke<T = unknown>(name: string, input?: unknown): Promise<T> } } }\n',
  },
  {
    path: 'vite.config.ts',
    content:
      "import { defineConfig } from 'vite';\nexport default defineConfig({ build: { cssCodeSplit: false, assetsInlineLimit: 1000000 } });\n",
  },
  {
    path: 'scripts/inline-build.mjs',
    content: String.raw`import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
let html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/iu);
if (!script) throw new Error('Compiled app script is missing.');
let assetMarkup = html.replace(script[0], '');
const asset = (url) => {
  const resolved = path.resolve('dist', url.replace(/^\/+/, ''));
  if (!resolved.startsWith(path.resolve('dist/assets') + path.sep)) throw new Error('Unexpected build asset path.');
  return resolved;
};
for (const match of [...html.matchAll(/<link\b[^>]*>/giu)]) {
  const tag = match[0];
  if (/\brel="modulepreload"/iu.test(tag)) { html = html.replace(tag, ''); assetMarkup = assetMarkup.replace(tag, ''); continue; }
  if (!/\brel="stylesheet"/iu.test(tag)) continue;
  const href = tag.match(/\bhref="([^"]+)"/iu)?.[1];
  if (!href) throw new Error('Compiled stylesheet URL is missing.');
  const css = await readFile(asset(href), 'utf8');
  html = html.replace(
    tag,
    () => '<style>' + css.replace(/<\/style/giu, '<\\/style') + '</style>',
  );
  assetMarkup = assetMarkup.replace(tag, '');
}
const javascript = await readFile(asset(script[1]), 'utf8');
if (/\bimport\s*\(/u.test(javascript)) throw new Error('Dynamic imports are not supported in generated app previews.');
html = html.replace(
  script[0],
  () =>
    '<script type="module">' +
    javascript.replace(/<\/script/giu, () => '<' + String.fromCharCode(92) + '/script') +
    '</script>',
);
if (/<script\b[^>]*\bsrc=|<link\b[^>]*\b(?:stylesheet|modulepreload)[^>]*\bhref=/iu.test(assetMarkup)) throw new Error('Build output still references external assets.');
if (Buffer.byteLength(html, 'utf8') > 1_000_000) throw new Error('Compiled preview exceeds 1 MB.');
await writeFile('dist/preview.html', html);
`,
  },
];

export function generatedAppProjectFiles(
  sourceFiles: GeneratedAppTemplateFile[],
): GeneratedAppTemplateFile[] {
  const styles = sourceFiles.find(({ path }) => path === 'src/styles.css');
  return [
    ...generatedAppTemplateFiles,
    ...sourceFiles.filter(({ path }) => path !== 'src/styles.css'),
    {
      path: 'src/styles.css',
      content:
        styles?.content ??
        'html{font-family:system-ui,sans-serif}body{margin:0}',
    },
    {
      path: 'README.md',
      content:
        '# Foundable generated app\n\nThis project uses the fixed Vite, React, and TypeScript template used by Foundable isolated builds. It requires Node.js 22 or newer. Run `npm ci`, `npm run typecheck`, and `npm run build`. The build creates `dist/preview.html`. Managed records, sign-in, storage, jobs, and server functions require the Foundable app runtime when the app is published or previewed in Foundable.\n',
    },
  ];
}
