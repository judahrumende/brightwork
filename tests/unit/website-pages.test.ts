import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  websiteDocument,
  websitePageSlug,
  websitePages,
} from '../../packages/shared/src/website-pages.ts';

const page = {
  slug: 'about-us',
  title: 'About',
  html: '<h1>About our business</h1>',
};

test('serves the homepage and looks up an additional page by its exact slug', () => {
  assert.equal(websiteDocument('<h1>Home</h1>', [page], ''), '<h1>Home</h1>');
  assert.equal(websiteDocument('<h1>Home</h1>', [page], 'about-us'), page.html);
  assert.equal(websiteDocument('<h1>Home</h1>', [page], 'unlisted'), null);
});

test('rejects duplicate paths, reserved endpoints, and path traversal', () => {
  assert.equal(
    websitePages.safeParse([page, { ...page, title: 'Another' }]).success,
    false,
  );
  assert.equal(websitePages.safeParse([page]).success, true);
  for (const slug of [
    'api',
    'health',
    'auth',
    '../about',
    '%2Fabout',
    'foo/bar',
    '',
  ]) {
    assert.equal(websitePageSlug.safeParse(slug).success, false);
  }
});
