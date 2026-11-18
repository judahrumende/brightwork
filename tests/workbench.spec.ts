import AxeBuilder from '@axe-core/playwright';
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

async function captureWorkspace(page: Page, file: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'test-results/visual/' + file,
    animations: 'disabled',
  });
}

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
  await expect(dock).toBeVisible();
  await captureWorkspace(page, '002-home-waiting-for-you.png');
  await page.getByRole('button', { name: new RegExp(company.name) }).click();
  await expect(
    page.getByRole('heading', { name: 'Your businesses' }),
  ).toBeVisible();
  await captureWorkspace(page, '074-company-switcher.png');
  await page.keyboard.press('Escape');
  await dock.getByRole('button', { name: 'Documents' }).press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'In Run' })
      .getByRole('link', { name: 'Launch brief' }),
  ).toHaveAttribute('href', workbench + '/library?item=' + work.id);
  await captureWorkspace(page, '012-home-dock-documents.png');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  const notifications = page.getByRole('dialog', { name: 'Notifications' });
  await expect(
    notifications.getByRole('link', { name: /Launch brief/ }),
  ).toBeVisible();
  await captureWorkspace(page, '058-notifications-panel.png');
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
  await expect(search.getByRole('textbox')).toBeVisible();
  await captureWorkspace(page, '049-search-palette.png');
  await search.getByRole('textbox').fill('Launch');
  await expect(
    search.getByRole('link', { name: /Launch brief.*Demo Shop/ }),
  ).toHaveAttribute('href', `/f/${work.id}/library?item=${work.id}`);
  await captureWorkspace(page, '050-search-palette-query.png');
});

