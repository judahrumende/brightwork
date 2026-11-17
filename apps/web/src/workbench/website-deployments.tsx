import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './workbench.module.css';

type Deployment = {
  id: string;
  revision: number;
  publishedAt: string;
  unpublishedAt: string | null;
  rollbackSourceId: string | null;
};

export function WebsiteDeployments({
  endpoint,
  queryKey,
  canRollback,
}: {
  endpoint: string;
  queryKey: readonly string[];
  canRollback: boolean;
}) {
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState<{
    item: Deployment;
    expectedLive: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [synced, setSynced] = useState<{
    url: string;
    changed: boolean;
  } | null>(null);
  const history = useQuery({
    queryKey: [...queryKey, 'deployments', endpoint],
    queryFn: ({ signal }) =>
      api<{
        deployments: Deployment[];
        github?: { repo: string; branch: string } | null;
      }>(endpoint, { signal }),
  });
  const deployments = history.data?.deployments ?? [];
  const liveId = deployments.find((item) => !item.unpublishedAt)?.id ?? null;
  const github = history.data?.github;

  async function sync(deploymentId: string) {
    setBusy(true);
    setError('');
    setSynced(null);
    try {
      setSynced(
        await write<{ url: string; changed: boolean }>(
          endpoint + '/' + deploymentId + '/github',
        ),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function rollback(item: Deployment, expectedLive: string | null) {
    setBusy(true);
    setError('');
    setSynced(null);
    try {
      await write(endpoint + '/' + item.id + '/rollback', { expectedLive });
      setConfirm(null);
      await cache.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Deployment history" className={styles.versionHistory}>
      <h3>Deployment history</h3>
      {github && liveId && (
        <section aria-label="GitHub sync">
          <p>
            {github.repo} · {github.branch}
          </p>
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => void sync(liveId)}
          >
            Sync live deployment
          </Button>
          {synced && (
            <p role="status">
              {synced.changed ? 'Synced to GitHub.' : 'GitHub is up to date.'}{' '}
              <a href={synced.url} target="_blank" rel="noreferrer">
                View commit
              </a>
            </p>
          )}
        </section>
      )}
      {history.isPending && <p role="status">Loading deployments…</p>}
      {history.isError && <p role="alert">{errorMessage(history.error)}</p>}
      {history.data && deployments.length === 0 && <p>No deployments yet.</p>}
      <ul className={styles.versionList}>
        {deployments.map((item) => (
          <li key={item.id}>
            <p>
              Revision {item.revision} ·{' '}
              {item.unpublishedAt ? 'Earlier deployment' : 'Live'}
              {item.rollbackSourceId && ' · Rolled back'}
            </p>
            <time dateTime={item.publishedAt}>
              {new Date(item.publishedAt).toLocaleString()}
            </time>
            {item.unpublishedAt && canRollback && (
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirm({ item, expectedLive: liveId })}
              >
                Restore revision {item.revision} live
              </Button>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <div role="group" aria-label="Confirm rollback">
          <p>Restore revision {confirm.item.revision} to the live site?</p>
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </Button>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void rollback(confirm.item, confirm.expectedLive)}
          >
            Restore live deployment
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
