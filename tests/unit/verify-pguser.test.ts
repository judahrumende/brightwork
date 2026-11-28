import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const selectorScript = resolve(
  repositoryRoot,
  '.cursor/skills/verify-brightwork/scripts/verify-pguser.sh',
);

function selectPguser(env: NodeJS.ProcessEnv) {
  const result = spawnSync(
    'bash',
    ['-c', 'source "$1"; verify_pguser', 'bash', selectorScript],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('verify_pguser prefers the explicit VERIFY_PGUSER', () => {
  assert.equal(selectPguser({ VERIFY_PGUSER: 'fixture-user' }), 'fixture-user');
});

test('verify_pguser falls back to the operating-system username', () => {
  const osUsername = spawnSync('whoami', { encoding: 'utf8' });
  assert.equal(osUsername.status, 0, osUsername.stderr);
  assert.equal(
    selectPguser({ VERIFY_PGUSER: undefined }),
    osUsername.stdout.trim(),
  );
});
