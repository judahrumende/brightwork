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
  await page.route('**' + api + '/notifications', (route) =>
    route.fulfill({ json: { items: [], unread: 0, before: null } }),
  );
}

test('Home shows Run work in the dock and keeps read notifications in history', async ({
  page,
}) => {
  await seedWorkbench(page);
  const work = {
    id: 'f0bf9474-bd27-4a59-ac98-993edae6006a',
    kind: 'document',
    title: 'Launch brief',
    state: 'pending',
    revision: 1,
    answered: false,
    inRun: true,
  };
  const notice = {
    id: 1,
    artifactId: work.id,
    kind: work.kind,
    title: work.title,
    createdAt: '2026-11-17T04:00:00.000Z',
    resolvedAt: null,
  };
  let readAt: string | null = null;
  await page.route('**' + api + '/work/summary', (route) =>
    route.fulfill({ json: { items: [work] } }),
  );
  await page.route('**' + api + '/notifications', (route) =>
    route.fulfill({
      json: {
        items: [{ ...notice, readAt }],
        unread: readAt ? 0 : 1,
        before: null,
      },
    }),
  );
  await page.route('**' + api + '/run/read', (route) => {
    expect(route.request().postDataJSON()).toEqual({ all: true });
    readAt = notice.createdAt;
    return route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/me/search-work?*', (route) =>
    route.fulfill({
      json: {
        items: [{ ...work, businessId: work.id, businessName: 'Demo Shop' }],
      },
    }),
  );
  await page.goto(workbench);

  const dock = page.getByRole('navigation', { name: 'Workspace applications' });
  await dock.getByRole('button', { name: 'Documents' }).press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'In Run' })
      .getByRole('link', { name: 'Launch brief' }),
  ).toHaveAttribute('href', workbench + '/library?item=' + work.id);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  const notifications = page.getByRole('dialog', { name: 'Notifications' });
  await notifications.getByRole('button', { name: 'Mark all read' }).click();
  await expect(
    notifications.getByRole('link', { name: /Launch brief.*Read/ }),
  ).toBeVisible();
  await notifications.getByRole('radio', { name: 'Unread' }).click();
  await expect(
    notifications.getByText('No unread notifications on this page'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Search your workspaces' });
  await search.getByRole('textbox').fill('Launch');
  await expect(
    search.getByRole('link', { name: /Launch brief.*Demo Shop/ }),
  ).toHaveAttribute('href', `/f/${work.id}/library?item=${work.id}`);
});

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
  await page.route('**' + api + '/pip/runs/' + run.id + '/history', (route) =>
    route.fulfill({
      json: {
        before: null,
        events: [
          {
            id: 1,
            kind: 'waiting',
            detail: 'approval',
            createdAt: run.createdAt,
          },
        ],
      },
    }),
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
  await summary.getByText('Run history', { exact: true }).click();
  await expect(
    summary.getByText('Waiting for owner · approval', { exact: false }),
  ).toBeVisible();
  await summary.getByRole('link', { name: 'Open Run controls' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
});

test('Build loads earlier chat, dictates into the composer and sends text attachments', async ({
  page,
}) => {
  await seedWorkbench(page);
  const previous = {
    id: 'f0bf9474-bd27-4a59-ac98-993edae6006a',
    prompt: 'Earlier draft',
    text: 'Saved.',
    parts: [],
    status: 'completed',
    revision: 2,
  };
  const cutoff = '509cc783-a545-44c7-aab4-fe80894a0b60';
  const attachmentId = '93736c3a-8c3a-4cc4-9774-70d4883bb0ab';
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**' + api + '/pip/turns?before=' + cutoff, (route) =>
    route.fulfill({ json: { turns: [previous], before: null } }),
  );
  await page.route('**' + api + '/pip/turns', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { enabled: true, turns: [], before: cutoff },
      });
    expect(route.request().postDataJSON()).toEqual({
      prompt: 'Read my brief',
      attachments: [{ name: 'brief.txt', content: 'Synthetic brief' }],
    });
    return route.fulfill({
      status: 202,
      json: {
        ...previous,
        id: cutoff,
        prompt: 'Read my brief',
        attachments: [{ id: attachmentId, name: 'brief.txt' }],
      },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: class {
        onresult?: (event: { results: { transcript: string }[][] }) => void;
        onend?: () => void;
        start() {
          setTimeout(() => {
            this.onresult?.({ results: [[{ transcript: 'Read my brief' }]] });
            this.onend?.();
          }, 10);
        }
        stop() {
          this.onend?.();
        }
        abort() {}
      },
    });
  });
  await page.goto(workbench + '/build');
  const chat = page.getByRole('region', { name: 'Chat with Pip' });
  await chat.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(chat.getByText('Earlier draft', { exact: true })).toBeVisible();
  await chat.getByRole('button', { name: 'Dictate' }).click();
  await expect(chat.getByRole('textbox', { name: 'Message Pip' })).toHaveValue(
    'Read my brief',
  );
  await chat.getByLabel('Attach text files').setInputFiles({
    name: 'brief.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic brief'),
  });
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByRole('link', { name: 'brief.txt' })).toHaveAttribute(
    'href',
    api + '/pip/turns/' + cutoff + '/attachments/' + attachmentId,
  );
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

