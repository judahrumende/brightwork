import { z } from 'zod';
import type { WebsitePage } from '@brightwork/shared';

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const shaObject = z.object({ sha });

export function githubSiteSync(
  config: { repo: string; branch: string; token: string },
  request: typeof fetch = fetch,
) {
  const base = 'https://api.github.com/repos/' + config.repo + '/git/';
  const branch = config.branch.split('/').map(encodeURIComponent).join('/');

  return async function sync(site: {
    id: string;
    revision: number;
    html: string;
    pages: WebsitePage[];
  }) {
    const signal = AbortSignal.timeout(20_000);
    async function call(path: string, method = 'GET', body?: object) {
      return request(base + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + config.token,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
        redirect: 'error',
      });
    }
    async function json(response: Response): Promise<unknown> {
      if (!response.ok)
        throw new Error('GitHub rejected the website sync request');
      return response.json();
    }

    const ref = z
      .object({ object: shaObject })
      .parse(await json(await call('ref/heads/' + branch)));
    const parent = ref.object.sha;
    const { tree } = z
      .object({ tree: shaObject })
      .parse(await json(await call('commits/' + parent)));
    const entries = [
      { path: 'index.html', content: site.html },
      ...site.pages.map((page) => ({
        path: page.slug + '/index.html',
        content: page.html,
      })),
    ];
    const subtree = shaObject.parse(
      await json(
        await call('trees', 'POST', {
          tree: entries.map((entry) => ({
            ...entry,
            mode: '100644',
            type: 'blob',
          })),
        }),
      ),
    );
    const combined = shaObject.parse(
      await json(
        await call('trees', 'POST', {
          base_tree: tree.sha,
          tree: [
            {
              path: 'sites/' + site.id,
              mode: '040000',
              type: 'tree',
              sha: subtree.sha,
            },
          ],
        }),
      ),
    );
    const commitUrl = 'https://github.com/' + config.repo + '/commit/';
    if (combined.sha === tree.sha)
      return { url: commitUrl + parent, changed: false };
    const commit = shaObject.parse(
      await json(
        await call('commits', 'POST', {
          message:
            'Sync Brightwork site ' + site.id + ' revision ' + site.revision,
          tree: combined.sha,
          parents: [parent],
        }),
      ),
    );
    const updated = await call('refs/heads/' + branch, 'PATCH', {
      sha: commit.sha,
      force: false,
    });
    if (updated.status === 409 || updated.status === 422) return null;
    const newRef = z.object({ object: shaObject }).parse(await json(updated));
    if (newRef.object.sha !== commit.sha)
      throw new Error('GitHub returned a different branch head');
    return { url: commitUrl + commit.sha, changed: true };
  };
}
