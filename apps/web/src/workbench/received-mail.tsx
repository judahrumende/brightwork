import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../auth/client';
import { Button } from '../ui/primitives';
import { WebsitePreview } from './website-preview';
import styles from './workbench.module.css';

type MailSummary = {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
};
type Message = MailSummary & { body: string | null; html: string | null };

export function ReceivedMail({
  id,
  timezone,
}: {
  id: string;
  timezone: string;
}) {
  const [selected, setSelected] = useState<string>();
  const base = `/api/companies/${id}/work/inbound`;
  const inbox = useQuery({
    queryKey: ['received-mail', id],
    queryFn: () => api<{ address: string | null; emails: MailSummary[] }>(base),
    refetchInterval: 20_000,
  });
  const message = useQuery({
    queryKey: ['received-mail', id, selected],
    queryFn: () => api<{ email: Message }>(`${base}/${selected}`),
    enabled: Boolean(selected),
  });
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
  const email = message.data?.email;
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
          <Button onClick={() => setSelected(undefined)}>
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
            </>
          )}
        </article>
      ) : inbox.data?.emails.length ? (
        <ul>
          {inbox.data.emails.map((item) => (
            <li key={item.id}>
              <button onClick={() => setSelected(item.id)}>
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
