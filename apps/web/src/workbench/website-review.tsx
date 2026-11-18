import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { WebsitePage } from '@brightwork/shared';
import { api, errorMessage } from '../auth/client';
import { WebsitePreview } from './website-preview';
import styles from './workbench.module.css';

type Version = { document: string; pages: WebsitePage[] };
type Review = {
  change: {
    revision: number;
    baseRevision: number | null;
    baseSource: 'published' | 'previous' | null;
    edits: { path: string; change: 'added' | 'removed' | 'updated' }[];
  };
  before: Version | null;
  after: Version;
};

function pageDocument(version: Version | null, path: string) {
  return path === '/'
    ? version?.document
    : version?.pages.find(({ slug }) => '/' + slug === path)?.html;
}

export function WebsiteReview({
  endpoint,
  revision,
}: {
  endpoint: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState('');
  const url =
    endpoint + '?' + new URLSearchParams({ revision: String(revision) });
  const result = useQuery({
    queryKey: [url],
    enabled: open,
    queryFn: ({ signal }) => api<Review>(url, { signal }),
  });
  const review = result.data;
  const path = review?.change.edits.some((edit) => edit.path === page)
    ? page
    : (review?.change.edits[0]?.path ?? '/');
  const before = pageDocument(review?.before ?? null, path);
  const after = pageDocument(review?.after ?? null, path);
  const baseline =
    review?.change.baseSource === 'published'
      ? 'Published version'
      : 'Previous version';
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Compare website changes</summary>
      {open && result.isPending && <p role="status">Loading saved versions…</p>}
      {result.isError && <p role="alert">{errorMessage(result.error)}</p>}
      {open && review && (
        <section aria-label="Website change comparison">
          {review.change.edits.length ? (
            <label>
              Changed page{' '}
              <select
                value={path}
                onChange={(event) => setPage(event.target.value)}
              >
                {review.change.edits.map((edit) => (
                  <option key={edit.path} value={edit.path}>
                    {edit.path} · {edit.change}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No page changes in this revision.</p>
          )}
          <div className={styles.websiteReview}>
            <section>
              <h3>
                {baseline}
                {review.change.baseRevision !== null &&
                  ' · revision ' + review.change.baseRevision}
              </h3>
              {before ? (
                <WebsitePreview title={baseline + ' preview'} html={before} />
              ) : (
                <p>No page at this address.</p>
              )}
            </section>
            <section>
              <h3>Draft · revision {review.change.revision}</h3>
              {after ? (
                <WebsitePreview title="Compared draft preview" html={after} />
              ) : (
                <p>This page was removed.</p>
              )}
            </section>
          </div>
        </section>
      )}
    </details>
  );
}
