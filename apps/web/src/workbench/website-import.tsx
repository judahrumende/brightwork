import { useState } from 'react';
import type { FormEvent } from 'react';
import { errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './workbench.module.css';

export function WebsiteImport({
  endpoint,
  onImport,
}: {
  endpoint: string;
  onImport: (id: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { item } = await write<{ item: { id: string } }>(endpoint, { url });
      await onImport(item.id);
      setUrl('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Import website</summary>
      <form
        className={styles.taskForm}
        onSubmit={(event) => void submit(event)}
      >
        <p>Use text from a public page to start a draft.</p>
        <label>
          Website URL
          <input
            type="url"
            required
            maxLength={2048}
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        <Button size="small" disabled={busy} type="submit">
          {busy ? 'Importing…' : 'Import page text'}
        </Button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
