import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import { WebsitePreview } from './website-preview';
import styles from './workbench.module.css';

type MailSummary = {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  threadId?: string;
};
type Message = MailSummary & {
  body: string | null;
  html: string | null;
  messageId?: string | null;
};

export function ReceivedMail({
  id,
  timezone,
  editable,
}: {
  id: string;
  timezone: string;
  editable: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const base = `/api/companies/${id}/work/inbound`;
  const inbox = useQuery({
    queryKey: ['received-mail', id],
    queryFn: () => api<{ address: string | null; emails: MailSummary[] }>(base),
    refetchInterval: 20_000,
  });
  const message = useQuery({
    queryKey: ['received-mail', id, selected],
    queryFn: () =>
      api<{ email: Message; thread?: MailSummary[] }>(`${base}/${selected}`),
    enabled: Boolean(selected),
  });
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
  const email = message.data?.email;
  const latest = new Map<string, MailSummary>();
  for (const item of inbox.data?.emails ?? []) {
    const key = item.threadId ?? item.id;
    if (!latest.has(key)) latest.set(key, item);
  }
  function open(id?: string) {
    setSelected(id);
    setDraft(null);
    setReply('');
    setError('');
  }
  async function createDraft() {
    if (!email || sending || !reply.trim()) return;
    setSending(true);
    setError('');
    try {
      const result = await write<{ item: { id: string } }>(
        `${base}/${email.id}/reply-draft`,
        { body: reply },
      );
      setDraft(result.item.id);
      setReply('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(false);
    }
  }
  if (inbox.data && !inbox.data.address && !inbox.data.emails.length)
    return null;

  return (
    <section
      className={`${styles.workList} ${styles.inboundMail}`}
      aria-label="Received email"
    >
      <h2>Received email</h2>
      {inbox.isPending && <p role="status">Loading received email…</p>}
      {inbox.isError && (
        <>
          <p role="alert">{errorMessage(inbox.error)}</p>
          <Button onClick={() => void inbox.refetch()}>Try again</Button>
        </>
      )}
      {inbox.data?.address && <p>{inbox.data.address}</p>}
      {selected ? (
        <article className={styles.receivedMessage}>
          <Button onClick={() => open()} disabled={sending}>
            Back to received email
          </Button>
          {message.isPending && <p role="status">Loading message…</p>}
          {message.isError && <p role="alert">{errorMessage(message.error)}</p>}
          {email && (
            <>
              <h3>{email.subject || 'No subject'}</h3>
              <p>
                {email.sender}
                <small>
                  <time dateTime={email.receivedAt}>
                    {format.format(new Date(email.receivedAt))}
                  </time>
                </small>
              </p>
              {email.body ? (
                <p className={styles.receivedBody}>{email.body}</p>
              ) : email.html ? (
                <WebsitePreview title="Email body" html={email.html} />
              ) : (
                <p>This message has no body.</p>
              )}
              {(message.data?.thread?.length ?? 0) > 1 && (
                <section aria-label="Messages in this thread">
                  <h4>In this thread</h4>
                  <ul>
                    {message.data?.thread?.map((entry) => (
                      <li key={entry.id}>
                        <Button
                          size="small"
                          variant="quiet"
                          disabled={entry.id === email.id || sending}
                          onClick={() => open(entry.id)}
                        >
                          {entry.subject || 'No subject'} ·{' '}
                          {format.format(new Date(entry.receivedAt))}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {editable && email.messageId && !draft && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createDraft();
                  }}
                  className={styles.taskForm}
                >
                  <label>
                    Reply
                    <textarea
                      required
                      maxLength={8000}
                      value={reply}
                      onChange={(event) => setReply(event.currentTarget.value)}
                    />
                  </label>
                  <Button type="submit" disabled={sending}>
                    Create reply draft
                  </Button>
                </form>
              )}
              {draft && (
                <a href={`/f/${id}/inbox?item=${draft}`}>Review reply draft</a>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </article>
      ) : inbox.data?.emails.length ? (
        <ul>
          {Array.from(latest.values()).map((item) => (
            <li key={item.id}>
              <button onClick={() => open(item.id)}>
                <span>
                  <strong>{item.subject || 'No subject'}</strong>
                  <small>{item.sender}</small>
                </span>
                <small>
                  <time dateTime={item.receivedAt}>
                    {format.format(new Date(item.receivedAt))}
                  </time>
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        inbox.data && <p>No received email yet.</p>
      )}
    </section>
  );
}
