import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../auth/client';

const labels: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered to recipient’s mail server',
  delivery_delayed: 'Delivery delayed',
  bounced: 'Bounced',
  failed: 'Delivery failed',
  suppressed: 'Suppressed',
  complained: 'Marked as spam',
};

export function EmailDeliveryHistory({
  path,
  timezone,
}: {
  path: string;
  timezone: string;
}) {
  const result = useQuery({
    queryKey: ['email-delivery-history', path],
    queryFn: ({ signal }) =>
      api<{
        events: {
          id: string;
          status: string;
          occurredAt: string;
          revision: number;
          recipient: string;
        }[];
      }>(path, { signal }),
    refetchInterval: 15_000,
  });
  if (result.isError) return <p role="alert">{errorMessage(result.error)}</p>;
  if (!result.data?.events.length) return null;
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
  return (
    <section aria-label="Email delivery history">
      <h3>Delivery history</h3>
      <ul>
        {result.data.events.map((event) => (
          <li key={event.id}>
            {labels[event.status] ?? event.status} · {event.recipient} ·
            Revision {event.revision}
            {' · '}
            <time dateTime={event.occurredAt}>
              {format.format(new Date(event.occurredAt))}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
