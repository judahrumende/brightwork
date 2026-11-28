import js from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const timerMessage =
  'Prefer declarative UI updates or an allowlisted timing helper. Do not add imperative timers as a quick fix; if a timer is required, use an existing allowlisted module or extend the allowlist with a root-cause note in the PR.';

const timerRestrictedSyntax = [
  {
    selector: "CallExpression[callee.name='setTimeout']",
    message: timerMessage,
  },
  {
    selector: "CallExpression[callee.name='setInterval']",
    message: timerMessage,
  },
  {
    selector: "CallExpression[callee.name='requestAnimationFrame']",
    message: timerMessage,
  },
  {
    selector: "CallExpression[callee.name='requestIdleCallback']",
    message: timerMessage,
  },
  {
    selector:
      "CallExpression[callee.object.name='window'][callee.property.name='setTimeout']",
    message: timerMessage,
  },
  {
    selector:
      "CallExpression[callee.object.name='window'][callee.property.name='setInterval']",
    message: timerMessage,
  },
  {
    selector:
      "CallExpression[callee.object.name='window'][callee.property.name='requestAnimationFrame']",
    message: timerMessage,
  },
  {
    selector:
      "CallExpression[callee.object.name='window'][callee.property.name='requestIdleCallback']",
    message: timerMessage,
  },
];

const webTimerAllowlist = [
  'apps/web/src/workbench/workbench.tsx',
  'apps/web/src/workbench/app-dashboard.tsx',
  'apps/web/src/workbench/session.tsx',
  'apps/web/src/workbench/agent.tsx',
  'apps/web/src/workbench/workspace-files.tsx',
  'apps/web/src/workbench/performance-quality.ts',
  'apps/web/src/ui/landing.tsx',
  'apps/web/src/workbench/tutorial-hub.tsx',
  'apps/web/src/workbench/timed-calendar.tsx',
  'apps/web/src/routes/share.$token.tsx',
  'apps/web/src/workbench/website-editor.tsx',
  'apps/web/src/sky/clouds.worker.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/routeTree.gen.ts',
      '**/api-contracts.gen.ts',
      'kit/**',
      'reference-v1/**',
      'test-results/**',
      'playwright-report/**',
      'output/**',
      'graphify-out/**',
      '.codex/worktrees/**',
      '.local-runtime/**',
      '.playwright-cli/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@brightwork/api',
              message:
                'Web must not import the API package. Use @brightwork/shared contracts and HTTP via the same-origin api() helper.',
            },
            {
              name: '@brightwork/worker',
              message:
                'Web must not import the worker package. Call HTTP APIs; the worker is a separate host.',
            },
          ],
          patterns: [
            {
              group: ['@brightwork/api/*', '**/apps/api/**'],
              message:
                'Web must not import API modules. Use @brightwork/shared contracts and HTTP.',
            },
            {
              group: ['@brightwork/worker/*', '**/apps/worker/**'],
              message:
                'Web must not import worker modules. Call HTTP APIs instead.',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...timerRestrictedSyntax],
    },
  },
  {
    files: webTimerAllowlist,
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['apps/api/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@brightwork/web',
              message:
                'API must not import the web package. Keep HTTP adapters and domain code server-side.',
            },
            {
              name: '@brightwork/worker',
              message:
                'API must not import the worker package. Share types via @brightwork/shared or API exports the worker already consumes.',
            },
          ],
          patterns: [
            {
              group: ['@brightwork/web/*', '**/apps/web/**'],
              message:
                'API must not import web modules. Keep the browser package out of the server host.',
            },
            {
              group: ['@brightwork/worker/*', '**/apps/worker/**'],
              message:
                'API must not import worker modules. Extract shared server code under API exports if both hosts need it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/worker/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@brightwork/web',
              message:
                'Worker must not import the web package. Use @brightwork/api and @brightwork/shared only.',
            },
          ],
          patterns: [
            {
              group: ['@brightwork/web/*', '**/apps/web/**'],
              message:
                'Worker must not import web modules. Use @brightwork/api and @brightwork/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@brightwork/web',
              message:
                'shared must stay browser-safe and app-agnostic. Do not import apps.',
            },
            {
              name: '@brightwork/api',
              message:
                'shared must stay browser-safe and app-agnostic. Do not import apps.',
            },
            {
              name: '@brightwork/worker',
              message:
                'shared must stay browser-safe and app-agnostic. Do not import apps.',
            },
          ],
          patterns: [
            {
              group: [
                '@brightwork/web/*',
                '@brightwork/api/*',
                '@brightwork/worker/*',
                '**/apps/**',
              ],
              message:
                'shared must not import apps. Keep contracts and pure helpers only.',
            },
          ],
        },
      ],
    },
  },
);