test('Workspace settings creates an invitation and reads the vault list without values', async ({
  page,
}) => {
  await seedWorkbench(page);
  const base = api + '/settings';
  const invitations: { id: string; email: string; role: string }[] = [];
  await page.route('**' + base + '/team', (route) =>
    route.fulfill({ json: { members: [], invites: invitations } }),
  );
  await page.route('**' + base + '/team/invitations', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'guest@example.test',
      role: 'viewer',
    });
    const invite = {
      id: company.id,
      email: 'guest@example.test',
      role: 'viewer',
    };
    invitations.push(invite);
    return route.fulfill({ status: 201, json: { invite } });
  });
  await page.route('**' + base + '/vault', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        credentials: [{ id: company.id, name: 'Test key' }],
      },
    }),
  );
  await page.goto(workbench + '/settings');
  await page.getByLabel('Invite by email').fill('guest@example.test');
  await page.getByLabel('Invitation role').selectOption('viewer');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByText('guest@example.test · viewer')).toBeVisible();
  await captureWorkspace(page, '060-settings-team.png');
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(page.getByText('Test key', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Reveal credential' }),
  ).toBeVisible();
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
  await expect(page.getByRole('button', { name: run.goal })).toBeVisible();
  await captureWorkspace(page, '076-home-ted-runs-tab.png');
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
  await page.route('**' + api + '/traffic/visits?*', (route) => {
    const range = new URL(route.request().url()).searchParams;
    const days =
      (Date.parse(range.get('to') ?? '') -
        Date.parse(range.get('from') ?? '')) /
      86_400_000;
    return route.fulfill({
      json: {
        visits: days > 1 ? 1 : 0,
        measuredViews: days > 1 ? 1 : 0,
        singlePageVisits: days > 1 ? 1 : 0,
        averageDurationSeconds: 0,
        sources: days > 1 ? [{ label: 'launch.example.test', count: 1 }] : [],
        pages: [{ label: '/', count: 1 }],
      },
    });
  });
  await page.goto(workbench);
  await page.getByRole('button', { name: 'View website traffic' }).click();
  await expect(
    page.getByRole('button', { name: 'Back to Home' }),
  ).toBeFocused();
  await expect(
    page.getByRole('slider', { name: 'Inspect a day' }),
  ).toHaveAttribute('aria-valuetext', /0 page views/u);
  await expect(
    page
      .getByRole('region', { name: 'Traffic sources' })
      .getByRole('rowheader', { name: 'launch.example.test' }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'test-results/visual/084-visitors-overview.png',
  });

  await page
    .getByRole('region', { name: 'Traffic sources' })
    .scrollIntoViewIfNeeded();
  await captureWorkspace(page, '086-visitors-breakdowns.png');
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
  await expect(
    page.getByRole('region', { name: 'Traffic sources' }),
  ).toHaveCount(0);
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
  await page.screenshot({
    path: 'test-results/visual/040-build-import-site.png',
  });
  await page.getByRole('button', { name: 'Import page text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Imported studio' });
  await dialog.getByRole('button', { name: 'Edit website' }).click();
  await dialog.getByText('Visual editing', { exact: true }).click();
  await expect(dialog.getByLabel('Element text')).toBeVisible();
  await page.screenshot({
    path: 'test-results/visual/045-build-site-editor.png',
  });
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
  await page.route(
    '**' + api + '/work/' + artifact + '/review?revision=3',
    (route) =>
      route.fulfill({
        json: {
          change: {
            revision: 3,
            baseRevision: 2,
            baseSource: 'published',
            edits: [{ path: '/', change: 'updated' }],
          },
          before: { document: '<h1>Live website</h1>', pages: [] },
          after: { document: '<h1>Original website</h1>', pages: [] },
        },
      }),
  );
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
  await expect(
    page.getByRole('button', { name: /Live website/u }),
  ).toBeVisible();
  await captureWorkspace(page, '038-build-canvas-live.png');
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
  await editor.getByText('Compare website changes', { exact: true }).click();
  const comparison = editor.getByRole('region', {
    name: 'Website change comparison',
  });
  await expect(comparison.getByLabel('Changed page')).toHaveValue('/');
  await expect(
    comparison
      .frameLocator('iframe[title="Published version preview"]')
      .getByRole('heading', { name: 'Live website' }),
  ).toBeVisible();
  await expect(
    comparison
      .frameLocator('iframe[title="Compared draft preview"]')
      .getByRole('heading', { name: 'Original website' }),
  ).toBeVisible();
  await captureWorkspace(page, '051-approval-website-change.png');
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
  await page.getByRole('radio', { name: 'Day', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Previous day' }),
  ).toBeVisible();
  await captureWorkspace(page, '054-schedule-day.png');
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
  await page.getByRole('button', { name: 'All tasks', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'All tasks', exact: true }),
  ).toBeVisible();
  await captureWorkspace(page, '055-schedule-all-tasks.png');
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

test('Commerce connects a store, shows its order total and disconnects', async ({
  page,
}) => {
  await seedWorkbench(page);
  const endpoint = api + '/settings/shopify';
  const store = {
    id: company.id,
    shop: 'fixture.myshopify.com',
    connected: false,
  };
  await page.route('**' + api + '/settings/team', (route) =>
    route.fulfill({ json: { members: [], invites: [] } }),
  );
  await page.route('**' + endpoint, (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({
        shop: store.shop,
        token: 'fixture-admin-token',
        secret: 'fixture-webhook-secret',
      });
      store.connected = true;
      return route.fulfill({ json: { connected: true } });
    }
    return route.fulfill({
      json: {
        enabled: true,
        shops: [store],
        totals: [
          { shop: store.shop, currency: 'USD', orders: 2, orderValue: '50.00' },
        ],
      },
    });
  });
  const cursor = 'gid://shopify/Order/24';
  await page.route(
    '**' + endpoint + '/' + store.id + '/history/refresh',
    (route) => {
      const body = route.request().postDataJSON();
      expect(body).toEqual(body.after ? { after: cursor } : {});
      return route.fulfill({
        json: body.after
          ? { checked: 2, refreshed: 1, failed: 1, next: null }
          : { checked: 4, refreshed: 3, failed: 0, next: cursor },
      });
    },
  );
  await page.route('**' + endpoint + '/' + store.id, (route) => {
    expect(route.request().method()).toBe('DELETE');
    store.connected = false;
    return route.fulfill({ json: { disconnected: true } });
  });
  await page.goto(workbench + '/settings');
  await page.getByRole('button', { name: 'Commerce', exact: true }).click();
  await page.getByLabel('Store domain').fill(store.shop);
  await page.getByLabel('Admin API token').fill('fixture-admin-token');
  await page
    .getByLabel('Webhook signing secret')
    .fill('fixture-webhook-secret');
  await page.getByRole('button', { name: 'Connect or update store' }).click();
  await expect(page.getByLabel('Admin API token')).toHaveValue('');
  await expect(
    page.getByText('/api/webhooks/shopify/' + store.id, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/Paid order value received.*50\.00.*2 orders/),
  ).toBeVisible();
  const commerce = page.getByRole('region', { name: 'Shopify stores' });
  await commerce.getByRole('button', { name: 'Refresh order history' }).click();
  await expect(commerce.getByRole('status')).toContainText(
    'Checked 4. Refreshed 3.',
  );
  await commerce.getByRole('button', { name: 'Refresh next batch' }).click();
  await expect(commerce.getByRole('status')).toContainText(
    'Provider requests failed for 1.',
  );
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Disconnected', { exact: true })).toBeVisible();
});

