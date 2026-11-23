#!/usr/bin/env node
/**
 * Prove marketing-gallery with Playwright (SPA) plus Vite /health proxy.
 * Writes marketing-gallery.png, gallery-health.json, drive-gallery.json,
 * note-marketing-gallery.md under VERIFY_ROOT.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const origin = process.env.APP_ORIGIN;
const root = process.env.VERIFY_ROOT;
if (!origin || !root) {
  console.error('drive-gallery requires APP_ORIGIN and VERIFY_ROOT');
  process.exit(1);
}

const healthResponse = await fetch(`${origin}/health`, {
  signal: AbortSignal.timeout(5000),
});
const healthText = await healthResponse.text();
let healthJson;
try {
  healthJson = JSON.parse(healthText);
} catch {
  healthJson = { raw: healthText };
}
writeFileSync(
  join(root, 'gallery-health.json'),
  JSON.stringify(
    { status: healthResponse.status, json: healthJson },
    null,
    2,
  ),
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let title = '';
let heading = '';
let brandVisible = false;
try {
  await page.goto(`${origin}/dev/ui`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });
  title = await page.title();
  const headingLocator = page.getByRole('heading', { name: 'UI preview' });
  await headingLocator.waitFor({ timeout: 15_000 });
  heading = (await headingLocator.textContent())?.trim() ?? '';
  brandVisible = (await page.getByText('Brightwork').count()) > 0;
  await page.screenshot({
    path: join(root, 'marketing-gallery.png'),
    fullPage: true,
  });
} finally {
  await browser.close();
}

const healthOk =
  healthResponse.status === 200 && healthJson?.status === 'ok';
const report = {
  featureId: 'marketing-gallery',
  entryPoint: `${origin}/dev/ui`,
  title,
  heading,
  brandVisible,
  healthStatus: healthResponse.status,
  healthOk,
  passed:
    title.includes('UI preview') &&
    title.includes('Brightwork') &&
    heading === 'UI preview' &&
    brandVisible &&
    healthOk,
};

writeFileSync(join(root, 'drive-gallery.json'), JSON.stringify(report, null, 2));
writeFileSync(
  join(root, 'note-marketing-gallery.md'),
  [
    `# marketing-gallery proof`,
    ``,
    `- featureId: marketing-gallery`,
    `- entryPoint: GET ${origin}/dev/ui and GET ${origin}/health`,
    `- sha: ${execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()}`,
    `- title: ${title}`,
    `- heading: ${heading}`,
    `- brandVisible: ${brandVisible}`,
    `- health proxy: HTTP ${healthResponse.status}`,
    `- passed: ${report.passed}`,
    ``,
  ].join('\n'),
);

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
