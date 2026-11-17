import { expect, test } from '@playwright/test';

const company = {
  id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
  role: 'owner',
  name: 'Demo',
};
const workspace = `/f/${company.id}`;
const base = `/api/companies/${company.id}`;
const draft = {
  id: '605633c6-186f-44e4-a373-01d0796e7ada',
  title: 'Launch post',
  body: 'A new season starts today.',
  state: 'pending',
  revision: 1,
  publication: null as string | null,
  remoteId: null as string | null,
  pageId: '50',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me/session'))
      return route.fulfill({
        json: {
          userId: 'growth-fixture',
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
    if (path === `${base}/growth`)
      return route.fulfill({
        json: {
          leads: true,
          social: true,
          pageId: '50',
          ads: true,
          google: false,
        },
      });
    return route.fulfill({
      json: { items: [], daily: [], turns: [], runs: [] },
    });
  });
});

test('an approved social draft can be published to the reviewed Page', async ({
  page,
}) => {
  const post = { ...draft };
  await page.route('**/growth/posts', (route) =>
    route.fulfill({ json: { posts: [post] } }),
  );
  await page.route('**/work/*/decision', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      revision: 1,
      approve: true,
    });
    post.state = 'approved';
    post.revision = 2;
    return route.fulfill({ json: { item: post } });
  });
  await page.route('**/growth/posts/*/publish', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      revision: 2,
      pageId: '50',
    });
    post.publication = 'published';
    post.remoteId = '50_2';
    return route.fulfill({ json: { remoteId: post.remoteId } });
  });
  await page.goto(workspace);
  await page.getByRole('link', { name: 'Social', exact: true }).click();
  await expect(page.getByRole('heading', { name: draft.title })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Publish to Facebook' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve draft' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Publish to Facebook' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open Facebook post' }),
  ).toHaveAttribute('href', 'https://www.facebook.com/50_2');
});

test('mobile Ads displays reported spend, saves a target and pauses a campaign', async ({
  page,
}) => {
  let monthlyTarget: string | null = null;
  let status = 'ACTIVE';
  await page.setViewportSize({ width: 390, height: 780 });
  await page.route('**/growth/ads', (route) =>
    route.fulfill({
      json: {
        accountId: '50',
        currency: 'AUD',
        spend: '12.50',
        after: null,
        monthlyTarget,
        campaigns: [
          { id: '2', name: 'Winter launch', status, effective_status: status },
        ],
      },
    }),
  );
  await page.route('**/growth/wallet', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      accountId: '50',
      currency: 'AUD',
      monthlyTarget: '100.50',
    });
    monthlyTarget = '100.50';
    return route.fulfill({ json: { monthlyTarget } });
  });
  await page.route('**/growth/ads/2/status', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      accountId: '50',
      status: 'PAUSED',
    });
    status = 'PAUSED';
    return route.fulfill({ json: { status } });
  });
  await page.goto(`${workspace}/growth?tool=ads`);
  await expect(page.getByText('12.50 AUD')).toBeVisible();
  await page.getByLabel('Monthly target (AUD)').fill('100.50');
  await page.getByRole('button', { name: 'Save target' }).click();
  await expect(
    page.getByRole('button', { name: 'Save target' }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Monthly target (AUD)')).toHaveValue('100.50');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Pause campaign' }).click();
  await expect(page.getByText('PAUSED · Delivery: PAUSED')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resume campaign' }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      'Activation is disabled until budget enforcement is verified.',
    ),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});

test('browse and lead research show public evidence and save a selected website', async ({
  page,
}) => {
  const hit = {
    title: 'Example Roaster',
    url: 'https://example.com/',
    excerpt: 'Freshly roasted coffee.',
  };
  let saved = false;
  await page.route('**/growth/browse', (route) => {
    expect(route.request().postDataJSON()).toEqual({ url: hit.url });
    return route.fulfill({ json: { ...hit, paragraphs: [hit.excerpt] } });
  });
  await page.route('**/growth/sources', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      query: 'Perth coffee roasters',
    });
    return route.fulfill({ json: { hits: [hit] } });
  });
  await page.route('**/growth/leads', (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({
        url: hit.url,
        title: hit.title,
      });
      saved = true;
    }
    return route.fulfill({
      json: {
        leads: saved
          ? [{ id: 'lead-one', title: `Lead: ${hit.title}`, body: hit.url }]
          : [],
      },
    });
  });
  await page.goto(`${workspace}/growth?tool=browser`);
  await page.getByLabel('Public website URL').fill(hit.url);
  await page.getByRole('button', { name: 'Read page' }).click();
  await expect(page.getByText(hit.excerpt)).toBeVisible();
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page
    .getByLabel('Find public business websites')
    .fill('Perth coffee roasters');
  await page.getByRole('button', { name: 'Find leads' }).click();
  await expect(page.getByText(hit.excerpt)).toBeVisible();
  await page.getByRole('button', { name: 'Save lead' }).click();
  await expect(
    page.getByRole('button', { name: 'Saved', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('link', { name: hit.title })).toHaveAttribute(
    'href',
    hit.url,
  );
});
