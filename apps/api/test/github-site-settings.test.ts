import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { vaultStore } from '../src/workspace/vault';
import { githubSiteSettings } from '../src/workspace/github-site-settings';

function fixtureVault() {
  const values = new Map<string, string>();
  const ids = new Map<string, string>();
  return {
    values,
    vault: {
      async revealByName(workspace: string, name: string) {
        return values.get(workspace + ':' + name) ?? null;
      },
      async save(workspace: string, name: string, value: string) {
        values.set(workspace + ':' + name, value);
      },
      async list(workspace: string) {
        return [...values.keys()]
          .filter((key) => key.startsWith(workspace + ':'))
          .map((key) => {
            const name = key.slice(workspace.length + 1);
            const id = name + '-id';
            ids.set(id, key);
            return { id, name, updatedAt: new Date() };
          });
      },
      async remove(_workspace: string, id: string) {
        const key = ids.get(id);
        return key ? values.delete(key) : false;
      },
    } as unknown as ReturnType<typeof vaultStore>,
  };
}

test('GitHub workspace settings validate write access and keep tokens out of reads', async () => {
  const { vault, values } = fixtureVault();
  const requests: { url: string; token: string }[] = [];
  const service = githubSiteSettings(vault, (async (input, init) => {
    requests.push({
      url: String(input),
      token: new Headers(init?.headers).get('Authorization') ?? '',
    });
    return requests.length === 1
      ? Response.json({ permissions: { push: true } })
      : Response.json({ object: { sha: 'a'.repeat(40) } });
  }) as typeof fetch);

  assert.deepEqual(await service.get('workspace-a'), {
    available: true,
    configured: false,
    repo: '',
    branch: 'main',
  });
  assert.equal(
    await service.connect('workspace-a', {
      token: 'fine-grained-token',
      repo: 'owner/private-repo',
      branch: 'releases/stable',
    }),
    true,
  );
  assert.deepEqual(requests, [
    {
      url: 'https://api.github.com/repos/owner/private-repo',
      token: 'Bearer fine-grained-token',
    },
    {
      url: 'https://api.github.com/repos/owner/private-repo/git/ref/heads/releases/stable',
      token: 'Bearer fine-grained-token',
    },
  ]);
  assert.deepEqual(await service.get('workspace-a'), {
    available: true,
    configured: true,
    repo: 'owner/private-repo',
    branch: 'releases/stable',
  });
  assert.equal(
    JSON.stringify(await service.get('workspace-a')).includes('token'),
    false,
  );
  assert.equal(
    await service.get('workspace-b').then((result) => result.configured),
    false,
  );
  assert.equal(
    values.get('workspace-a:foundable.github.token'),
    'fine-grained-token',
  );
  assert.equal(
    (await service.resolve('workspace-a'))?.repo,
    'owner/private-repo',
  );
  await service.disconnect('workspace-a');
  assert.equal((await service.get('workspace-a')).configured, false);
});

test('GitHub workspace settings reject repositories without verified push permission', async () => {
  const { vault, values } = fixtureVault();
  const service = githubSiteSettings(vault, (async () =>
    Response.json({ permissions: { push: false } })) as typeof fetch);
  assert.equal(
    await service.connect('workspace-a', {
      token: 'read-only-token',
      repo: 'owner/repo',
      branch: 'main',
    }),
    false,
  );
  assert.equal(values.size, 0);
});