test('Inbox distinguishes provider acceptance from delivery', async ({
  page,
}) => {
  await seedWorkbench(page);
  const message = {
    id: '29065fd3-312d-4821-8405-a6a488c2f457',
    title: 'Approved introduction',
    body: 'Hello',
    kind: 'email',
    state: 'approved',
    revision: 1,
    emailState: 'accepted',
    emailRecipient: 'recipient@example.test',
  };
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [message], hosting: false } }),
  );
  await page.route(
    '**' + api + '/work/' + message.id + '/email-history',
    (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: 'event_1',
              status: 'delivered',
              recipient: message.emailRecipient,
              revision: 1,
              occurredAt: '2026-11-18T02:00:02Z',
            },
          ],
        },
      }),
  );
  await page.route('**' + api + '/work/inbound', (route) =>
    route.fulfill({ json: { emails: [] } }),
  );
  await page.goto(workbench + '/inbox?item=' + message.id);
  await expect(page.getByText(/Accepted by the email provider/)).toBeVisible();
  const history = page.getByRole('region', { name: 'Email delivery history' });
  await expect(history).toContainText('Delivered to recipient’s mail server');
  await expect(history).toContainText('Revision 1');
});

test('Inbox links to downloads in the owning workspace', async ({ page }) => {
  await seedWorkbench(page);
  const email = {
    id: '29065fd3-312d-4821-8405-a6a488c2f457',
    sender: 'sender@example.test',
    subject: 'Fixture attachment',
    receivedAt: '2026-11-18T02:00:02Z',
    attachments: [{ id: company.id, filename: 'fixture.txt' }],
  };
  const base = api + '/work/inbound';
  const messagePath = base + '/' + email.id;
  const downloadPath = messagePath + '/attachments/' + company.id;
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**' + base, (route) =>
    route.fulfill({
      json: { address: 'receiver@example.test', emails: [email] },
    }),
  );
  await page.route('**' + messagePath, (route) =>
    route.fulfill({ json: { email, thread: [email] } }),
  );
  await page.goto(workbench + '/inbox');
  await page.getByRole('button', { name: /Fixture attachment/ }).click();
  const link = page.getByRole('link', { name: 'fixture.txt' });
  await expect(link).toHaveAttribute('href', downloadPath);
  await expect(link).toHaveAttribute('download', '');
});

test('Schedule creates a Pip task triggered by a new Inbox message', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**' + api + '/schedule/occurrences?*', (route) =>
    route.fulfill({
      json: {
        occurrences: [],
        days: [],
        calendarEvents: [],
        items: [],
        posts: [],
      },
    }),
  );
  await page.route('**' + api + '/work/tasks', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      title: 'Prepare a receipt checklist',
      body: 'Draft a generic checklist for today.',
      whenEmailArrives: true,
    });
    return route.fulfill({ json: { item: { id: company.id } } });
  });
  await page.goto(workbench + '/schedule');
  await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
  await page.keyboard.press('c');
  const editor = page.getByRole('dialog', { name: 'New task' });
  await editor.getByRole('radio', { name: 'Inbox trigger' }).click();
  await editor
    .getByLabel('Title', { exact: true })
    .fill('Prepare a receipt checklist');
  await editor
    .getByLabel('Instructions for Pip')
    .fill('Draft a generic checklist for today.');
  await editor.getByRole('button', { name: 'Save task' }).click();
  await expect(editor).toHaveCount(0);
});

