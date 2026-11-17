import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import type { CalendarEvent } from './calendar-days';
import styles from './workbench.module.css';

export function CalendarEventFields({
  timezone,
  event,
}: {
  timezone: string;
  event?: CalendarEvent;
}) {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const inputDate = (value: string | undefined) =>
    value ? local.format(new Date(value)).replace(' ', 'T') : '';
  return (
    <>
      <input
        name="location"
        maxLength={500}
        aria-label="Location or video link"
        placeholder="Location or video link"
        defaultValue={event?.location}
      />
      <fieldset className={styles.eventDates}>
        <legend>Date &amp; time</legend>
        <label>
          Starts{' '}
          <input
            name="start"
            type="datetime-local"
            required
            defaultValue={inputDate(event?.startsAt)}
          />
        </label>
        <label>
          Ends{' '}
          <input
            name="end"
            type="datetime-local"
            required
            defaultValue={inputDate(event?.endsAt)}
          />
        </label>
        <small>Time zone · {timezone}</small>
      </fieldset>
      <label>
        With
        <textarea
          name="attendees"
          rows={2}
          maxLength={2000}
          placeholder="One person per line"
          defaultValue={event?.attendees}
        />
      </label>
      <small>Attendees are saved for your workspace’s reference.</small>
      <label>
        Notes
        <textarea name="notes" maxLength={4000} defaultValue={event?.notes} />
      </label>
    </>
  );
}

export function CalendarEventDetails({
  event,
  companyId,
  editable,
  onChanged,
  onClose,
  restoreFocus,
}: {
  event: CalendarEvent;
  companyId: string;
  editable: boolean;
  onChanged: (event: CalendarEvent | null) => Promise<void>;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const [mode, setMode] = useState<'details' | 'edit' | 'delete'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const format = new Intl.DateTimeFormat(undefined, {
    timeZone: event.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  async function change(
    method: 'PATCH' | 'DELETE',
    submission?: FormEvent<HTMLFormElement>,
  ) {
    submission?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const endpoint = `/api/companies/${companyId}/schedule/events/${event.id}`;
    try {
      if (method === 'PATCH' && submission) {
        const { event: modified } = await write<{ event: CalendarEvent }>(
          endpoint,
          {
            ...Object.fromEntries(new FormData(submission.currentTarget)),
            timezone: event.timezone,
          },
          method,
        );
        await onChanged(modified);
        setMode('details');
      } else if (method === 'DELETE') {
        await write(endpoint, {}, method);
        await onChanged(null);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.taskDialog}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <header>
            <Dialog.Title>{event.title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="quiet" aria-label="Close">
                ×
              </Button>
            </Dialog.Close>
          </header>
          {mode === 'edit' ? (
            <form
              className={styles.taskForm}
              onSubmit={(submission) => void change('PATCH', submission)}
            >
              <label>
                Title{' '}
                <input
                  name="title"
                  maxLength={160}
                  required
                  defaultValue={event.title}
                />
              </label>
              <CalendarEventFields timezone={event.timezone} event={event} />
              <Button type="submit" disabled={busy}>
                Save event
              </Button>
              <Button
                type="button"
                disabled={busy}
                variant="secondary"
                onClick={() => {
                  setMode('details');
                  setError('');
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <dl className={styles.eventDetails}>
              <dt>Starts</dt>
              <dd>
                <time dateTime={event.startsAt}>
                  {format.format(new Date(event.startsAt))}
                </time>
              </dd>
              <dt>Ends</dt>
              <dd>
                <time dateTime={event.endsAt}>
                  {format.format(new Date(event.endsAt))}
                </time>
              </dd>
              <dt>Time zone</dt>
              <dd>{event.timezone}</dd>
              {event.location && (
                <>
                  <dt>Location</dt>
                  <dd>
                    {/^https?:\/\//iu.test(event.location) &&
                    URL.canParse(event.location) ? (
                      <a href={event.location} target="_blank" rel="noreferrer">
                        {event.location}
                      </a>
                    ) : (
                      event.location
                    )}
                  </dd>
                </>
              )}
              {event.attendees && (
                <>
                  <dt>With</dt>
                  <dd>{event.attendees}</dd>
                </>
              )}
              {event.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{event.notes}</dd>
                </>
              )}
            </dl>
          )}
          {editable && mode === 'details' && (
            <footer>
              <Button variant="secondary" onClick={() => setMode('edit')}>
                Edit event
              </Button>
              <Button variant="quiet" onClick={() => setMode('delete')}>
                Delete event
              </Button>
            </footer>
          )}
          {mode === 'delete' && (
            <footer aria-label="Confirm event deletion">
              <p>Delete this event from the calendar?</p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setMode('details');
                  setError('');
                }}
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void change('DELETE')}>
                Confirm deletion
              </Button>
            </footer>
          )}
          {error && <p role="alert">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
