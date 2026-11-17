import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const company = {
  id: 'ccb49979-7e87-41e3-887f-1a001e37ec12',
  role: 'owner',
  name: 'Nummi Demo',
};
const workbench = '/f/' + company.id;
const api = '/api/companies/' + company.id;
const session = {
  companyList: { companies: [company], lastOpened: company.id },
  profile: {
    name: 'Demo Owner',
    timezone: 'UTC',
    language: null,
    browserLanguage: 'en-US',
    browserTimezone: 'UTC',
    appearance: 'light',
    background: 'clouds',
    reduceEffects: true,
    showPredictions: true,
  },
  session: { email: 'owner@example.test', name: 'Demo Owner' },
  creditBalance: { available: '10.0000000000' },
};

async function seedWorkbench(page: Page) {
  await page.setViewportSize({ width: 1920, height: 772 });
  await page.route('**/api/me/session', (route) =>
    route.fulfill({ json: session }),
  );
  for (const path of ['/api/me/presence', api + '/opened']) {
    await page.route('**' + path, (route) => route.fulfill({ json: {} }));
  }
  await page.route('**' + api + '/pip/turns', (route) =>
    route.fulfill({ json: { enabled: true, turns: [] } }),
  );
  await page.route('**' + api + '/pip/runs', (route) =>
    route.fulfill({ json: { enabled: true, canPublish: false, runs: [] } }),
  );
  await page.route('**' + api + '/work/summary', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

test('Home opens a Run summary and Run controls can pause it', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.route('**' + api + '/traffic', (route) =>
    route.fulfill({ json: { daily: [] } }),
  );
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [], hosting: true } }),
  );
  const run = {
    id: 'f0bf9474-bd27-4a59-ac98-993edae6006a',
    goal: 'Publish a homepage',
    state: 'active',
    waitingFor: 'approval',
    creditLimit: '2.0000000000',
    creditsUsed: '0.3100000000',
    failure: null,
    createdAt: '2026-11-16T08:00:00.000Z',
    endedAt: null,
    publications: [],
    steps: [
      {
        position: 1,
        instruction: 'Build a draft',
        attempt: 1,
        turnId: null,
        finishedAt: null,
        status: 'completed',
        answer: 'I saved the homepage draft.',
      },
    ],
  };
  await page.route('**' + api + '/pip/runs', (route) =>
    route.fulfill({ json: { enabled: true, canPublish: true, runs: [run] } }),
  );
  await page.route('**' + api + '/pip/runs/' + run.id + '/control', (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: 'pause' });
    run.state = 'paused';
    return route.fulfill({ json: { run } });
  });
  await page.goto(workbench);
  await page.getByRole('radio', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: run.goal }).click();
  const summary = page.getByRole('dialog', { name: 'Run summary' });
  await expect(
    summary.getByText('0 of 1 steps finished · 0.31 / 2 credits'),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'test-results/visual/077-run-summary-window.png',
  });
  await summary.getByRole('link', { name: 'Open Run controls' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
});

