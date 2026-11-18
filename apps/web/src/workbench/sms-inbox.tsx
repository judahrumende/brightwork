import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './workbench.module.css';

type Message = {
  id: string;
  peer: string;
  body: string;
  direction: 'inbound' | 'outbound';
  status: string;
  createdAt: string;
};

export function SmsInbox({ id, canReply }: { id: string; canReply: boolean }) {
  const path = '/api/companies/' + id + '/work/sms';
  const client = useQueryClient();
  const key = ['sms-inbox', id];
  const inbox = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<{ enabled: boolean; connected: boolean; messages: Message[] }>(path, {
        signal,
      }),
    refetchInterval: 15_000,
  });
  const [peer, setPeer] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef<{ id: string; recipient: string; body: string } | null>(
    null,
  );
  if (!inbox.data?.enabled) return null;

  const peers = [
    ...new Set(inbox.data.messages.map((message) => message.peer)),
  ];
  const thread = inbox.data.messages
    .filter((message) => message.peer === peer)
    .reverse();
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (busy || !text || !peer) return;
    if (
      !draft.current ||
      draft.current.recipient !== peer ||
      draft.current.body !== text
    ) {
      draft.current = { id: crypto.randomUUID(), recipient: peer, body: text };
    }
    setBusy(true);
    setError('');
    try {
      await write(path, draft.current);
      await client.invalidateQueries({ queryKey: key });
      draft.current = null;
      setBody('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="SMS Inbox" className={styles.view}>
      <h2>SMS</h2>
      {!inbox.data.connected && (
        <p>Connect a Twilio number in Workspace settings to reply.</p>
      )}
      {peers.length === 0 && <p>No SMS conversations yet.</p>}
      {peers.length > 0 && (
        <label>
          SMS conversation
          <select
            value={peer}
            disabled={busy}
            onChange={(event) => {
              setPeer(event.currentTarget.value);
              setBody('');
              setError('');
            }}
          >
            <option value="">Choose a conversation</option>
            {peers.map((number) => (
              <option key={number}>{number}</option>
            ))}
          </select>
        </label>
      )}
      {peer && (
        <>
          <ol aria-label="SMS messages">
            {thread.map((message) => (
              <li key={message.id}>
                <p>{message.body}</p>
                <small>
                  {message.direction === 'inbound'
                    ? 'Received'
                    : message.status === 'needs_review' ||
                        message.status === 'submitting'
                      ? 'Check delivery in Twilio before resending'
                      : message.status}
                  {' · '}
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString()}
                  </time>
                </small>
              </li>
            ))}
          </ol>
          {canReply && inbox.data.connected && (
            <form
              className={styles.taskForm}
              onSubmit={(event) => void send(event)}
            >
              <label>
                SMS reply
                <textarea
                  required
                  maxLength={1600}
                  value={body}
                  onChange={(event) => setBody(event.currentTarget.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Send SMS reply
              </Button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