test('Build imports a draft, edits text and images, and restores a deployment', async ({
  page,
}) => {
  await seedWorkbench(page);
  const id = 'f0bf9474-bd27-4a59-ac98-993edae6006a';
  const older = '509cc783-a545-44c7-aab4-fe80894a0b60';
  const live = '93736c3a-8c3a-4cc4-9774-70d4883bb0ab';
  const work = api + '/work/' + id;
  const site = {
    id,
    title: 'Imported studio',
    kind: 'website',
    state: 'pending',
    revision: 2,
    body: '<!doctype html><html><head><title>Studio</title></head><body class="studio"><h1>Old heading</h1></body></html>',
    pages: [],
  };
  let imported = false;
  let rolledBack = false;
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: imported ? [site] : [], hosting: true } }),
  );
  await page.route('**' + api + '/work/websites/import', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      url: 'https://example.test/',
    });
    imported = true;
    return route.fulfill({ status: 201, json: { item: { id } } });
  });
  await page.route('**' + work + '/website', (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.revision).toBe(2);
    expect(payload.body).toContain(
      '<head><title>Studio</title></head><body class="studio"><h1>Refined heading</h1>',
    );
    expect(payload.body).toContain('data:image/png;base64,');
    site.body = payload.body;
    site.revision = 3;
    return route.fulfill({ json: { item: site } });
  });
  const stamp = '2026-11-17T04:00:00.000Z';
  await page.route('**' + work + '/deployments', (route) =>
    route.fulfill({
      json: {
        deployments: [
          {
            id: live,
            revision: 2,
            publishedAt: stamp,
            unpublishedAt: rolledBack ? stamp : null,
            rollbackSourceId: null,
          },
          {
            id: older,
            revision: 1,
            publishedAt: stamp,
            unpublishedAt: stamp,
            rollbackSourceId: null,
          },
          ...(rolledBack
            ? [
                {
                  id: '8079c807-b360-44f3-8664-76c65c55ecab',
                  revision: 1,
                  publishedAt: stamp,
                  unpublishedAt: null,
                  rollbackSourceId: older,
                },
              ]
            : []),
        ],
      },
    }),
  );
  await page.route(
    '**' + work + '/deployments/' + older + '/rollback',
    (route) => {
      expect(route.request().postDataJSON()).toEqual({ expectedLive: live });
      rolledBack = true;
      return route.fulfill({ json: {} });
    },
  );
  await page.goto(workbench + '/build');
  await page.getByText('Import website', { exact: true }).click();
  await page.getByLabel('Website URL').fill('https://example.test/');
  await page.getByRole('button', { name: 'Import page text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Imported studio' });
  await dialog.getByRole('button', { name: 'Edit website' }).click();
  await dialog.getByText('Visual editing', { exact: true }).click();
  await dialog.getByLabel('Element text').fill('Refined heading');
  await dialog.getByLabel('Image description').fill('Studio logo');
  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAC0AAAAASUVORK5CYII=';
  await dialog.getByLabel('Image file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pixel, 'base64'),
  });
  await expect(
    dialog.getByRole('textbox', { name: 'HTML', exact: true }),
  ).toHaveValue(/data:image\/png;base64/u);
  await dialog.getByRole('button', { name: 'Save for review' }).click();
  await dialog.getByText('Site tools', { exact: true }).click();
  const history = dialog.getByRole('region', { name: 'Deployment history' });
  await history
    .getByRole('button', { name: 'Restore revision 1 live' })
    .click();
  await history
    .getByRole('button', { name: 'Restore live deployment' })
    .click();
  await expect(
    history.getByText('Revision 1 · Live · Rolled back'),
  ).toBeVisible();
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