test('SMS settings and Inbox allow a reviewed reply with delivery status', async ({
  page,
}) => {
  await seedWorkbench(page);
  const base = api + '/settings';
  const settings = base + '/sms';
  const inbox = api + '/work/sms';
  const phone = '+15550100001';
  const contact = '+15550100009';
  const authToken = 'fixture-token-for-connection';
  let connected = false;
  const messages = [
    {
      id: company.id,
      peer: contact,
      body: 'Is my order ready?',
      direction: 'inbound',
      status: 'received',
      createdAt: '2026-11-18T02:00:00Z',
    },
  ];
  await page.route('**' + base + '/team', (route) =>
    route.fulfill({ json: { members: [], invites: [] } }),
  );
  await page.route('**' + settings, (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().token).toBe(authToken);
      connected = true;
      return route.fulfill({ json: { connected: true } });
    }
    return route.fulfill({
      json: {
        enabled: true,
        connection: connected
          ? {
              phone,
              connected,
              webhook:
                'https://brightwork.example.test/api/webhooks/twilio/' +
                company.id,
            }
          : null,
      },
    });
  });
  await page.route('**' + inbox, (route) => {
    if (route.request().method() === 'POST') {
      const draft = route.request().postDataJSON();
      expect(draft).toMatchObject({
        recipient: contact,
        body: 'Yes, it is ready.',
      });
      expect(draft.id).toMatch(/^[0-9a-f-]{36}$/u);
      messages.unshift({
        id: draft.id,
        peer: contact,
        direction: 'outbound',
        body: draft.body,
        status: 'delivered',
        createdAt: '2026-11-18T02:00:05Z',
      });
      return route.fulfill({ json: { status: 'delivered' } });
    }
    return route.fulfill({ json: { enabled: true, connected, messages } });
  });
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**' + api + '/work/inbound', (route) =>
    route.fulfill({ json: { address: null, emails: [] } }),
  );
  await page.goto(workbench + '/settings');
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  await page.getByLabel('Twilio account SID').fill('AC' + '1'.repeat(32));
  await page.getByLabel('Twilio phone number SID').fill('PN' + '2'.repeat(32));
  await page.getByLabel('Twilio auth token').fill(authToken);
  await page.getByRole('button', { name: 'Connect or reconnect SMS' }).click();
  await expect(page.getByText(phone + ' · Connected')).toBeVisible();
  await expect(page.getByLabel('Twilio auth token')).toHaveValue('');
  await page.goto(workbench + '/inbox');
  await page.getByLabel('SMS conversation').selectOption(contact);
  await expect(page.getByText('Is my order ready?')).toBeVisible();
  await page.getByLabel('SMS reply', { exact: true }).fill('Yes, it is ready.');
  await page.getByRole('button', { name: 'Send SMS reply' }).click();
  const thread = page.getByRole('list', { name: 'SMS messages' });
  await expect(thread).toContainText('Yes, it is ready.');
  await expect(thread).toContainText('delivered');
});

test('Stripe Connect creates a shareable sale and waits for payment confirmation', async ({
  page,
}) => {
  await seedWorkbench(page);
  const base = api + '/settings';
  const endpoint = base + '/stripe-connect';
  const saleId = '438d3d94-aaaf-4ad9-8cf3-f687b332a54d';
  let submitted = false;
  let paidAt: string | null = null;
  const sale = () => ({
    id: saleId,
    title: 'Fixture sale',
    currency: 'aud',
    amount: 1999,
    amountRefunded: 0,
    paidAt,
  });
  await page.route('**' + base + '/team', (route) =>
    route.fulfill({ json: { members: [], invites: [] } }),
  );
  await page.route('**' + base + '/shopify', (route) =>
    route.fulfill({ json: { enabled: false, shops: [], totals: [] } }),
  );
  await page.route('**' + endpoint, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        seller: { ready: true, detailsSubmitted: true },
        orders: submitted ? [sale()] : [],
      },
    }),
  );
  await page.route('**' + endpoint + '/sales', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      title: 'Fixture sale',
      amount: 1999,
      currency: 'aud',
    });
    submitted = true;
    return route.fulfill({ json: { path: '/sale/' + saleId } });
  });
  await page.route('**/api/sales/' + saleId, (route) =>
    route.fulfill({ json: sale() }),
  );
  const checkout = 'https://checkout.stripe.com/c/pay/fixture';
  await page.route('**/api/sales/' + saleId + '/checkout', (route) => {
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: { url: checkout } });
  });
  await page.route(checkout, (route) =>
    route.fulfill({ body: 'Stripe checkout fixture' }),
  );
  await page.goto(workbench + '/settings');
  await page.getByRole('button', { name: 'Commerce', exact: true }).click();
  await page.getByLabel('Sale title').fill('Fixture sale');
  await page.getByLabel('Amount', { exact: true }).fill('19.99');
  await page.getByRole('button', { name: 'Create sale link' }).click();
  await page.getByRole('link', { name: 'Open the new sale' }).click();
  await expect(
    page.getByRole('heading', { name: 'Fixture sale' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continue to Stripe Checkout' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Continue to Stripe Checkout' })
    .click();
  await expect(page).toHaveURL(checkout);
  await page.goto('/sale/' + saleId + '?result=returned');
  await expect(
    page.getByRole('button', { name: 'Continue to Stripe Checkout' }),
  ).toBeVisible();
  paidAt = '2026-11-18T02:00:06Z';
  await expect(page.getByText('Payment received')).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole('button', { name: 'Continue to Stripe Checkout' }),
  ).toHaveCount(0);
});

