export const recurrenceRules = ['once', 'daily', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof recurrenceRules)[number];

const dayMs = 86_400_000;

function localTime(format: Intl.DateTimeFormat, instant: number) {
  const fields = new Map(
    format.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  const year = Number(fields.get('year'));
  const date = new Date(0);
  date.setUTCFullYear(
    fields.get('era') === 'BC' ? 1 - year : year,
    Number(fields.get('month')) - 1,
    Number(fields.get('day')),
  );
  date.setUTCHours(
    Number(fields.get('hour')),
    Number(fields.get('minute')),
    Number(fields.get('second')),
    0,
  );
  return date.getTime();
}

function resolveWallTime(format: Intl.DateTimeFormat, wall: number) {
  const candidates = [-dayMs, 0, dayMs].map((delta) => {
    const sample = wall + delta;
    const instant = wall - (localTime(format, sample) - sample);
    return { instant, shift: localTime(format, instant) - wall };
  });
  // Overlaps use the earlier instant. Gaps advance by the skipped interval.
  candidates.sort((a, b) => a.shift - b.shift || a.instant - b.instant);
  return candidates.find((candidate) => candidate.shift >= 0)?.instant ?? NaN;
}

function wallTimeFormat(zone: string) {
  return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    era: 'short',
  });
}

export function calendarEventTimes(start: string, end: string, zone: string) {
  const format = wallTimeFormat(zone);
  function instant(value: string) {
    const wall = Date.parse(value + ':00Z');
    if (!Number.isFinite(wall)) return NaN;
    const time = resolveWallTime(format, wall);
    return localTime(format, time) === wall ? time : NaN;
  }
  const startsAt = instant(start);
  const endsAt = instant(end);
  if (!(endsAt > startsAt)) return null;
  return { startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

function monthlyWallTime(anchor: Date, index: number) {
  const date = new Date(anchor);
  date.setUTCMonth(anchor.getUTCMonth() + index + 1, 0);
  const day = Math.min(date.getUTCDate(), anchor.getUTCDate());
  date.setUTCDate(day);
  return date.getTime();
}

export function upcomingOccurrences(
  start: Date,
  rule: Recurrence,
  zone: string,
  from: Date,
  limit = 5,
  to?: Date,
): string[] {
  const startTime = start.getTime();
  const threshold = from.getTime();
  const end = to?.getTime() ?? Infinity;
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(threshold) ||
    !Number.isFinite(limit) ||
    limit < 1 ||
    !(end > threshold)
  )
    return [];
  if (rule === 'once')
    return startTime >= threshold && startTime < end
      ? [start.toISOString()]
      : [];

  const format = wallTimeFormat(zone);
  const anchor = localTime(format, startTime);
  const after = localTime(format, threshold);
  const date = new Date(anchor);
  const afterDate = new Date(after);
  const interval = rule === 'weekly' ? 7 * dayMs : dayMs;
  const elapsed =
    rule === 'monthly'
      ? (afterDate.getUTCFullYear() - date.getUTCFullYear()) * 12 +
        afterDate.getUTCMonth() -
        date.getUTCMonth()
      : Math.floor((after - anchor) / interval);

  const result: string[] = [];
  let latest = -Infinity;
  for (
    let index = Math.max(0, elapsed - 1);
    result.length < Math.min(Math.floor(limit), 100);
    index++
  ) {
    const wall =
      rule === 'monthly'
        ? monthlyWallTime(date, index)
        : anchor + index * interval;
    if (!Number.isFinite(wall)) break;
    const instant =
      index === 0
        ? startTime
        : resolveWallTime(format, wall) + start.getUTCMilliseconds();
    if (!Number.isFinite(instant) || instant >= end) break;
    if (instant >= threshold && instant > latest) {
      result.push(new Date(instant).toISOString());
      latest = instant;
    }
  }
  return result;
}
