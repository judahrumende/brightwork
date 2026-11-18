import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const marketing = [
  '/',
  '/pricing',
  '/security',
  '/solutions/websites',
  '/solutions/selling-online',
  '/solutions/run',
  '/solutions/marketing',
  '/solutions/ads',
  '/solutions/social-media',
  '/solutions/videos',
  '/solutions/email',
  '/solutions/phone',
  '/solutions/get-found',
  '/integrations',
  '/blog',
  '/solutions/small-businesses',
  '/solutions/creators',
  '/solutions/side-projects',
  '/ideas',
  '/about',
  '/careers',
  '/press',
  '/contact',
  '/community',
];

test('the production server returns unique public HTML and keeps its cache independent of cookies', async ({
  request,
  baseURL,
}) => {
  const titles = new Set();
  for (const path of marketing) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=300');
    expect(response.headers()['set-cookie']).toBeUndefined();
    const html = await response.text();
    expect(html).toContain('data-marketing-ssr');
    expect(html).toContain('<h1>');
    expect(html).toContain('name="description"');
    expect(html).toContain('href="' + baseURL + path + '"');
    titles.add(html.match(/<title>([^<]+)<\/title>/u)?.[1]);
  }
  expect(titles.size).toBe(marketing.length);
  expect(titles.has(undefined)).toBe(false);
  const publicPage = await request.get('/pricing');
  const withSession = await request.get('/pricing?workspace=private-demo', {
    headers: { cookie: 'bw-session=workspace-cookie' },
  });
  expect(await withSession.text()).toBe(await publicPage.text());
  const account = await request.get('/home');
  expect(account.headers()['cache-control']).toBe('no-store');
  expect(await account.text()).not.toContain('data-marketing-ssr');
  expect(
    (await request.get('/api/me/session')).headers()['cache-control'],
  ).not.toContain('public');
  for (const path of [
    '/solutions/unlisted',
    '/server/marketing-server.js',
    '/api/unlisted',
  ]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  const otherHost = await request.get('/pricing', {
    headers: { Host: 'published.example.test' },
  });
  expect(otherHost.status()).toBe(404);
  expect(await otherHost.text()).not.toContain('data-marketing-ssr');
  const head = await request.head('/security');
  expect(head.status()).toBe(200);
  expect(await head.text()).toBe('');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 360, height: 780 } });
  test('a mobile visitor can navigate the rendered links', async ({ page }) => {
    await page.goto('/pricing');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Plans and usage' }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(360);
    await page.getByRole('link', { name: 'Build a website' }).click();
    await expect(page).toHaveURL(/\/solutions\/websites$/u);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Build a website' }),
    ).toBeVisible();
  });
});

test('the landing idea form hydrates and saves the idea through signup', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const idea = page.getByRole('textbox', { name: 'Your business idea' });
  await page.getByRole('button', { name: 'Try an idea' }).click();
  await expect(idea).toHaveValue('Build a website for my catering business');
  await page.getByRole('button', { name: 'Start with this idea' }).click();
  await expect(page).toHaveURL(/\/sign-up\?returnTo=%2Fnew/u);
  expect(
    await page.evaluate(() => sessionStorage.getItem('brightwork-idea')),
  ).toBe('Build a website for my catering business');
  expect(errors).toEqual([]);
});

test('public workflows pass accessibility checks', async ({ page }) => {
  for (const path of ['/solutions/run', '/integrations']) {
    await page.goto(path);
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(audit.violations, path).toEqual([]);
  }
});
