import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { WebsitePage } from '@brightwork/shared';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import { WebsitePreview } from './website-preview';
import styles from './workbench.module.css';

type Version = {
  id: string;
  revision: number;
  title: string;
  savedAt: string;
  bookmarked: boolean;
};

export function WebsiteVersions({
  endpoint,
  queryKey,
  currentRevision,
  readOnly,
}: {
  endpoint: string;
  queryKey: readonly string[];
  currentRevision: number;
  readOnly: boolean;
}) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookmarks, setBookmarks] = useState(false);
  const historyKey = [...queryKey, 'versions', endpoint];
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => api<{ versions: Version[] }>(endpoint, { signal }),
  });
  const preview = useQuery({
    queryKey: [...historyKey, selected],
    enabled: Boolean(selected),
    queryFn: ({ signal }) =>
      api<{ version: Version & { document: string; pages?: WebsitePage[] } }>(
        endpoint + '/' + selected,
        { signal },
      ),
  });
  const versions =
    history.data?.versions.filter(
      (version) => !bookmarks || version.bookmarked,
    ) ?? [];
  const version = preview.data?.version;

  async function bookmark(item: Version) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(
        endpoint + '/' + item.id,
        { bookmarked: !item.bookmarked },
        'PATCH',
      );
      await cache.invalidateQueries({ queryKey: historyKey });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function restore(item: Version) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(endpoint + '/' + item.id + '/restore', {
        revision: currentRevision,
      });
      setSelected(undefined);
      await cache.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.versionHistory} aria-label="Website versions">
      <label>
        <input
          type="checkbox"
          checked={bookmarks}
          onChange={(event) => setBookmarks(event.currentTarget.checked)}
        />
        Bookmarked only
      </label>
      {history.isPending && <p role="status">Loading saved versions…</p>}
      {history.isError && <p role="alert">{errorMessage(history.error)}</p>}
      {history.data && !versions.length && (
        <p>No saved versions in this list.</p>
      )}
      <ul className={styles.versionList}>
        {versions.map((item) => (
          <li key={item.id}>
            <button
              className={styles.versionChoice}
              onClick={() => {
                setError('');
                setSelected(item.id);
              }}
              aria-pressed={item.id === selected}
            >
              <strong>{item.title}</strong>
              <small>
                Version {item.revision} ·{' '}
                <time dateTime={item.savedAt}>
                  {new Date(item.savedAt).toLocaleString()}
                </time>
                {item.revision === currentRevision ? ' · Current draft' : ''}
              </small>
            </button>
            {!readOnly && (
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                aria-label={`Bookmark version ${item.revision}`}
                aria-pressed={item.bookmarked}
                onClick={() => void bookmark(item)}
              >
                {item.bookmarked ? 'Bookmarked' : 'Bookmark'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {selected && preview.isPending && <p role="status">Loading preview…</p>}
      {preview.isError && <p role="alert">{errorMessage(preview.error)}</p>}
      {version && (
        <>
          <WebsitePreview
            html={version.document}
            pages={version.pages ?? []}
            title={`Website version ${version.revision} preview`}
          />
          {!readOnly && version.revision < currentRevision && (
            <Button
              size="small"
              disabled={busy}
              onClick={() => void restore(version)}
            >
              Restore as new draft
            </Button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