test('Billing shows a personal referral link and conversion totals', async ({
  page,
}) => {
  await seedWorkbench(page);
  const code = '9501a976-910a-4de7-9f14-25c0948e4b25';
  await page.route('**/api/me/billing', (route) =>
    route.fulfill({
      json: { enabled: true, state: 'free', paid: false, testMode: true },
    }),
  );
  await page.route('**/api/me/referrals', (route) =>
    route.fulfill({ json: { code, signups: 3, conversions: 2, reward: '5' } }),
  );
  await page.goto(workbench);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(
    page.getByRole('button', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await captureWorkspace(page, '072-profile-menu.png');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Billing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Billing', exact: true }),
  ).toBeVisible();
  await captureWorkspace(page, '064-settings-plans.png');
  const referrals = page.getByRole('region', { name: 'Referrals' });
  await expect(referrals.getByLabel('Referral link')).toHaveValue(
    new URL('/api/referrals/visit?code=' + code, page.url()).href,
  );
  await expect(
    referrals.getByText('3 sign-ups · 2 paid referrals'),
  ).toBeVisible();
  await expect(referrals.getByText(/Earn 5 credits/)).toBeVisible();
  await referrals.scrollIntoViewIfNeeded();
  await captureWorkspace(page, '059-settings-earn-credits.png');
});

test('Commerce insights shows provider totals, customer counts and the selected range', async ({
  page,
}) => {
  await seedWorkbench(page);
  const requests: string[] = [];
  await page.route('**/insights/commerce?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params.get('from') + '/' + params.get('through'));
    return route.fulfill({
      json: {
        revenue: [
          {
            source: 'shopify',
            currency: 'AUD',
            sales: 3,
            gross: '55',
            refunded: '5',
            net: '50',
          },
        ],
        customers: { identified: 1, repeat: 1, unattributed: 1 },
      },
    });
  });
  await page.goto(workbench);
  const entry = page.getByRole('button', { name: 'View sales and customers' });
  await entry.click();
  const insights = page.getByRole('region', { name: 'Commerce insights' });
  await expect(insights.getByRole('table')).toContainText('Shopify');
  await expect(insights.getByRole('table')).toContainText(/AUD\s*50\.00/);
  await expect(insights.getByText('Repeat customers')).toBeVisible();
  await page.screenshot({
    path: 'test-results/visual/079-home-revenue-12m-insights-sales.png',
  });
  await insights.getByLabel('From').fill('2026-11-17');
  await insights.getByLabel('Through').fill('2026-11-18');
  await insights.getByRole('button', { name: 'Apply dates' }).click();
  await expect.poll(() => requests.at(-1)).toBe('2026-11-17/2026-11-18');
  await insights.getByRole('button', { name: 'Back to overview' }).click();
  await expect(entry).toBeFocused();
});

test('Build quotes each media capability and exposes the completed workspace asset', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [], hosting: false } }),
  );
  const endpoint = api + '/media';
  const rates = { image: '1', video: '4', voice: '2' };
  const jobs: object[] = [];
  await page.route('**' + endpoint, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { rates, jobs } });
    const request = route.request().postDataJSON();
    expect(request).toEqual({
      id: expect.any(String),
      kind: 'voice',
      prompt: 'Welcome to our shop',
      quotedCredits: '2',
    });
    jobs.push({ ...request, credits: '2', state: 'completed' });
    return route.fulfill({ json: { id: request.id } });
  });
  await page.goto(workbench + '/build');
  const media = page.getByRole('region', { name: 'Generated media' });
  await expect(
    media.getByRole('button', { name: 'Generate for 1 credits' }),
  ).toBeVisible();
  await media.getByLabel('Media type').selectOption('video');
  await expect(
    media.getByRole('button', { name: 'Generate for 4 credits' }),
  ).toBeVisible();
  await media.getByLabel('Media type').selectOption('voice');
  await media.getByLabel('Script').fill('Welcome to our shop');
  await media.getByRole('button', { name: 'Generate for 2 credits' }).click();
  await expect(media.getByText('Voice · Ready · 2 credits')).toBeVisible();
  await expect(
    media.getByRole('link', { name: 'Download voice' }),
  ).toHaveAttribute('href', new RegExp(endpoint + '/[0-9a-f-]{36}/asset$'));
});

