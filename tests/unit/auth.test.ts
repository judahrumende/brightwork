import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserCookie,
  cookie,
  digest,
  randomCode,
  randomToken,
  safeReturnTo,
  sameToken,
} from '../../apps/api/src/auth/tokens.ts';

test('auth redirects stay on the application origin after URL normalization', () => {
  const origin = 'https://brightwork.test';
  for (const href of [
    'https://outside.test',
    '//outside.test',
    '/\\outside.test',
    '/ok/..//outside.test',
    '/ok/%2e%2e//outside.test',
  ]) {
    assert.equal(safeReturnTo(href, origin), '/home');
  }
  assert.equal(
    safeReturnTo('/f/example?tab=build#files', origin),
    '/f/example?tab=build#files',
  );
});

test('session cookies are secure and duplicate credentials are rejected', () => {
  const token = randomToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(randomCode(), /^\d{6}$/u);
  assert.equal(
    browserCookie(
      'theme=dark; __Host-bw-session=' + token,
      '__Host-bw-session',
    ),
    token,
  );
  assert.equal(
    browserCookie('bw-session=first; bw-session=second', 'bw-session'),
    undefined,
  );
  assert.match(
    cookie('__Host-bw-session', token, true, 600),
    /Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/u,
  );
  assert.equal(sameToken(token, token), true);
  assert.notEqual(
    digest('a credential used only here', 'code', token),
    digest('a credential used only here', 'link', token),
  );
});
