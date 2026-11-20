import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generatedAppSourceFiles,
  generatedAppSourceHash,
} from '../src/workspace/generated-app-source';

test('generated source only accepts bounded app files and stable hashes', () => {
  const files = [
    { path: 'src/styles.css', content: 'main { color: navy; }' },
    {
      path: 'src/components/summary-card.tsx',
      content: 'export function SummaryCard(){return <section/>}',
    },
    {
      path: 'src/App.tsx',
      content:
        "import {SummaryCard} from './components/summary-card'; export default function App(){return <main><SummaryCard/></main>}",
    },
    {
      path: 'src/functions/health.mjs',
      content: 'export default async () => ({ ok: true });',
    },
  ];
  assert.deepEqual(generatedAppSourceFiles.parse(files), files);
  assert.equal(
    generatedAppSourceHash(files),
    generatedAppSourceHash([...files].reverse()),
  );
  assert.throws(() =>
    generatedAppSourceFiles.parse([
      ...files,
      { path: 'package.json', content: '{"scripts":{"postinstall":"evil"}}' },
    ]),
  );
  assert.equal(
    generatedAppSourceFiles.safeParse([
      {
        path: 'src/App.tsx',
        content:
          "import {Card} from './components/missing'; export default Card",
      },
    ]).success,
    false,
  );
  assert.equal(
    generatedAppSourceFiles.safeParse([
      {
        path: 'src/App.tsx',
        content: "import {Card} from 'some-ui-package'; export default Card",
      },
    ]).success,
    false,
  );
  assert.equal(
    generatedAppSourceFiles.safeParse([
      { path: 'src/App.tsx', content: 'export default function App() {}' },
      {
        path: 'src/components/summary-card.tsx',
        content:
          "import {Button} from './missing'; export function Card(){return <Button/>}",
      },
    ]).success,
    false,
  );
  assert.throws(() =>
    generatedAppSourceFiles.parse([
      files[2]!,
      ...Array.from({ length: 5 }, (_, index) => ({
        path: `src/components/card-${index}.tsx`,
        content: 'export function Card(){return <section/>}',
      })),
    ]),
  );
  assert.throws(() =>
    generatedAppSourceFiles.parse([
      { path: 'src/App.tsx', content: 'x' },
      { path: 'src/App.tsx', content: 'y' },
    ]),
  );
  assert.throws(() =>
    generatedAppSourceFiles.parse([
      { path: 'src/App.tsx', content: 'x'.repeat(30_001) },
    ]),
  );
  assert.throws(() =>
    generatedAppSourceFiles.parse([
      files[2]!,
      { path: 'src/functions/../escape.mjs', content: 'export default 1' },
    ]),
  );
  assert.throws(() =>
    generatedAppSourceFiles.parse([
      files[2]!,
      ...Array.from({ length: 6 }, (_, index) => ({
        path: `src/functions/f${index}.mjs`,
        content: 'export default 1',
      })),
    ]),
  );
  const serverFunctionImport = generatedAppSourceFiles.safeParse([
    {
      path: 'src/App.tsx',
      content: "import handler from './functions/health.mjs'",
    },
    files[3]!,
  ]);
  assert.equal(serverFunctionImport.success, false);
  if (!serverFunctionImport.success)
    assert.match(
      serverFunctionImport.error.issues[0]?.message ?? '',
      /unsupported import/u,
    );
  const invalidFunctionCall = generatedAppSourceFiles.safeParse([
    {
      path: 'src/App.tsx',
      content: 'window.foundableFunctions.invoke("send-email")',
    },
  ]);
  assert.equal(invalidFunctionCall.success, false);
  if (!invalidFunctionCall.success)
    assert.match(
      invalidFunctionCall.error.issues[0]?.message ?? '',
      /App invokes missing server function "send-email"/u,
    );
  assert.deepEqual(
    generatedAppSourceFiles.parse([
      {
        path: 'src/App.tsx',
        content: 'window.foundableFunctions.invoke("health")',
      },
      files[3]!,
    ]),
    [
      {
        path: 'src/App.tsx',
        content: 'window.foundableFunctions.invoke("health")',
      },
      files[3]!,
    ],
  );
});
