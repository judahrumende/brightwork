import { expect, test } from '@playwright/test';

const company = {
  id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
  role: 'owner',
  name: 'Demo',
};
const workspace = `/f/${company.id}`;
const question = 'What does HTTP 404 mean?';
const excerpt = 'The server cannot find the requested resource.';
const source = {
  id: 's1',
  title: 'HTTP 404 reference',
  url: 'https://example.com/http-404',
  snippet: excerpt,
};
const answer = {
  answer: [
    { text: excerpt, citations: [{ sourceId: 's1', evidence: excerpt }] },
  ],
  sources: [source],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => {
    if (route.request().url().endsWith('/me/session')) {
      return route.fulfill({
        json: {
          userId: 'research-test',
          companyList: { companies: [company], lastOpened: company.id },
          profile: {
            name: 'Owner',
            timezone: 'UTC',
            browserTimezone: 'UTC',
            appearance: 'light',
            background: 'plain',
            reduceEffects: true,
          },
          session: { name: 'Owner', email: 'owner@example.test' },
          creditBalance: { available: '10' },
        },
      });
    }
    return route.fulfill({
      json: { items: [], daily: [], turns: [], runs: [] },
    });
  });
});

test('Research opens from the dock and shows cited answers and mobile history', async ({
  page,
}) => {
  await page.route('**/web-search', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-session-id']).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({ question });
    await route.fulfill({ json: answer });
  });
  await page.goto(workspace);
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  await expect(
    page.getByText('Search the web to get an answer with sources.'),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 780 });
  const input = page.getByRole('searchbox', { name: 'Ask a question' });
  await input.fill(` ${question} `);
  await input.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Answer', exact: true }),
  ).toBeVisible();
  const citation = page.getByRole('link', {
    name: 'Source 1: HTTP 404 reference',
  });
  await expect(citation).toHaveText('[1]');
  await citation.click();
  await expect(page).toHaveURL(/#research-source-s1$/);
  const link = page.getByRole('link', { name: source.title, exact: true });
  await expect(link).toHaveAttribute('href', source.url);
  await expect(link).toHaveAttribute('target', '_blank');
  await page.getByText('Evidence excerpt').click();
  await expect(page.locator('blockquote')).toHaveText(excerpt);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.reload();
  await page.getByRole('button', { name: question }).click();
  await expect(input).toHaveValue(question);
  await page.getByRole('button', { name: 'Clear history' }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Recent searches' }),
  ).toHaveCount(0);
});

test('Research ignores canceled responses and can retry an API failure', async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/web-search', async (route) => {
    calls++;
    if (calls === 1) {
      await hold;
      await route.fulfill({ json: answer }).catch(() => {});
    } else if (calls === 2) {
      await route.fulfill({ status: 504, json: { message: 'Timed out.' } });
    } else {
      await route.fulfill({ json: answer });
    }
  });
  await page.goto(`${workspace}/research`);
  const form = page.getByRole('search', { name: 'Web research' });
  const input = form.getByRole('searchbox');
  await input.fill(question);
  const submitted = page.waitForRequest('**/web-search');
  await form.getByRole('button', { name: 'Search', exact: true }).click();
  await submitted;
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Searching and checking sources' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Cancel' }).click();
  release();
  await expect(page.getByText('Search canceled.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Answer', exact: true }),
  ).toHaveCount(0);
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Research took too long');
  await expect(input).toHaveValue(question);
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
});

test('Research explains rate limits and keeps the saved-work shortcut available', async ({
  page,
}) => {
  await page.route('**/web-search', (route) =>
    route.fulfill({ status: 429, json: { message: 'Search limit reached.' } }),
  );
  await page.goto(`${workspace}/research`);
  const input = page.getByRole('searchbox', { name: 'Ask a question' });
  await input.fill(question);
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('reached a search limit');
  await expect(input).toHaveValue(question);
  await page.keyboard.press('Control+k');
  await expect(
    page.getByRole('dialog', { name: 'Search workspace' }),
  ).toBeVisible();
});

test('Research can show live source links when the answer provider fails', async ({
  page,
}) => {
  await page.route('**/web-search', (route) =>
    route.fulfill({ status: 502, json: { message: 'Model unavailable.' } }),
  );
  await page.route('**/growth/sources', (route) => {
    expect(route.request().postDataJSON()).toEqual({ query: question });
    return route.fulfill({
      json: { hits: [{ title: source.title, url: source.url, excerpt }] },
    });
  });
  await page.goto(`${workspace}/research`);
  const input = page.getByRole('searchbox', { name: 'Ask a question' });
  await input.fill(question);
  await input.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Find source links' }).click();
  await expect(
    page.getByRole('heading', { name: 'Live source links' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: source.title })).toHaveAttribute(
    'href',
    source.url,
  );
  await expect(page.getByText(excerpt)).toBeVisible();
});
