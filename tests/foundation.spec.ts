import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('foundation gallery renders and menus work with a keyboard', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'UI preview' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Array.from(await document.fonts.ready).some(
          (font) =>
            font.family.replace(/["']/g, '') === 'Plus Jakarta Sans Variable' &&
            font.status === 'loaded',
        ),
      ),
    )
    .toBe(true);

  const trigger = page.getByRole('button', { name: 'Tone · Warm' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Warm' }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Direct' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Tone · Direct' }),
  ).toBeFocused();

  await page.getByRole('button', { name: 'Open modal' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Workspace preferences' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open modal' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('gallery exercises sheets, empty states, segmented controls and toast undo', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page
    .getByRole('radiogroup', { name: 'Report window' })
    .getByRole('radio', { name: '90D' })
    .click();
  await expect(page.getByRole('radio', { name: '90D' })).toBeChecked();
  await page.getByRole('button', { name: 'Open sheet' }).click();
  await page.getByRole('button', { name: 'Approve update' }).click();
  await expect(
    page.getByText('Changes saved', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Ready to save')).toBeVisible();
  await page.getByRole('button', { name: 'Open browser' }).click();
  await expect(page.getByText('Pip hasn’t used the browser yet')).toBeVisible();
});

test('sky uses a static layer with reduced motion and supports dark theme', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  const sky = page.locator('[data-scene="desktop"]');
  await expect
    .poll(() =>
      sky
        .locator('img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(sky.locator('canvas')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(sky).toHaveAttribute('data-animated', 'true');
  await page.getByRole('button', { name: 'Reduce effects' }).click();
  await expect(sky).toHaveAttribute('data-animated', 'false');
  await expect(sky.locator('canvas')).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Theme' })
    .getByRole('radio', { name: 'Dark' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('foundation gallery has no serious accessibility violations', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'UI preview' })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    ),
  ).toEqual([]);
});

test('Vite proxies the API health check', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('capture the foundation and its browser empty state', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/visual/foundation.png' });

  await page.getByRole('button', { name: 'Open browser' }).click();
  const browser = page.getByRole('dialog', { name: 'Browser' });
  await expect(browser).toBeVisible();
  await browser.screenshot({
    path: 'test-results/visual/foundation-browser-empty.png',
  });
});

test('capture the public landing at the tour viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 765 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Your business idea' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/visual/001-landing-hero.png' });
});
