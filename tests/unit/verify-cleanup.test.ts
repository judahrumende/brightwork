import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const cleanupScript = join(
  repositoryRoot,
  '.cursor/skills/verify-brightwork/scripts/cleanup.sh',
);

function isRunning(pid: number) {
  const status = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  return status.status === 0 && !status.stdout.trim().startsWith('Z');
}

async function waitFor(check: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return check();
}

test('cleanup stops detached supervisors and their children', async () => {
  const verifyRoot = await mkdtemp(join(tmpdir(), 'brightwork-verify-'));
  const childPidPath = join(verifyRoot, 'child.pid');
  const leader = spawn(
    'bash',
    ['-c', 'sleep 30 & echo "$!" > "$CHILD_PID_PATH"; wait'],
    {
      detached: true,
      env: { ...process.env, CHILD_PID_PATH: childPidPath },
      stdio: 'ignore',
    },
  );

  try {
    assert.ok(leader.pid);
    assert.ok(
      await waitFor(() => {
        try {
          return Number(readFileSync(childPidPath));
        } catch {
          return false;
        }
      }, 2_000),
      'supervisor did not start its child',
    );
    const childPid = Number(await readFile(childPidPath, 'utf8'));
    await writeFile(join(verifyRoot, 'api.pid'), String(leader.pid));

    const cleanup = spawnSync('bash', [cleanupScript], {
      encoding: 'utf8',
      env: { ...process.env, VERIFY_ROOT: verifyRoot, VERIFY_DB: '' },
    });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.equal(
      await waitFor(() => !isRunning(childPid), 1_000),
      true,
      'cleanup left the supervised child running',
    );
  } finally {
    try {
      process.kill(-leader.pid!, 'SIGKILL');
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? error.code : undefined;
      assert.ok(code === 'ESRCH' || code === 'EPERM');
    }
    await rm(verifyRoot, { recursive: true, force: true });
  }
});
