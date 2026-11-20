import { Sandbox } from '@vercel/sandbox';
import { generatedAppSourceFiles } from '@brightwork/api/generated-app-source';
import { generatedAppTemplateFiles } from '@brightwork/shared';
import browserCheckPackageLock from './browser-check-package-lock.json' with { type: 'json' };

export const appFiles = generatedAppTemplateFiles;

export const generatedAppPreviewVerificationScript = String.raw`import { pathToFileURL } from 'node:url';
import { chromium as playwright } from 'playwright-core';

const localExecutable = process.env.FOUNDABLE_CHROMIUM_EXECUTABLE_PATH;
const bundledChromium = localExecutable ? null : (await import('@sparticuz/chromium')).default;
const executablePath = bundledChromium
  ? await bundledChromium.executablePath()
  : localExecutable;
if (!executablePath) throw new Error('Chromium executable is unavailable.');
const browser = await playwright.launch({
  args: bundledChromium?.args ?? [],
  executablePath,
  headless: true,
});
const errors = [];
try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await context.addInitScript(() => {
        const response = { records: [], files: [], jobs: [], result: {}, file: { id: 'preview', name: 'preview.txt', mime: 'text/plain', data: '' }, job: { id: 'preview', state: 'queued' } };
        window.foundableFunctions = { invoke: async () => response.result };
        window.foundableStorage = { list: async () => response, put: async () => response, get: async () => response, remove: async () => response };
        window.foundableJobs = { list: async () => response, schedule: async () => response, cancel: async () => response };
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(pathToFileURL(process.cwd() + '/dist/preview.html').href, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => {
        const main = document.querySelector('main');
        const controls = [...document.querySelectorAll('button,[role="button"],input:not([type="hidden"]),select,textarea')]
          .filter(element => element.getClientRects().length > 0)
          .filter(element => {
            const labelled = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.labels?.length || element.getAttribute('title');
            const text = /^(button|submit|reset)$/i.test(element.getAttribute('type') || '') || element.tagName === 'BUTTON' || element.getAttribute('role') === 'button' ? element.textContent?.trim() : '';
            return !labelled && !text;
          }).length;
        return { hasMain: Boolean(main), mainContent: main?.textContent?.trim() || '', rootContent: document.querySelector('#root')?.childElementCount || 0, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamedControls: controls };
      });
      if (!result.hasMain || !result.mainContent || !result.rootContent)
        errors.push(width + 'px: app rendered no meaningful main content.');
      if (result.overflow > 12) errors.push(width + 'px: horizontal overflow is ' + result.overflow + 'px.');
      if (result.unnamedControls) errors.push(width + 'px: ' + result.unnamedControls + ' visible controls have no accessible name.');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Browser preview passed at 375px and 1280px.');
}
`;

type CommandResult = {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
};
type SandboxHandle = {
  writeFiles(files: { path: string; content: string }[]): Promise<void>;
  runCommand(
    command: string,
    args: string[],
    options: { timeoutMs: number },
  ): Promise<CommandResult>;
  readFileToBuffer(file: { path: string }): Promise<Buffer | null>;
  update(params: { networkPolicy: 'deny-all' }): Promise<unknown>;
  stop(): Promise<unknown>;
};

async function createDefaultSandbox() {
  const credentials =
    process.env.VERCEL_TOKEN &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID
      ? {
          token: process.env.VERCEL_TOKEN,
          teamId: process.env.VERCEL_TEAM_ID,
          projectId: process.env.VERCEL_PROJECT_ID,
        }
      : {};
  return Sandbox.create({
    ...credentials,
    runtime: 'node24',
    timeout: 240_000,
    persistent: false,
    resources: { vcpus: 2 },
    networkPolicy: { allow: ['registry.npmjs.org'] },
  });
}

export async function buildGeneratedAppSource(
  files: { path: string; content: string }[],
  createSandbox: () => Promise<SandboxHandle> = createDefaultSandbox,
) {
  const validatedFiles = generatedAppSourceFiles.parse(files);
  const sandbox = await createSandbox();
  const logs: string[] = [];
  try {
    const result = async (command: string, args: string[]) => {
      const run = await sandbox.runCommand(command, args, {
        timeoutMs: 150_000,
      });
      logs.push(await run.stdout(), await run.stderr());
      if (run.exitCode !== 0)
        throw new Error(`${command} ${args.join(' ')} failed.`);
    };
    await sandbox.writeFiles([
      ...appFiles,
      {
        path: 'browser-check/package.json',
        content: JSON.stringify({
          name: 'foundable-browser-check',
          private: true,
          dependencies: {
            '@sparticuz/chromium': '153.0.0',
            'playwright-core': '1.65.1',
          },
        }),
      },
      {
        path: 'browser-check/package-lock.json',
        content: JSON.stringify(browserCheckPackageLock),
      },
      {
        path: 'browser-check/verify-preview.mjs',
        content: generatedAppPreviewVerificationScript,
      },
      ...validatedFiles.filter((file) => file.path !== 'src/styles.css'),
      {
        path: 'src/styles.css',
        content:
          validatedFiles.find((file) => file.path === 'src/styles.css')
            ?.content ?? 'html{font-family:system-ui,sans-serif}body{margin:0}',
      },
    ]);
    await result('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    await result('npm', [
      'ci',
      '--prefix',
      'browser-check',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    await sandbox.update({ networkPolicy: 'deny-all' });
    await result('npm', ['run', 'typecheck']);
    for (const file of validatedFiles.filter(({ path }) =>
      path.startsWith('src/functions/'),
    ))
      await result('node', ['--check', file.path]);
    await result('npm', ['run', 'build']);
    await result('node', ['browser-check/verify-preview.mjs']);
    const preview = await sandbox.readFileToBuffer({
      path: 'dist/preview.html',
    });
    if (!preview || preview.byteLength > 1_000_000)
      throw new Error('Compiled app preview is missing or exceeds 1 MB.');
    return {
      passed: true,
      log: logs.join('\n').slice(-16_000),
      previewDocument: preview.toString('utf8'),
    };
  } catch (error) {
    logs.push(
      error instanceof Error ? error.message : 'Isolated build failed.',
    );
    return { passed: false, log: logs.join('\n').slice(-16_000) };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
