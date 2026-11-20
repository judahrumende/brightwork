import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWebsite } from './website-builder';
import { requestsApp } from './store-intent';

test('app builds select built-in app instructions and edits keep app runtime', async () => {
  assert.equal(requestsApp('Create a customer booking portal'), true);
  assert.equal(requestsApp('Write an about page for my studio'), false);

  const prompts: string[] = [];
  let savedMode: string | undefined;
  let savedCollections: unknown;
  let savedSource: unknown;
  const fakeStore = {
    workItem: async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'website',
      title: 'Tasks',
      body: '<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1></main></body></html>',
      pages: [],
      revision: 1,
      state: 'approved',
      isStore: false,
      runtimeMode: 'app',
    }),
    appSourceRevision: async () => null,
    appCollections: async () => [
      {
        name: 'audit',
        readAccess: 'admin',
        writeAccess: 'admin',
        ownerScoped: false,
        fields: [{ name: 'event', type: 'text', required: true }],
        actions: [],
      },
    ],
    saveGeneratedWebsite: async (input: {
      runtimeMode?: string;
      appCollections?: unknown;
      sourceFiles?: unknown;
    }) => {
      savedMode = input.runtimeMode;
      savedCollections = input.appCollections;
      savedSource = input.sourceFiles;
      return { id: 'saved' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  let generation = 0;
  const fakeGenerate = (async (messages: Array<{ content: string | null }>) => {
    prompts.push(messages.map((message) => message.content ?? '').join('\n'));
    generation += 1;
    return {
      text:
        generation === 1
          ? JSON.stringify({
              runtimeMode: 'static',
              appCollections: [
                {
                  name: 'tasks',
                  fields: [
                    { name: 'title', type: 'text', required: true },
                    { name: 'done', type: 'boolean', required: false },
                  ],
                },
              ],
              design: 'Clear compact task manager with a warm palette.',
              changes: [
                {
                  slug: '/',
                  action: 'write',
                  title: 'Tasks',
                  brief: 'Manage a personal task list.',
                },
              ],
            })
          : generation === 2
            ? '<!doctype html><html lang="en"><head><title>Tasks</title><style>body{font-family:system-ui}</style></head><body><main><h1>Tasks</h1><section data-foundable-records><div data-foundable-record-list></div><input name="task" data-foundable-field><button type="button" data-foundable-create>Save task</button></section></main></body></html>'
            : JSON.stringify({
                files: [
                  {
                    path: 'src/App.tsx',
                    content:
                      'export default function App(){return <main data-foundable-records="tasks"/>}',
                  },
                ],
              }),
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    { targetId: '11111111-1111-4111-8111-111111111111' },
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Studio',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Add a filter to my current tasks app.',
      toolCallId: 'call_1',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(savedMode, 'app', JSON.stringify(result));
  assert.match(prompts[0] ?? '', /Plan an interactive web app build/u);
  assert.deepEqual(savedCollections, [
    {
      name: 'tasks',
      readAccess: 'authenticated',
      writeAccess: 'authenticated',
      ownerScoped: true,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'done', type: 'boolean', required: false },
      ],
      actions: [],
    },
    {
      name: 'audit',
      readAccess: 'admin',
      writeAccess: 'admin',
      ownerScoped: false,
      fields: [{ name: 'event', type: 'text', required: true }],
      actions: [],
    },
  ]);
  assert.match(prompts[0] ?? '', /"existingAppCollections"/u);
  assert.match(prompts[0] ?? '', /persistent entities/u);
  assert.match(prompts[0] ?? '', /ownerScoped/u);
  assert.match(prompts[0] ?? '', /existingAppCollections/u);
  assert.match(prompts[0] ?? '', /slug "\/" for the homepage/u);
  assert.match(prompts[0] ?? '', /never put HTML, CSS, code/u);
  assert.match(prompts[1] ?? '', /Foundable app runtime/u);
  assert.match(prompts[1] ?? '', /data-foundable-records/u);
  assert.match(prompts[2] ?? '', /Generate the customer-facing React source/u);
  assert.match(prompts[2] ?? '', /data-foundable-record-list/u);
  assert.match(prompts[2] ?? '', /must succeed or fail together/u);
  assert.match(prompts[2] ?? '', /signed-out state/u);
  assert.match(prompts[2] ?? '', /one meaningful main landmark/u);
  assert.match(prompts[2] ?? '', /375px mobile viewport/u);
  assert.equal((savedSource as { path: string }[])[0]?.path, 'src/App.tsx');
});

test('explicit store-to-app conversion selects app backend instructions', async () => {
  const prompts: string[] = [];
  let savedMode: string | undefined;
  const fakeStore = {
    workItem: async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'website',
      title: 'Ceramics',
      body: '<!doctype html><html lang="en"><head><title>Shop</title></head><body><main><h1>Shop</h1></main></body></html>',
      pages: [],
      revision: 1,
      state: 'approved',
      isStore: true,
      runtimeMode: 'store',
    }),
    appSourceRevision: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async (input: { runtimeMode?: string }) => {
      savedMode = input.runtimeMode;
      return { id: 'saved' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  let generation = 0;
  const fakeGenerate = (async (messages: Array<{ content: string | null }>) => {
    prompts.push(messages.map((message) => message.content ?? '').join('\n'));
    generation += 1;
    return {
      text:
        generation === 1
          ? JSON.stringify({
              runtimeMode: 'app',
              appCollections: [
                {
                  name: 'inventory',
                  fields: [{ name: 'name', type: 'text', required: true }],
                },
              ],
              design: 'An inventory workspace for the shop owner.',
              changes: [
                {
                  slug: '/',
                  action: 'write',
                  title: 'Inventory',
                  brief: 'Manage store inventory.',
                },
              ],
            })
          : generation === 2
            ? '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Inventory</title><style>body{font-family:system-ui}</style></head><body><main><h1>Inventory</h1><section data-foundable-records="inventory"><div data-foundable-record-list></div><input name="name" data-foundable-field required><button type="button" data-foundable-create>Save</button></section></main></body></html>'
            : JSON.stringify({
                files: [
                  {
                    path: 'src/App.tsx',
                    content: 'export default function App(){return <main/>}',
                  },
                ],
              }),
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    { targetId: '11111111-1111-4111-8111-111111111111' },
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Ceramics',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Convert my online store into a web app.',
      toolCallId: 'call_convert',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(savedMode, 'app', JSON.stringify(result));
  assert.match(prompts[0] ?? '', /persistent entities/u);
  assert.match(prompts[0] ?? '', /Mark identifiers such as account email/u);
  assert.match(prompts[0] ?? '', /Define named tokens/u);
  assert.match(prompts[1] ?? '', /purposeful CSS geometry/u);
  assert.match(prompts[1] ?? '', /CSS custom properties/u);
  assert.match(prompts[1] ?? '', /Never use gradient text/u);
  assert.doesNotMatch(prompts[1] ?? '', /Use CSS gradients/u);
  assert.match(
    prompts[2] ?? '',
    /reusable CSS custom properties in src\/styles\.css/u,
  );
  assert.doesNotMatch(
    prompts[0] ?? '',
    /managed catalog and order backend automatically/u,
  );
  assert.match(prompts[0] ?? '', /"storefrontRequested":false/u);
});

test('new app builds provision schemas and bounded React source', async () => {
  let saved:
    | {
        runtimeMode?: string;
        appCollections?: unknown;
        sourceFiles?: { path: string; content: string }[];
        sourceBuildResult?: { log: string; previewDocument: string };
      }
    | undefined;
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async (input: {
      runtimeMode?: string;
      appCollections?: unknown;
      sourceFiles?: { path: string; content: string }[];
      sourceBuildResult?: { log: string; previewDocument: string };
    }) => {
      saved = input;
      return { id: 'saved' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  let generation = 0;
  let repairInstruction = '';
  const fakeGenerate = (async (messages: Array<{ content: string | null }>) => {
    generation += 1;
    if (generation === 4) repairInstruction = messages[1]?.content ?? '';
    return {
      text:
        generation === 1
          ? JSON.stringify({
              runtimeMode: 'app',
              design: 'A focused task list.',
              appCollections: [
                {
                  name: 'tasks',
                  readAccess: 'public',
                  writeAccess: 'public',
                  ownerScoped: false,
                  fields: [{ name: 'title', type: 'text', required: true }],
                },
              ],
              changes: [
                {
                  slug: '/',
                  action: 'write',
                  title: 'Tasks',
                  brief: 'Create and track tasks.',
                },
              ],
            })
          : generation === 2
            ? '<!doctype html><html lang="en"><head><title>Tasks</title><style>body{font-family:system-ui}</style></head><body><main><h1>Tasks</h1><section data-foundable-records="tasks"><input name="title" data-foundable-field required><button type="button" data-foundable-create>Save</button><div data-foundable-record-list></div></section></main></body></html>'
            : generation === 3
              ? JSON.stringify({
                  files: [
                    {
                      path: 'src/App.tsx',
                      content: 'export default function App(){return <main/>}',
                    },
                  ],
                })
              : JSON.stringify({
                  files: [
                    {
                      path: 'src/App.tsx',
                      content:
                        'export default function App(){return <main data-foundable-records="tasks"/>}',
                    },
                  ],
                }),
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];
  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Studio',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements:
        'Build a public task board that anyone can read and add tasks to.',
      toolCallId: 'call_2',
    },
    fakeStore,
    fakeGenerate,
    async () =>
      generation === 3
        ? { passed: false, log: 'src/App.tsx: error TS1005: expected ;' }
        : {
            passed: true,
            log: 'typecheck and production build passed',
            previewDocument:
              '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
          },
  );
  assert.equal(saved?.runtimeMode, 'app', JSON.stringify(result));
  assert.deepEqual(saved?.appCollections, [
    {
      name: 'tasks',
      readAccess: 'public',
      writeAccess: 'public',
      ownerScoped: false,
      fields: [{ name: 'title', type: 'text', required: true }],
      actions: [],
    },
  ]);
  assert.equal(saved?.sourceFiles?.[0]?.path, 'src/App.tsx');
  assert.equal(generation, 4, 'invalid app source gets one repair attempt');
  assert.match(repairInstruction, /error TS1005/u);
  assert.equal(
    saved?.sourceBuildResult?.log,
    'typecheck and production build passed',
  );
});

test('store builds automatically apply storefront design and managed catalog instructions', async () => {
  const prompts: string[] = [];
  let saved: { runtimeMode?: string; storeCurrency?: string } | undefined;
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async (input: {
      runtimeMode?: string;
      storeCurrency?: string;
    }) => {
      saved = input;
      return { id: 'saved' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  let generation = 0;
  const fakeGenerate = (async (messages: Array<{ content: string | null }>) => {
    prompts.push(messages.map((message) => message.content ?? '').join('\n'));
    generation += 1;
    return {
      text:
        generation === 1
          ? JSON.stringify({
              runtimeMode: 'store',
              storeCurrency: 'AUD',
              design:
                'Quiet blue-grey surfaces with warm ceramic product details.',
              changes: [
                {
                  slug: '/',
                  action: 'write',
                  title: 'Ceramics',
                  brief: 'Introduce a small handmade ceramics shop.',
                },
              ],
            })
          : '<!doctype html><html lang="en"><head><title>Ceramics</title><style>body{font-family:system-ui}</style></head><body><main><h1>Handmade ceramics</h1><a href="/store/catalog">Browse the catalog</a></main></body></html>',
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Ceramics',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'I want to sell handmade pottery on my website.',
      toolCallId: 'call_store',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(saved?.runtimeMode, 'store', JSON.stringify(result));
  assert.equal(saved?.storeCurrency, 'AUD', JSON.stringify(result));
  assert.match(prompts[0] ?? '', /Plan an ecommerce storefront build/u);
  assert.doesNotMatch(prompts[0] ?? '', /Plan a static website build/u);
  assert.match(
    prompts[0] ?? '',
    /managed catalog and order backend automatically/u,
  );
  assert.match(prompts[1] ?? '', /If the catalog has no products yet/u);
});

test('website planner repairs a missing homepage once before saving a store', async () => {
  let generation = 0;
  let saved = false;
  const prompts: string[] = [];
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async () => {
      saved = true;
      return { id: 'saved' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  const fakeGenerate = (async (messages: Array<{ content: string | null }>) => {
    generation += 1;
    prompts.push(messages.map(({ content }) => content ?? '').join('\n'));
    return {
      text:
        generation === 1
          ? JSON.stringify({
              runtimeMode: 'store',
              storeCurrency: 'AUD',
              design: 'A product-led candle storefront.',
              changes: [
                {
                  slug: 'catalog',
                  action: 'write',
                  title: 'Catalog',
                  brief: 'Explain how to browse the managed catalog.',
                },
              ],
            })
          : generation === 2
            ? JSON.stringify({
                runtimeMode: 'store',
                storeCurrency: 'AUD',
                design: 'A product-led candle storefront.',
                changes: [
                  {
                    slug: '/index.html',
                    action: 'write',
                    title: 'Home',
                    brief: 'Introduce the store and link to its catalog.',
                  },
                ],
              })
            : '<!doctype html><html lang="en"><head><title>Home</title><style>body{font-family:system-ui}</style></head><body><main><h1>Home</h1><a href="/store/catalog">Browse the catalog</a></main></body></html>',
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Candles',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Build an Australian handmade candle store.',
      toolCallId: 'call_store_plan_repair',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(saved, true, JSON.stringify(result));
  assert.equal(generation, 3);
  assert.match(prompts[1] ?? '', /homepage with slug/u);
});

test('website planner canonicalizes generated routes before rendering pages', async () => {
  let generation = 0;
  let savedPages: { slug: string }[] | undefined;
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async (input: { pages?: { slug: string }[] }) => {
      savedPages = input.pages;
      return { id: 'saved' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  const fakeGenerate = (async () => {
    generation += 1;
    return {
      text:
        generation === 1
          ? JSON.stringify({
              design: 'Earthy colors, tactile textures and calm typography.',
              changes: [
                {
                  slug: '/index.html',
                  action: 'write',
                  title: 'Home',
                  brief: 'Introduce the candle studio.',
                },
                {
                  slug: '/products/soy candles.html',
                  action: 'write',
                  title: 'Candles',
                  brief: 'Show the candle collection.',
                },
              ],
            })
          : '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page</title><style>body{font-family:system-ui}</style></head><body><main><h1>Page</h1></main></body></html>',
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Candles',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Build a candle studio website.',
      toolCallId: 'call_normalized_routes',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.ok(!('error' in result), JSON.stringify(result));
  assert.equal(generation, 3);
  assert.deepEqual(
    savedPages?.map(({ slug }) => slug),
    ['products-soy-candles'],
  );
});

test('website planner reports duplicate routes and does not save invalid plans', async () => {
  let saved = false;
  let generation = 0;
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async () => {
      saved = true;
      return { id: 'should-not-save' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  const fakeGenerate = (async () => {
    generation += 1;
    return {
      text: JSON.stringify({
        runtimeMode: 'store',
        storeCurrency: 'AUD',
        design: 'A product-led candle storefront.',
        changes: [
          {
            slug: '/',
            action: 'write',
            title: 'Home',
            brief: 'Describe the home page.',
          },
          {
            slug: '/',
            action: 'write',
            title: 'Home',
            brief: 'Duplicate the home page.',
          },
        ],
      }),
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Candles',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Build an Australian handmade candle store.',
      toolCallId: 'call_invalid_store_plan',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(saved, false);
  assert.equal(generation, 2);
  assert.match(
    'error' in result ? result.error : '',
    /changes\.1\.slug: Each route must appear only once/u,
  );
});

test('website planner requires page briefs and text-only design direction', async () => {
  let saved = false;
  let generation = 0;
  const prompts: string[] = [];
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async () => {
      saved = true;
      return { id: 'should-not-save' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  const fakeGenerate = (async (messages: Array<{ content: string | null }>) => {
    prompts.push(messages.map(({ content }) => content ?? '').join('\n'));
    generation += 1;
    return {
      text: JSON.stringify({
        design: '<html><body>Not a design brief.</body></html>',
        changes: [{ slug: '/', action: 'write', title: 'Home' }],
      }),
      calls: [],
    };
  }) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Candles',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Build a candle store.',
      toolCallId: 'call_missing_brief',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(saved, false);
  assert.equal(generation, 2);
  assert.match(prompts[1] ?? '', /changes\.0\.brief/u);
  assert.match('error' in result ? result.error : '', /changes\.0\.brief/u);
  assert.match(
    'error' in result ? result.error : '',
    /design: Describe visual direction in text/u,
  );
});

test('website planner labels root-level schema errors in its repair feedback', async () => {
  let saved = false;
  const fakeStore = {
    workItem: async () => null,
    appCollections: async () => [],
    saveGeneratedWebsite: async () => {
      saved = true;
      return { id: 'should-not-save' };
    },
  } as unknown as Parameters<typeof buildWebsite>[2];
  const fakeGenerate = (async () => ({
    text: '[]',
    calls: [],
  })) as unknown as Parameters<typeof buildWebsite>[3];

  const result = await buildWebsite(
    {},
    {
      businessId: '22222222-2222-4222-8222-222222222222',
      businessName: 'Candles',
      turnId: '33333333-3333-4333-8333-333333333333',
      requirements: 'Build an Australian handmade candle store.',
      toolCallId: 'call_root_plan_error',
    },
    fakeStore,
    fakeGenerate,
  );

  assert.equal(saved, false);
  assert.match('error' in result ? result.error : '', /\$: /u);
  assert.match(
    'error' in result ? result.error : '',
    /invalid plan after repair/u,
  );
});
