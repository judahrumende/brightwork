import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api, errorMessage } from '../auth/client';
import styles from './workbench.module.css';

export function WorkspaceFiles({ companyId }: { companyId: string }) {
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim());
  const root = '/api/companies/' + encodeURIComponent(companyId);
  const files = useQuery({
    queryKey: ['company', companyId, 'work', 'files', search],
    queryFn: ({ signal }) =>
      api<{ files: { id: string; name: string; turnId: string }[] }>(
        root + '/work/files?' + new URLSearchParams({ q: search }),
        { signal },
      ),
  });
  return (
    <section className={styles.workList} aria-label="Workspace files">
      <h2>Files</h2>
      <label>
        Search files{' '}
        <input
          type="search"
          value={query}
          maxLength={160}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      {files.isPending && <p role="status">Loading files…</p>}
      {files.isError && <p role="alert">{errorMessage(files.error)}</p>}
      {files.data && files.data.files.length === 0 && (
        <p>
          {search
            ? 'No files match your search.'
            : 'Files attached in Build chat appear here.'}
        </p>
      )}
      <ul>
        {files.data?.files.map((file) => (
          <li key={file.id}>
            <a
              href={`${root}/pip/turns/${file.turnId}/attachments/${file.id}`}
              download={file.name}
            >
              {file.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
