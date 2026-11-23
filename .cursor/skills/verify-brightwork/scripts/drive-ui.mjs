#!/usr/bin/env node
/**
 * Serial UI drive for verify-brightwork features (landing → new → workbench → build).
 * Verification scaffolding.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(repoRoot, 'apps/worker/package.json'));
const { chromium } = require('playwright-core');

const origin = process.env.APP_ORIGIN;
const out = process.env.VERIFY_ROOT;
if (!origin || !out) {
  console.error('APP_ORIGIN and VERIFY_ROOT required');
  process.exit(1);
}
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const results = [];

async function shot(name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

try {
  // landing-home
  await page.goto(`${origin}/en`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('link', { name: 'Brightwork' }).first().waitFor({ timeout: 15_000 });
  await page.getByRole('navigation', { name: 'Account' }).waitFor();
  await page.getByRole('group', { name: 'Choose a starting point' }).waitFor();
  await page.getByRole('textbox', { name: 'Your business idea' }).waitFor();
  await page.getByRole('button', { name: 'Start with this idea' }).waitFor();
  await page.getByRole('link', { name: 'Log in' }).waitFor();
  results.push({
    feature: 'landing-home',
    ok: true,
    url: page.url(),
    shot: await shot('landing-home'),
  });

  // workspace-creation
  const idea = `maintain verify ${Date.now()} coffee cart`;
  await page.goto(`${origin}/new`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByLabel('Business name').waitFor({ timeout: 20_000 });
  await page.getByLabel('Business name').fill(`Verify ${Date.now()}`);
  const ideaBox = page.getByLabel('Your idea');
  if (await ideaBox.count()) await ideaBox.fill(idea);
  const draft = page.getByLabel(/Have .* draft/u);
  if (await draft.count()) await draft.uncheck().catch(() => undefined);
  await shot('workspace-before-create');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL(/\/f\/[^/]+/u, { timeout: 60_000 });
  const businessUrl = page.url();
  const businessId = businessUrl.match(/\/f\/([^/?#]+)/u)?.[1];
  results.push({
    feature: 'workspace-creation',
    ok: Boolean(businessId),
    url: businessUrl,
    businessId,
    shot: await shot('workspace-after-create'),
  });
  if (!businessId) throw new Error('workspace creation did not reach /f/:id');

  // workbench-home
  await page.goto(`${origin}/f/${businessId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.getByRole('navigation', { name: 'Workspace applications' }).waitFor({
    timeout: 20_000,
  });
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  await page.getByRole('button', { name: 'Search' }).waitFor();
  await page.getByRole('link', { name: 'Inbox' }).waitFor();
  await page.getByRole('link', { name: 'Schedule' }).waitFor();
  await page.getByLabel('Business overview').waitFor();
  results.push({
    feature: 'workbench-home',
    ok: true,
    url: page.url(),
    shot: await shot('workbench-home'),
  });

  // build
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Build' }).click();
  await page.waitForURL(/\/build/u, { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Build', level: 1 }).waitFor();
  await page.locator('#pip-prompt').or(page.getByLabel('Message Pip')).first().waitFor({
    timeout: 20_000,
  });
  results.push({
    feature: 'build',
    ok: true,
    url: page.url(),
    shot: await shot('build-shell'),
  });
} catch (error) {
  results.push({
    feature: 'error',
    ok: false,
    message: String(error),
    url: page.url(),
    shot: await shot('drive-error').catch(() => null),
  });
  await writeFile(path.join(out, 'drive-ui.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(1);
}

await writeFile(path.join(out, 'drive-ui.json'), JSON.stringify(results, null, 2));
await browser.close();
console.log(JSON.stringify(results, null, 2));
