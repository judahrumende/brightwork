#!/usr/bin/env node
/**
 * Live drive for workbench-polish: legal pages, home metrics, settings modal.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const require = createRequire(path.join(repoRoot, 'apps/worker/package.json'));
const { chromium } = require('playwright-core');

const origin = process.env.APP_ORIGIN;
const out = process.env.VERIFY_ROOT;
if (!origin || !out) {
  console.error('APP_ORIGIN and VERIFY_ROOT required');
  process.exit(1);
}
await mkdir(out, { recursive: true });

const sha = execSync('git rev-parse HEAD', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const results = [];

async function shot(name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function step(feature, run) {
  try {
    const detail = await run();
    results.push({ feature, ok: true, url: page.url(), ...detail });
  } catch (error) {
    results.push({
      feature,
      ok: false,
      url: page.url(),
      message: String(error),
      shot: await shot(`${feature}-error`).catch(() => null),
    });
    throw error;
  }
}

try {
  await step('polish-legal-terms', async () => {
    await page.goto(`${origin}/terms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page
      .getByRole('heading', { level: 1, name: 'Terms of Service' })
      .waitFor({
        timeout: 15_000,
      });
    await page.getByText('Brightwork and Pip').first().waitFor();
    return { shot: await shot('legal-terms') };
  });

  await step('polish-legal-privacy', async () => {
    await page.goto(`${origin}/privacy`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page
      .getByRole('heading', { level: 1, name: 'Privacy Policy' })
      .waitFor({
        timeout: 15_000,
      });
    return { shot: await shot('legal-privacy') };
  });

  await step('polish-legal-refund', async () => {
    await page.goto(`${origin}/refund-policy`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page
      .getByRole('heading', { level: 1, name: /Refund/i })
      .waitFor({ timeout: 15_000 });
    return { shot: await shot('legal-refund') };
  });

  let businessId = process.env.VERIFY_BUSINESS_ID || '';
  await step('workspace-creation', async () => {
    if (businessId) {
      return { businessId, reused: true };
    }
    await page.goto(`${origin}/new`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.getByLabel('Business name').waitFor({ timeout: 20_000 });
    await page.getByLabel('Business name').fill(`Polish ${Date.now()}`);
    const ideaBox = page.getByLabel('Your idea');
    if (await ideaBox.count())
      await ideaBox.fill(`polish verify coffee cart ${Date.now()}`);
    // When a workspace already exists, Create stays disabled until this is checked.
    const separate = page.getByLabel(/Start a separate workspace/i);
    if (await separate.count()) await separate.check();
    const draft = page.getByLabel(/Have .* draft/u);
    if (await draft.count()) await draft.uncheck().catch(() => undefined);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL(/\/f\/[^/]+/u, { timeout: 60_000 });
    businessId = page.url().match(/\/f\/([^/?#]+)/u)?.[1] ?? '';
    if (!businessId) throw new Error('workspace creation did not reach /f/:id');
    return { businessId, shot: await shot('workspace-after-create') };
  });

  await step('polish-metrics', async () => {
    await page.goto(`${origin}/f/${businessId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page
      .getByRole('navigation', { name: 'Workspace applications' })
      .waitFor({ timeout: 20_000 });
    const overview = page.getByLabel('Business overview');
    await overview.waitFor();
    await overview.getByRole('heading', { name: 'Build' }).waitFor();
    await overview.getByRole('heading', { name: 'Revenue' }).waitFor();
    await overview.getByRole('heading', { name: 'Visitors' }).waitFor();
    await overview.getByRole('heading', { name: 'Insights' }).waitFor();
    await overview.getByText('Last 12 months').waitFor();
    await overview.getByText('Last 7 days').waitFor();
    return { shot: await shot('polish-home-metrics') };
  });

  await step('polish-settings-modal', async () => {
    await page.goto(`${origin}/f/${businessId}/settings`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const dialog = page.getByRole('dialog', { name: 'Workspace settings' });
    await dialog.waitFor({ timeout: 20_000 });
    await dialog
      .getByRole('navigation', { name: 'Business settings' })
      .getByRole('button', { name: 'Team' })
      .waitFor();
    await dialog
      .locator('header')
      .getByRole('heading', { name: 'Team' })
      .waitFor();
    // Radix marks the page inert while the dialog is open, so role queries miss Home chrome.
    // CSS locators still prove Home stayed mounted under the settings modal.
    await page
      .locator('nav[aria-label="Workspace applications"]')
      .waitFor({ state: 'attached', timeout: 10_000 });
    await page
      .locator('nav[aria-label="Main"]')
      .waitFor({ state: 'attached', timeout: 10_000 });
    const shotPath = await shot('polish-settings-modal');
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await page.waitForURL((url) => /\/f\/[^/]+\/?$/u.test(url.pathname), {
      timeout: 20_000,
    });
    await page
      .getByRole('dialog')
      .waitFor({ state: 'hidden', timeout: 10_000 });
    return { shot: shotPath, closedTo: page.url() };
  });
} catch {
  /* results already record the failing step */
}

await writeFile(
  path.join(out, 'drive-polish.json'),
  JSON.stringify(results, null, 2),
);
await writeFile(
  path.join(out, 'note.md'),
  [
    '# workbench-polish',
    '',
    `- feature: workbench-polish`,
    `- sha: ${sha}`,
    `- APP_ORIGIN: ${origin}`,
    `- VERIFY_ROOT: ${out}`,
    `- ok: ${results.every((row) => row.ok)}`,
    '',
    '## Steps',
    ...results.map(
      (row) =>
        `- ${row.feature}: ${row.ok ? 'pass' : 'FAIL'}${row.message ? ` — ${row.message}` : ''}`,
    ),
    '',
  ].join('\n'),
);

await browser.close();
const failed = results.some((row) => !row.ok);
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
