import { expect, test } from '@playwright/test';

const disabledOptions = {
  humanCheck: { provider: 'turnstile', siteKey: '' },
  signals: { provider: 'workos_radar', clientId: '' },
  providers: { google: false, apple: false },
};

for (const mode of ['sign-in', 'sign-up'] as const) {
  test(`capture the ${mode} page at the reference viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/auth/email/code', (route) =>
      route.fulfill({ json: disabledOptions }),
    );
    await page.route('**/api/auth/google/one-tap', (route) =>
      route.fulfill({ json: { clientId: '' } }),
    );
    await page.goto('/' + mode);
    await expect(
      page.getByRole('heading', {
        name: mode === 'sign-in' ? 'Log in' : 'Start free',
      }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `test-results/visual/auth-${mode}.png` });
  });
}

test('sign-in submits an email challenge and code, then opens the requested page', async ({
  page,
}) => {
  const attempt = 'ccb49979-7e87-41e3-887f-1a001e37ec12';
  await page.route('**/api/auth/google/one-tap', (route) =>
    route.fulfill({ json: { clientId: '' } }),
  );
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.turnstile={render(_,options){options.callback('browser-fixture');return 'fixture-widget'},reset(){},remove(){}};`,
      }),
  );
  await page.route('**/api/auth/email/code', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          ...disabledOptions,
          humanCheck: { provider: 'turnstile', siteKey: 'fixture' },
        },
      });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({
      email: 'owner@example.test',
      humanCheck: 'browser-fixture',
    });
    expect(route.request().headers()['x-session-id']).toMatch(
      /^[a-f0-9-]{36}$/u,
    );
    await route.fulfill({ json: { sent: true, attempt, link: true } });
  });
  await page.route('**/api/auth/email/verify', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'owner@example.test',
      attempt,
      code: '014725',
    });
    return route.fulfill({ json: { signedIn: true } });
  });
  const widget = page.waitForResponse((response) =>
    response.url().includes('challenges.cloudflare.com/turnstile/'),
  );
  await page.goto('/sign-in?returnTo=%2Fdev%2Fui');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await widget;
  await page.waitForFunction(() => Boolean(window.turnstile));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  await page.getByLabel('Sign-in code').fill('014725');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page).toHaveURL('/dev/ui');
});
