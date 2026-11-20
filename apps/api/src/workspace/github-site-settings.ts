import { z } from 'zod';
import type { vaultStore } from './vault';
import { githubSiteSync } from './github-site-sync';

const repoSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]{1,100}$/u);
const branchSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/u);
const tokenSchema = z.string().trim().min(1).max(512);
const keys = {
  token: 'foundable.github.token',
  repo: 'foundable.github.repo',
  branch: 'foundable.github.branch',
};

export function githubSiteSettings(
  vault: ReturnType<typeof vaultStore> | undefined,
  request: typeof fetch = fetch,
) {
  async function config(businessId: string) {
    if (!vault) return null;
    const [token, repo, branch] = await Promise.all(
      Object.values(keys).map((key) => vault.revealByName(businessId, key)),
    );
    if (!token || !repo || !branch) return null;
    return { token, repo, branch };
  }
  return {
    async get(businessId: string) {
      const saved = await config(businessId);
      return saved
        ? {
            available: true,
            configured: true,
            repo: saved.repo,
            branch: saved.branch,
          }
        : {
            available: Boolean(vault),
            configured: false,
            repo: '',
            branch: 'main',
          };
    },
    async connect(
      businessId: string,
      input: { token: string; repo: string; branch: string },
    ) {
      if (!vault) return false;
      const token = tokenSchema.parse(input.token);
      const repo = repoSchema.parse(input.repo);
      const branch = branchSchema.parse(input.branch);
      const response = await request('https://api.github.com/repos/' + repo, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok) return false;
      const result: unknown = await response.json();
      const access = z
        .object({ permissions: z.object({ push: z.boolean() }).optional() })
        .safeParse(result);
      if (!access.success || access.data.permissions?.push !== true)
        return false;
      const branchResponse = await request(
        'https://api.github.com/repos/' +
          repo +
          '/git/ref/heads/' +
          branch.split('/').map(encodeURIComponent).join('/'),
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      if (!branchResponse.ok) return false;
      await vault.save(businessId, keys.token, token);
      await vault.save(businessId, keys.repo, repo);
      await vault.save(businessId, keys.branch, branch);
      return true;
    },
    async disconnect(businessId: string) {
      if (!vault) return;
      const credentials = await vault.list(businessId);
      for (const key of Object.values(keys)) {
        const credential = credentials.find((item) => item.name === key);
        if (credential) await vault.remove(businessId, credential.id);
      }
    },
    async resolve(businessId: string) {
      const saved = await config(businessId);
      return saved
        ? {
            repo: saved.repo,
            branch: saved.branch,
            sync: githubSiteSync(saved, request),
          }
        : null;
    },
  };
}
