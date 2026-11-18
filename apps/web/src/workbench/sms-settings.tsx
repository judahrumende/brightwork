import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './workbench.module.css';

export function SmsSettings({ endpoint }: { endpoint: string }) {
  const cache = useQueryClient();
  const key = ['workspace-settings', endpoint];
  const sms = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<{
        enabled: boolean;
        connection: {
          phone: string;
          connected: boolean;
          webhook: string;
        } | null;
      }>(endpoint, { signal }),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(body: object, method: string) {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await write(endpoint, body, method);
      await cache.invalidateQueries({ queryKey: key });
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Twilio SMS settings">
      <h2>Twilio SMS</h2>
      {sms.isPending && <p role="status">Loading SMS settings…</p>}
      {sms.isError && <p role="alert">{errorMessage(sms.error)}</p>}
      {sms.data && !sms.data.enabled && <p>SMS connections are unavailable.</p>}
      {sms.data?.connection && (
        <p>
          {sms.data.connection.phone} ·{' '}
          {sms.data.connection.connected ? 'Connected' : 'Disconnected'}
        </p>
      )}
      {sms.data?.connection?.connected && (
        <>
          <p>
            Configure this URL as the incoming message webhook in Twilio and
            select HTTP POST.
          </p>
          <p>
            <code>{sms.data.connection.webhook}</code>
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void save({}, 'DELETE')}
          >
            Disconnect SMS
          </Button>
        </>
      )}
      {sms.data?.enabled && (
        <form
          className={styles.taskForm}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void save(Object.fromEntries(new FormData(form)), 'POST').then(
              (saved) => {
                if (saved) form.reset();
              },
            );
          }}
        >
          <label>
            Twilio account SID
            <input
              name="accountSid"
              required
              maxLength={34}
              autoComplete="off"
            />
          </label>
          <label>
            Twilio phone number SID
            <input
              name="numberSid"
              required
              maxLength={34}
              autoComplete="off"
            />
          </label>
          <label>
            Twilio auth token
            <input
              name="token"
              type="password"
              required
              maxLength={128}
              autoComplete="off"
            />
          </label>
          <Button type="submit" disabled={busy}>
            Connect or reconnect SMS
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
