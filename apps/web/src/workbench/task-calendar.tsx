import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../auth/client';
import { Icon } from '../ui/icons';
import { Button, EmptyState, Segmented } from '../ui/primitives';
import {
  calendarDay,
  calendarMonths,
  calendarPeriod,
  calendarQuarters,
  groupCalendarItems,
  isoDay,
  moveCalendar,
} from './calendar-days';
import type { CalendarEvent, CalendarMode, Occurrence } from './calendar-days';
import { CalendarEventDetails } from './calendar-event';
import { TimedCalendar } from './timed-calendar';
import styles from './calendar.module.css';

const labels = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export function TaskCalendar({
  companyId,
  timezone,
  onSelect,
  onCreate,
  onList,
}: {
  companyId: string;
  timezone: string;
  onSelect: (task: string) => void;
  onCreate: (() => void) | undefined;
  onList: () => void;
}) {
  const [mode, setMode] = useState<CalendarMode>('month');
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const eventOrigin = useRef<HTMLElement | null>(null);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [timezone],
  );
  const today = calendarDay(dateFormatter, new Date());
  const [anchor, setAnchor] = useState(() => new Date(today + 'T00:00:00Z'));
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,select,[contenteditable]')) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'p' || key === 'k')
        setAnchor((date) => moveCalendar(date, mode, -1));
      else if (key === 'n' || key === 'j')
        setAnchor((date) => moveCalendar(date, mode, 1));
      else if (key === 't') setAnchor(new Date(today + 'T00:00:00Z'));
      else if (key === 'c' && onCreate) onCreate();
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [mode, onCreate, today]);
  const period = calendarPeriod(anchor, mode === 'year' ? 'month' : mode);
  const ranges = mode === 'year' ? calendarQuarters(anchor) : [period];
  const calendar = useQueries({
    queries: ranges.map(({ from, to }) => ({
      queryKey: ['company', companyId, 'work', 'schedule', from, to],
      queryFn: ({ signal }) => {
        const parameters = new URLSearchParams({ from, to, limit: '500' });
        return api<{
          occurrences: Occurrence[];
          calendarEvents: CalendarEvent[];
          truncated: boolean;
        }>(`/api/companies/${companyId}/schedule/occurrences?${parameters}`, {
          signal,
        });
      },
      refetchInterval: mode === 'year' ? 60_000 : 30_000,
    })),
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const headerFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    ...(mode === 'day' ? { weekday: 'long', day: 'numeric' } : {}),
    ...(mode === 'year' ? {} : { month: 'long' }),
    year: 'numeric',
  });
  const monthFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'long',
  });
  const dayFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
  });
  const { days } = period;
  const months = mode === 'year' ? calendarMonths(anchor) : [];
  const groups = groupCalendarItems(
    dateFormatter,
    mode === 'year'
      ? months.flatMap((month) => calendarPeriod(month, 'month').days)
      : days,
    calendar.flatMap(({ data }) => data?.occurrences ?? []),
    calendar.flatMap(({ data }) => data?.calendarEvents ?? []),
  );
  function selectItem(item: Occurrence, trigger: HTMLElement) {
    if (!item.event) return onSelect(item.id);
    eventOrigin.current = trigger;
    setSelected(item.event);
  }
  const empty =
    mode !== 'year' &&
    calendar.every((query) => query.isSuccess) &&
    days.every((day) => !groups.has(isoDay(day)));
  const failure = calendar.find((query) => query.isError);

  return (
    <section className={styles.calendar} aria-label="Task calendar">
      <div className={styles.toolbar}>
        <div className={styles.buttons}>
          <Button
            size="icon"
            variant="quiet"
            aria-label="All tasks"
            onClick={onList}
          >
            <Icon name="list" />
          </Button>
          {onCreate && (
            <Button
              size="icon"
              variant="quiet"
              aria-label="New task"
              aria-keyshortcuts="C"
              onClick={onCreate}
            >
              <Icon name="plus" />
            </Button>
          )}
        </div>
        <Segmented
          label="Calendar view"
          options={labels}
          value={mode}
          onValueChange={(value) => setMode(value as CalendarMode)}
        />
        <span className={styles.timezone} title={timezone}>
          <Icon name="globe" />{' '}
          {timezone.split('/').at(-1)?.replaceAll('_', ' ')}
        </span>
      </div>
      <div className={styles.navigation}>
        <h1>{headerFormatter.format(anchor)}</h1>
        <div className={styles.buttons}>
          <Button
            size="icon"
            variant="quiet"
            aria-label={`Previous ${mode}`}
            aria-keyshortcuts="P K"
            onClick={() => setAnchor((date) => moveCalendar(date, mode, -1))}
          >
            <span className={styles.previous}>
              <Icon name="arrow" />
            </span>
          </Button>
          <Button
            size="small"
            variant="quiet"
            aria-keyshortcuts="T"
            onClick={() => setAnchor(new Date(today + 'T00:00:00Z'))}
          >
            Today
          </Button>
          <Button
            size="icon"
            variant="quiet"
            aria-label={`Next ${mode}`}
            aria-keyshortcuts="N J"
            onClick={() => setAnchor((date) => moveCalendar(date, mode, 1))}
          >
            <Icon name="arrow" />
          </Button>
        </div>
      </div>
      {calendar.some((query) => query.isPending) && (
        <p className={styles.status} role="status">
          Loading scheduled tasks…
        </p>
      )}
      {failure && (
        <p className={styles.status} role="alert">
          {errorMessage(failure.error)}
        </p>
      )}
      {calendar.some((query) => query.data?.truncated) && (
        <p className={styles.status} role="status">
          Choose a shorter view to see more tasks in this period.
        </p>
      )}
      <div className={styles.calendarBody} data-mode={mode}>
        {mode === 'year' ? (
          <div className={styles.year}>
            {months.map((month) => (
              <section key={isoDay(month)}>
                <h2>
                  <button
                    onClick={() => {
                      setAnchor(month);
                      setMode('month');
                    }}
                  >
                    {monthFormatter.format(month)}
                  </button>
                </h2>
                <ol>
                  {calendarPeriod(month, 'month').days.map((date) => {
                    const key = isoDay(date);
                    const inMonth = date.getUTCMonth() === month.getUTCMonth();
                    const count = inMonth ? groups.get(key)?.length : undefined;
                    return (
                      <li
                        key={key}
                        data-muted={!inMonth}
                        aria-hidden={!inMonth || undefined}
                      >
                        <time
                          dateTime={key}
                          aria-current={key === today ? 'date' : undefined}
                          data-busy={Boolean(count)}
                        >
                          {date.getUTCDate()}
                          {count !== undefined && (
                            <span className={styles.taskCount}> · {count}</span>
                          )}
                        </time>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        ) : mode === 'day' || mode === 'week' ? (
          <TimedCalendar
            dates={days}
            groups={groups}
            timezone={timezone}
            dateFormatter={dateFormatter}
            timeFormatter={timeFormatter}
            onSelect={selectItem}
          />
        ) : (
          <>
            <div className={styles.weekdays} aria-hidden="true">
              {days.slice(0, 7).map((date) => (
                <span key={isoDay(date)}>{dayFormatter.format(date)}</span>
              ))}
            </div>
            <ol className={styles.days}>
              {days.map((date) => {
                const key = isoDay(date);
                const muted = date.getUTCMonth() !== anchor.getUTCMonth();
                return (
                  <li key={key} className={styles.day} data-muted={muted}>
                    <time
                      dateTime={key}
                      aria-current={key === today ? 'date' : undefined}
                    >
                      {date.getUTCDate()}
                    </time>
                    {groups.get(key)?.map((item) => (
                      <button
                        key={item.id + item.start}
                        data-event={Boolean(item.event)}
                        onClick={(event) =>
                          selectItem(item, event.currentTarget)
                        }
                      >
                        {item.continues ? (
                          <span>Continues</span>
                        ) : (
                          <time dateTime={item.start}>
                            {timeFormatter.format(new Date(item.start))}
                          </time>
                        )}
                        <span>{item.title}</span>
                      </button>
                    ))}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {empty && (
          <div className={styles.empty}>
            <EmptyState
              icon={
                <span className={styles.emptyCalendarIcon}>
                  <Icon name="calendar" size={14} />
                </span>
              }
              title="No tasks yet"
              description="Tasks you or Pip schedule appear here."
              action={
                onCreate && (
                  <Button size="small" variant="secondary" onClick={onCreate}>
                    <Icon name="plus" /> New task
                  </Button>
                )
              }
            />
          </div>
        )}
      </div>
      {selected && (
        <CalendarEventDetails
          event={selected}
          onClose={() => setSelected(null)}
          restoreFocus={() => eventOrigin.current?.focus()}
        />
      )}
    </section>
  );
}
