export type CalendarMode = 'day' | 'week' | 'month' | 'year';
const dayMs = 86_400_000;

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export function calendarDay(format: Intl.DateTimeFormat, date: Date) {
  const parts = new Map(
    format.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

export function calendarPeriod(
  anchor: Date,
  mode: Exclude<CalendarMode, 'year'>,
) {
  const monthStart = new Date(anchor);
  monthStart.setUTCDate(1);
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const start = mode === 'month' ? monthStart : anchor;
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  const first = start.getTime() - (mode === 'day' ? 0 : mondayOffset * dayMs);
  const count =
    mode === 'month'
      ? Math.ceil((mondayOffset + monthEnd.getUTCDate()) / 7) * 7
      : mode === 'week'
        ? 7
        : 1;
  return {
    days: Array.from(
      { length: count },
      (_, index) => new Date(first + index * dayMs),
    ),
    // Both edges have a UTC day of overlap for the first and last local dates.
    from: new Date(first - dayMs).toISOString(),
    to: new Date(first + (count + 1) * dayMs).toISOString(),
  };
}

export function moveCalendar(anchor: Date, mode: CalendarMode, step: number) {
  if (mode === 'year') {
    const moved = new Date(anchor);
    moved.setUTCFullYear(moved.getUTCFullYear() + step, 0, 1);
    return moved;
  }
  if (mode !== 'month') {
    return new Date(
      anchor.getTime() + step * (mode === 'week' ? 7 : 1) * dayMs,
    );
  }
  const moved = new Date(anchor);
  moved.setUTCMonth(moved.getUTCMonth() + step, 1);
  return moved;
}

export function calendarMonths(anchor: Date) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date(anchor);
    month.setUTCMonth(index, 1);
    return month;
  });
}

export function calendarQuarters(anchor: Date) {
  const months = calendarMonths(anchor);
  return [0, 3, 6, 9].map((index) => {
    const start = months[index]!;
    const end = months[index + 3] ?? moveCalendar(start, 'year', 1);
    return {
      from: new Date(start.getTime() - dayMs).toISOString(),
      to: new Date(end.getTime() + dayMs).toISOString(),
    };
  });
}

export function calendarMinute(format: Intl.DateTimeFormat, date: Date) {
  const parts = new Map(
    format.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return Number(parts.get('hour')) * 60 + Number(parts.get('minute'));
}

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string;
  attendees: string;
  notes: string;
};
export type Occurrence = {
  id: string;
  title: string;
  start: string;
  event?: CalendarEvent;
  continues?: boolean;
};

export function groupCalendarItems(
  format: Intl.DateTimeFormat,
  dates: Date[],
  tasks: Occurrence[],
  events: CalendarEvent[],
) {
  const groups = new Map<string, Occurrence[]>();
  const days = new Set(dates.map(isoDay));
  function add(day: string, item: Occurrence) {
    const entries = groups.get(day);
    if (entries) entries.push(item);
    else groups.set(day, [item]);
  }
  for (const item of new Map(
    tasks.map((task) => [task.id + task.start, task]),
  ).values())
    add(calendarDay(format, new Date(item.start)), item);
  for (const event of new Map(
    events.map((entry) => [entry.id, entry]),
  ).values()) {
    const first = calendarDay(format, new Date(event.startsAt));
    const last = calendarDay(format, new Date(Date.parse(event.endsAt) - 1));
    for (const day of days) {
      if (day < first || day > last) continue;
      add(day, {
        id: event.id,
        title: event.title,
        start: event.startsAt,
        event,
        continues: day !== first,
      });
    }
  }
  for (const entries of groups.values()) {
    entries.sort(
      (a, b) =>
        Number(Boolean(b.continues)) - Number(Boolean(a.continues)) ||
        a.start.localeCompare(b.start),
    );
  }
  return groups;
}
type PositionedTask = { item: Occurrence; minute: number; lane: number };
const taskMinutes = 30;

export function timedTasks(items: Occurrence[], format: Intl.DateTimeFormat) {
  const sorted = items
    .map((item) => ({
      item,
      minute: item.continues ? 0 : calendarMinute(format, new Date(item.start)),
    }))
    .sort((a, b) => a.minute - b.minute);
  const groups: { tasks: PositionedTask[]; laneEnds: number[] }[] = [];
  for (const { item, minute } of sorted) {
    let cluster = groups.at(-1);
    if (!cluster || cluster.laneEnds.every((end) => end <= minute)) {
      cluster = { tasks: [], laneEnds: [] };
      groups.push(cluster);
    }
    const vacant = cluster.laneEnds.findIndex((end) => end <= minute);
    const lane = vacant === -1 ? cluster.laneEnds.length : vacant;
    cluster.laneEnds[lane] = minute + taskMinutes;
    cluster.tasks.push({ item, minute, lane });
  }
  return groups.flatMap(({ tasks, laneEnds }) =>
    tasks.map((task) => ({ ...task, columns: laneEnds.length })),
  );
}
