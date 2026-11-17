import { useEffect, useMemo, useRef, useState } from 'react';
import {
  calendarDay,
  calendarMinute,
  isoDay,
  timedTasks,
} from './calendar-days';
import type { Occurrence } from './calendar-days';
import styles from './calendar.module.css';

const hours = Array.from({ length: 24 }, (_, index) => index);
const utcHour = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  timeZone: 'UTC',
});
const weekday = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  timeZone: 'UTC',
});

export function TimedCalendar({
  dates,
  groups,
  timezone,
  dateFormatter,
  timeFormatter,
  onSelect,
}: {
  dates: Date[];
  groups: Map<string, Occurrence[]>;
  timezone: string;
  dateFormatter: Intl.DateTimeFormat;
  timeFormatter: Intl.DateTimeFormat;
  onSelect: (item: Occurrence, trigger: HTMLElement) => void;
}) {
  const [clock, setClock] = useState(() => new Date());
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const start = isoDay(dates[0]!);
  const end = isoDay(dates.at(-1)!);
  const positionFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'shortOffset',
      }),
    [timezone],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const now = new Date();
    const today = calendarDay(dateFormatter, now);
    const firstMinute =
      today >= start && today <= end
        ? Math.max(0, calendarMinute(positionFormatter, now) - 345)
        : 8 * 60;
    if (scroll.current && grid.current) {
      scroll.current.scrollTop =
        (grid.current.clientHeight * firstMinute) / 1440;
    }
  }, [dateFormatter, end, positionFormatter, start]);
  const today = calendarDay(dateFormatter, clock);
  const minute = calendarMinute(positionFormatter, clock);
  const clockLabel = timeFormatter
    .formatToParts(clock)
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  const offset = positionFormatter
    .formatToParts(dates[0]!)
    .find((part) => part.type === 'timeZoneName')?.value;
  const week = dates.length > 1;
  return (
    <div
      className={styles.timedScroll}
      ref={scroll}
      tabIndex={0}
      aria-label="Time grid"
    >
      <div className={styles.timedCalendar} data-week={week}>
        <div className={styles.timedHeader}>
          <span>{offset}</span>
          {dates.map((date) => (
            <span key={isoDay(date)}>
              {weekday.format(date)}
              <time
                dateTime={isoDay(date)}
                aria-current={isoDay(date) === today ? 'date' : undefined}
              >
                {date.getUTCDate()}
              </time>
            </span>
          ))}
        </div>
        <div className={styles.timedGrid} ref={grid}>
          <div className={styles.hourLabels} aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour}>{utcHour.format(hour * 3_600_000)}</span>
            ))}
            {today >= start && today <= end && (
              <span
                className={styles.clockLabel}
                style={{ top: `${minute / 14.4}%` }}
              >
                {clockLabel}
              </span>
            )}
          </div>
          {dates.map((date) => {
            const day = isoDay(date);
            const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
            return (
              <div key={day} className={styles.timeLane} data-weekend={weekend}>
                {timedTasks(groups.get(day) ?? [], positionFormatter).map(
                  ({ item, minute, lane, columns }) => (
                    <button
                      key={item.id + item.start}
                      className={styles.timedTask}
                      data-event={Boolean(item.event)}
                      title={item.title}
                      style={{
                        top: `${minute / 14.4}%`,
                        insetInlineStart: `calc(${(lane * 100) / columns}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`,
                      }}
                      onClick={(event) => onSelect(item, event.currentTarget)}
                    >
                      {item.continues ? (
                        <span>Continues · </span>
                      ) : (
                        <time dateTime={item.start}>
                          {timeFormatter.format(new Date(item.start))}
                        </time>
                      )}
                      <span>{item.title}</span>
                    </button>
                  ),
                )}
                {today >= start && today <= end && (
                  <span
                    className={styles.clockLine}
                    data-today={day === today}
                    style={{ top: `${minute / 14.4}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