test('Visitors shows an empty period and lets keyboard users change the range', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.route('**' + api + '/traffic', (route) =>
    route.fulfill({ json: { daily: [] } }),
  );
  await page.goto(workbench);
  await page.getByRole('button', { name: 'View website traffic' }).click();
  await expect(
    page.getByRole('button', { name: 'Back to Home' }),
  ).toBeFocused();
  await expect(
    page.getByRole('slider', { name: 'Inspect a day' }),
  ).toHaveAttribute('aria-valuetext', /0 page views/u);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'test-results/visual/084-visitors-overview.png',
  });

  await page.getByRole('button', { name: 'Last 7 days' }).press('Enter');
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Last 7 days' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({
    path: 'test-results/visual/085-visitors-range-menu.png',
  });
  await page
    .getByRole('menuitemcheckbox', { name: 'Yesterday' })
    .press('Enter');
  await expect(page.getByRole('button', { name: 'Yesterday' })).toBeFocused();
  await expect(page.getByRole('slider', { name: 'Inspect a day' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(
    page.getByRole('button', { name: 'View website traffic' }),
  ).toBeFocused();
});

test('restoring a saved version creates a pending draft and keeps the live snapshot', async ({
  page,
}) => {
  await seedWorkbench(page);
  const artifact = 'e4674721-7544-4ce9-b7cb-9dcbd85b356a';
  const original = {
    id: 'fa9fbe6c-2b5e-40d1-a607-def73dc6f746',
    title: 'Original website',
    revision: 1,
    savedAt: '2026-11-16T08:00:00.000Z',
    bookmarked: false,
    document: '<h1>Original website</h1>',
  };
  let item = {
    id: artifact,
    title: 'Live website',
    kind: 'website',
    body: '<h1>Live website</h1>',
    revision: 2,
    liveDraftRevision: 2,
    state: 'approved',
    publicUrl: 'https://demo.example.test/',
  };
  const versions = api + '/work/' + artifact + '/versions';
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [item], hosting: true } }),
  );
  await page.route('**' + versions, (route) =>
    route.fulfill({ json: { versions: [original] } }),
  );
  await page.route('**' + versions + '/' + original.id, (route) =>
    route.fulfill({ json: { version: original } }),
  );
  await page.route(
    '**' + versions + '/' + original.id + '/restore',
    (route) => {
      expect(route.request().postDataJSON()).toEqual({ revision: 2 });
      item = {
        ...item,
        title: original.title,
        body: original.document,
        revision: 3,
        state: 'pending',
      };
      return route.fulfill({ json: { item } });
    },
  );

  await page.goto(workbench + '/build');
  await page.getByRole('button', { name: /Live website/u }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('button', { name: 'Recent versions' }).click();
  await editor.getByRole('button', { name: /Original website/u }).click();
  await expect(
    page
      .frameLocator('iframe[title="Website version 1 preview"]')
      .getByRole('heading', { name: 'Original website' }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Restore as new draft' }).click();
  await expect(editor).toHaveAccessibleName('Original website');
  await expect(
    editor.getByRole('button', { name: 'Approve draft' }),
  ).toBeVisible();
  await expect(
    editor.getByRole('link', { name: 'View live site' }),
  ).toHaveAttribute('href', 'https://demo.example.test/');
});

test('Schedule switches calendar views and opens the task editor from the keyboard', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [], hosting: false } }),
  );
  await page.route('**' + api + '/schedule/occurrences?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(Date.parse(params.get('to')!)).toBeGreaterThan(
      Date.parse(params.get('from')!),
    );
    return route.fulfill({
      json: {
        occurrences: [],
        days: [],
        calendarEvents: [],
        items: [],
        posts: [],
        clock: true,
        truncated: false,
      },
    });
  });
  await page.goto(workbench + '/schedule');
  await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/visual/052-schedule-month.png' });
  await page.getByRole('radio', { name: 'Week', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Previous week' }),
  ).toBeVisible();
  await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/visual/053-schedule-week.png' });
  await expect(page.getByLabel('Time grid')).toBeVisible();
  await page.getByRole('radio', { name: 'Year', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Previous year' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'February', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'Month', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('heading', { name: /^February \d{4}$/u }),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'Week', exact: true }).click();
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/visual/056-schedule-new-task.png',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New task' })).toHaveCount(0);
});

test('Schedule saves an event after correcting its end time and opens its details', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.clock.setFixedTime(new Date('2026-11-17T08:00:00Z'));
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [], hosting: false } }),
  );
  const event = {
    id: 'f1571898-aa32-4944-818d-9efbe77e97fc',
    title: 'Planning session',
    startsAt: '2026-11-17T09:00:00.000Z',
    endsAt: '2026-11-17T10:00:00.000Z',
    timezone: 'UTC',
    location: 'https://meet.example.test/studio',
    attendees: 'Casey',
    notes: 'Bring an outline.',
  };
  let saved = false;
  await page.route('**' + api + '/schedule/occurrences?*', (route) =>
    route.fulfill({
      json: {
        occurrences: [],
        calendarEvents: saved ? [event] : [],
        truncated: false,
      },
    }),
  );
  await page.route('**' + api + '/schedule/events', (route) => {
    const input = route.request().postDataJSON();
    expect(input).toEqual({
      title: event.title,
      location: event.location,
      timezone: event.timezone,
      start: '2026-11-17T09:00',
      end: input.end,
      attendees: event.attendees,
      notes: event.notes,
    });
    if (input.end === '2026-11-17T08:00')
      return route.fulfill({
        status: 400,
        json: { message: 'Choose an end after the start.' },
      });
    expect(input.end).toBe('2026-11-17T10:00');
    saved = true;
    return route.fulfill({ status: 201, json: { event } });
  });
  await page.goto(workbench + '/schedule');
  await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('radio', { name: 'Event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New event' });
  await expect(editor).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'test-results/visual/057-schedule-new-event.png',
  });
  await editor.getByLabel('Title').fill(event.title);
  await editor.getByLabel('Location or video link').fill(event.location);
  await editor.getByLabel('Starts').fill('2026-11-17T09:00');
  await editor.getByLabel('Ends').fill('2026-11-17T08:00');
  await editor.getByLabel('With').fill(event.attendees);
  await editor.getByLabel('Notes').fill(event.notes);
  await editor.getByRole('button', { name: 'Save event' }).click();
  await expect(editor.getByRole('alert')).toContainText('Choose an end');
  await expect(editor.getByLabel('Title')).toHaveValue(event.title);
  await editor.getByLabel('Ends').fill('2026-11-17T10:00');
  await editor.getByRole('button', { name: 'Save event' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Show calendar' }).click();
  const entry = page.getByRole('button', { name: /Planning session/u });
  await entry.click();
  const details = page.getByRole('dialog', { name: event.title });
  await expect(
    details.getByRole('link', { name: event.location }),
  ).toHaveAttribute('href', event.location);
  await expect(details.getByText(event.notes)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(entry).toBeFocused();
});
