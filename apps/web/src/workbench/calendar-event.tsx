import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/primitives';
import type { CalendarEvent } from './calendar-days';
import styles from './workbench.module.css';

export function CalendarEventFields({ timezone }: { timezone: string }) {
  return (
    <>
      <input
        name="location"
        maxLength={500}
        aria-label="Location or video link"
        placeholder="Location or video link"
      />
      <fieldset className={styles.eventDates}>
        <legend>Date &amp; time</legend>
        <label>
          Starts <input name="start" type="datetime-local" required />
        </label>
        <label>
          Ends <input name="end" type="datetime-local" required />
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
        />
      </label>
      <small>Attendees are saved for your workspace’s reference.</small>
      <label>
        Notes
        <textarea name="notes" maxLength={4000} />
      </label>
    </>
  );
}

export function CalendarEventDetails({
  event,
  onClose,
  restoreFocus,
}: {
  event: CalendarEvent;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const format = new Intl.DateTimeFormat(undefined, {
    timeZone: event.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
