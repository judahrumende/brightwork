import { readFileSync, writeFileSync } from 'node:fs';

const input = new URL('../kit/api-shapes.json', import.meta.url);
const output = new URL(
  '../packages/shared/src/api-contracts.gen.ts',
  import.meta.url,
);
const { observed, referencedNotCalled } = JSON.parse(
  readFileSync(input, 'utf8'),
);

const primitives = new Map([
  ['string', 'z.string()'],
  ['string(uuid)', 'z.uuid()'],
  ['string(datetime)', 'z.iso.datetime({ offset: true })'],
  ['number', 'z.number()'],
  ['boolean', 'z.boolean()'],
  ['null', 'z.null()'],
]);

function schema(shape, optional = [], path = '') {
  if (shape === null) return 'z.unknown()';
  if (typeof shape === 'string') {
    const expression = primitives.get(shape);
    if (!expression) throw new TypeError(`Unrecognized shape ${shape}`);
    return expression;
  }
  if (Array.isArray(shape)) {
    const entries = [
      ...new Set(shape.map((item) => schema(item, optional, path + '[]'))),
    ];
    if (entries.length === 0) return 'z.array(z.unknown())';
    if (entries.length === 1) return `z.array(${entries[0]})`;
    return `z.array(z.union([${entries.join(', ')}]))`;
  }
  const fields = Object.entries(shape).map(([key, value]) => {
    const keyPath = path ? path + '.' + key : key;
    return `[${JSON.stringify(key)}]: ${schema(value, optional, keyPath)}${optional.includes(keyPath) ? '.optional()' : ''}`;
  });
  return `z.looseObject({ ${fields.join(', ')} })`;
}

const rows = observed.map((entry) => {
  const {
    method,
    path,
    statuses,
    responseTypes,
    requestBodySchema,
    responseSchema,
    optionalResponsePaths,
    queryParams,
  } = entry;
  return `  ${JSON.stringify(`${method} ${path}`)}: {
    statuses: ${JSON.stringify(Object.keys(statuses).map(Number))},
    responseTypes: ${JSON.stringify(responseTypes)},
    queryKeys: ${JSON.stringify(queryParams ?? [])},
    request: ${schema(requestBodySchema)},
    response: ${schema(responseSchema, optionalResponsePaths)},
  },`;
});

const content = [
  '// Generated schema evidence from kit/api-shapes.json. Regenerate with pnpm contracts:generate.',
  "import { z } from 'zod';",
  '',
  'export const observedContracts = {',
  ...rows,
  '} as const;',
  '',
  'export const referencedPaths = [',
  ...referencedNotCalled.map((path) => `  ${JSON.stringify(path)},`),
  '] as const;',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== content)
    throw new Error('Generated API contracts are out of date');
} else {
  writeFileSync(output, content);
}