test('the signed-in workspace fits mobile and the search dialog works with the keyboard', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [], hosting: false } }),
  );
  await page.route('**/api/me/search-work?*', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto(workbench);
  await expect(
    page.getByRole('navigation', { name: 'Workspace applications' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Search your workspaces' });
  const input = search.getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill('missing');
  await expect(search.getByText('No matching results.')).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    audit.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Build' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Chat with Pip' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 760 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test('Build opens saved conversations, links authorized attachments and returns focus', async ({
  page,
}) => {
  await seedWorkbench(page);
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  const endpoint = api + '/ted/chats';
  const savedId = '509cc783-a545-44c7-aab4-fe80894a0b60';
  const file = '93736c3a-8c3a-4cc4-9774-70d4883bb0ab';
  await page.route('**' + endpoint + '?limit=50', (route) =>
    route.fulfill({
      json: {
        conversations: [
          {
            id: savedId,
            title: 'Launch conversation',
            updatedAt: '2026-11-17T04:00:00Z',
          },
        ],
      },
    }),
  );
  await page.route('**' + endpoint + '/' + savedId, (route) =>
    route.fulfill({
      json: {
        turns: [
          {
            id: savedId,
            prompt: 'Prepare the launch',
            text: 'The brief is ready.',
            parts: [],
            status: 'completed',
            revision: 1,
            attachments: [{ id: file, name: 'launch.txt' }],
          },
        ],
      },
    }),
  );
  await page.goto(workbench + '/build');
  const trigger = page.getByRole('button', { name: 'Chat history' });
  await trigger.click();
  const chatList = page.getByRole('dialog', { name: 'Chat history' });
  const entry = chatList.getByRole('button', { name: 'Launch conversation' });
  await expect(entry).toBeVisible();
  await captureWorkspace(page, '043-build-chats-sidebar.png');
  await entry.click();
  const detail = page.getByRole('dialog', { name: 'Launch conversation' });
  await expect(
    detail.getByRole('button', { name: 'Back to conversations' }),
  ).toBeFocused();
  await expect(detail.getByText('The brief is ready.')).toBeVisible();
  await expect(
    detail.getByRole('link', { name: 'launch.txt' }),
  ).toHaveAttribute(
    'href',
    api + '/pip/turns/' + savedId + '/attachments/' + file,
  );
  await captureWorkspace(page, '044-build-chat-history-modal.png');
  await detail
    .getByRole('button', { name: 'Back to conversations' })
    .press('Enter');
  await expect(entry).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('a generated store opens its dashboard below the preview and saves a product', async ({
  page,
}) => {
  await seedWorkbench(page);
  const id = 'e4674721-7544-4ce9-b7cb-9dcbd85b356a';
  const item = {
    id,
    title: 'Fieldwork store',
    kind: 'website',
    isStore: true,
    body: '<h1>Fieldwork store</h1>',
    revision: 1,
    state: 'approved',
    publicUrl: null,
  };
  const products: object[] = [];
  let zones: object[] = [];
  let deliveryRevision = 0;
  let directCheckout = false;
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAC0AAAAASUVORK5CYII=';
  await page.route(
    '**' + api + '/work/' + id + '/store/photos/kettle?revision=1',
    (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(png, 'base64'),
      }),
  );
  const saleId = 'fa9fbe6c-2b5e-40d1-a607-def73dc6f746';
  const order = {
    id: 'order',
    email: 'buyer@example.test',
    currency: 'AUD',
    status: 'confirmed',
    createdAt: '2026-11-18T08:00:00.000Z',
    items: [
      {
        productId: 'kettle',
        productName: 'Pour-over kettle',
        quantity: 1,
        unitPrice: 4500,
      },
      {
        productId: 'filters',
        productName: 'Filters',
        quantity: 2,
        unitPrice: 700,
      },
    ],
    saleId: null as string | null,
    payment: null as string | null,
  };
  await page.route('**' + api + '/work', (route) =>
    route.fulfill({ json: { items: [item], hosting: true } }),
  );
  await page.route(
    new RegExp(api + '/work/' + id + '/store/orders(?:\\?|$)', 'u'),
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      const q = params.get('q');
      const next = { before: order.createdAt, id: order.id };
      if (params.has('before')) {
        expect(params.get('status')).toBe('confirmed');
        expect(params.get('q')).toBe('kettle');
        expect(params.get('before')).toBe(order.createdAt);
        return route.fulfill({
          json: {
            orders: [{ ...order, id: 'older', email: 'older@example.test' }],
            next: null,
          },
        });
      }
      return route.fulfill({
        json: {
          orders: !q || q === 'kettle' ? [order] : [],
          next: q === 'kettle' ? next : null,
        },
      });
    },
  );
  await page.route(
    new RegExp(api + '/work/' + id + '/store/customers(?:\\?|$)', 'u'),
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      const verified = {
        email: 'buyer@example.test',
        joinedAt: '2026-11-18T08:00:00.000Z',
        lastOrderAt: null,
        orderCount: 0,
      };
      return route.fulfill({
        json: {
          customers: params.get('kind') === 'guest' ? [] : [verified],
          next: null,
        },
      });
    },
  );
  await page.route(
    new RegExp(api + '/work/' + id + '/store/report(?:\\?|$)', 'u'),
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      const day = params.get('from');
      return route.fulfill({
        json: {
          currency: 'AUD',
          days: [
            {
              day,
              requests: 4,
              cancelled: 1,
              paidOrders: 2,
              gross: '5900',
              refunds: '500',
            },
          ],
        },
      });
    },
  );
  await page.route('**' + api + '/work/' + id + '/store', (route) => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      if (data.action === 'checkout') {
        expect(data.enabled).toBe(!directCheckout);
        directCheckout = data.enabled;
        return route.fulfill({ json: { saved: true } });
      }
      if (data.action === 'delivery') {
        expect(data).toEqual({
          action: 'delivery',
          revision: 0,
          zones: [
            {
              country: 'AU',
              shipping: 500,
              freeAbove: 10000,
              taxRate: 1000,
              taxShipping: true,
            },
          ],
        });
        zones = data.zones;
        deliveryRevision++;
        return route.fulfill({ json: { saved: true } });
      }
      if (data.action === 'payment') {
        expect(data).toEqual({ action: 'payment', id: order.id });
        order.saleId = saleId;
        order.payment = 'awaiting_payment';
        return route.fulfill({ json: { saved: true } });
      }
      if (data.product.parentId) {
        expect(data.product).toMatchObject({
          parentId: 'kettle',
          name: 'Large',
          price: 6000,
          stock: 4,
          sku: 'LARGE',
        });
        products.push({ ...data.product, id: 'kettle-large', revision: 1 });
        return route.fulfill({ json: { saved: true } });
      }
      expect(data).toEqual({
        action: 'product',
        product: {
          name: 'Pour-over kettle',
          description: '',
          price: 4500,
          stock: 3,
          active: true,
          photo: { data: 'data:image/png;base64,' + png, alt: 'Copper kettle' },
        },
      });
      products.push({
        ...data.product,
        photoAlt: data.product.photo.alt,
        id: 'kettle',
        revision: 1,
      });
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({
      json: {
        currency: 'AUD',
        products,
        orders: [order],
        paymentReady: true,
        directCheckout,
        zones,
        deliveryRevision,
        counts: { openRequests: 0, awaitingFulfillment: 1 },
        customers: [
          {
            email: 'buyer@example.test',
            joinedAt: '2026-11-18T08:00:00.000Z',
            lastOrderAt: null,
            orderCount: 0,
          },
        ],
      },
    });
  });

  await page.goto(workbench + '/build');
  await page.getByRole('button', { name: /Fieldwork store/u }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog
      .frameLocator('iframe[title="Website draft preview"]')
      .getByRole('heading', { name: 'Fieldwork store' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const dashboard = dialog.getByRole('region', { name: 'Store dashboard' });
  await dashboard.getByRole('button', { name: 'Enable test checkout' }).click();
  await expect(
    dashboard.getByText(
      'Shoppers can pay directly from the catalog in test mode.',
    ),
  ).toBeVisible();
  await dashboard
    .getByRole('button', { name: 'Turn off test checkout' })
    .click();
  await expect(
    dashboard.getByRole('button', { name: 'Enable test checkout' }),
  ).toBeEnabled();
  await dashboard.getByRole('radio', { name: 'Products' }).click();
  await dashboard.getByRole('button', { name: 'Add product' }).click();
  await dashboard.getByLabel('Name', { exact: true }).fill('Pour-over kettle');
  await dashboard.getByLabel('Price (AUD)').fill('45');
  await dashboard.getByLabel('Stock').fill('3');
  await dashboard.getByLabel('Product photo').setInputFiles({
    name: 'kettle.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await dashboard.getByLabel('Photo description').fill('Copper kettle');
  await dashboard.getByRole('button', { name: 'Save product' }).click();
  await expect(
    dashboard.getByRole('rowheader', { name: 'Pour-over kettle' }),
  ).toBeVisible();
  const photo = dashboard.getByRole('img', { name: 'Copper kettle' });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  await dashboard
    .getByRole('button', { name: 'Add variant to Pour-over kettle' })
    .click();
  await dashboard.getByLabel('Variant name').fill('Large');
  await dashboard.getByLabel('Price (AUD)').fill('60');
  await dashboard.getByLabel('Stock').fill('4');
  await dashboard.getByLabel('SKU', { exact: true }).fill('LARGE');
  await dashboard.getByRole('button', { name: 'Save product' }).click();
  await expect(
    dashboard.getByRole('rowheader', { name: /Large/u }),
  ).toBeVisible();
  await expect(dashboard.getByText('By variant').first()).toBeVisible();
  await dashboard.getByRole('radio', { name: 'Orders' }).click();
  await expect(
    dashboard.getByRole('rowheader', {
      name: 'Pour-over kettle × 1, Filters × 2',
    }),
  ).toBeVisible();
  await dashboard
    .getByRole('button', { name: 'Create test payment link' })
    .click();
  await expect(
    dashboard.getByRole('link', { name: /Open payment link/u }),
  ).toHaveAttribute('href', '/sale/' + saleId);
  await expect(
    dashboard.getByRole('button', { name: 'Fulfill', exact: true }),
  ).toHaveCount(0);
  await dashboard.getByLabel('Search orders').fill('kettle');
  await dashboard
    .getByRole('combobox', { name: 'Order status' })
    .selectOption('confirmed');
  await dashboard.getByRole('button', { name: 'Search', exact: true }).click();
  await dashboard.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dashboard.getByText('older@example.test')).toBeVisible();
  await expect(dashboard.getByText('Page 2')).toBeVisible();
  await dashboard
    .getByRole('button', { name: 'Previous', exact: true })
    .click();
  await expect(dashboard.getByText('buyer@example.test')).toBeVisible();
  await dashboard.getByRole('radio', { name: 'Customers' }).click();
  const buyer = dashboard.getByRole('row', { name: /buyer@example.test/u });
  await expect(buyer.getByRole('cell', { name: 'Verified' })).toBeVisible();
  await expect(
    buyer.getByRole('cell', { name: '0', exact: true }),
  ).toBeVisible();
  await dashboard
    .getByRole('combobox', { name: 'Account type' })
    .selectOption('guest');
  await dashboard.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    dashboard.getByText('No customers match this search.'),
  ).toBeVisible();
  await dashboard.getByRole('radio', { name: 'Report' }).click();
  await dashboard.getByLabel('From (UTC)').fill('2026-11-01');
  await dashboard.getByLabel('Through (UTC)').fill('2026-11-02');
  await dashboard.getByRole('button', { name: 'Apply dates' }).click();
  await expect(
    dashboard.getByRole('rowheader', { name: '2026-11-01' }),
  ).toBeVisible();
  await expect(dashboard.getByText(/54\.00/u)).toBeVisible();
  await dashboard.getByRole('radio', { name: 'Delivery' }).click();
  await dashboard.getByRole('button', { name: 'Add destination' }).click();
  await dashboard.getByLabel('Two-letter country code').fill('au');
  await dashboard.getByLabel('Flat shipping fee (AUD)').fill('5');
  await dashboard.getByLabel('Free shipping from (AUD, optional)').fill('100');
  await dashboard.getByLabel('Tax rate (%)').fill('10');
  await dashboard.getByLabel('Apply tax to shipping').check();
  await dashboard
    .getByRole('button', { name: 'Save shipping and tax' })
    .click();
  await expect(dashboard.getByRole('group', { name: 'AU' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Site preview' }).click();
  await expect(
    dialog
      .frameLocator('iframe[title="Website draft preview"]')
      .getByRole('heading', { name: 'Fieldwork store' }),
  ).toBeVisible();
});
