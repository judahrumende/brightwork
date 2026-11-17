import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarDay,
  calendarPeriod,
  calendarQuarters,
  groupCalendarItems,
  isoDay,
  moveCalendar,
  timedTasks,
} from '../../apps/web/src/workbench/calendar-days.ts';

test('month grid begins on Monday and includes spillover days', () => {
  const period = calendarPeriod(new Date('2026-11-16T00:00:00Z'), 'month');
  assert.equal(period.days.length, 42);
  assert.equal(isoDay(period.days[0]!), '2026-10-26');
  assert.equal(isoDay(period.days[41]!), '2026-12-06');
  assert.equal(period.from, '2026-10-25T00:00:00.000Z');
  assert.equal(period.to, '2026-12-08T00:00:00.000Z');
});

test('calendar includes ongoing events once per occupied local day and excludes an exact midnight end', () => {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Perth',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const event = {
    id: 'event',
    title: 'Open studio',
    timezone: 'Australia/Perth',
    startsAt: '2026-11-16T15:30:00Z',
    endsAt: '2026-11-18T16:00:00Z',
    location: '',
    attendees: '',
    notes: '',
  };
  const task = {
    id: 'task',
    title: 'Check the room',
    start: '2026-11-17T01:00:00Z',
  };
  const days = ['17', '18', '19'].map(
    (day) => new Date(`2026-11-${day}T00:00:00Z`),
  );
  const groups = groupCalendarItems(format, days, [task, task], [event, event]);
  assert.deepEqual(
    groups.get('2026-11-17')?.map((item) => item.id),
    ['event', 'task'],
  );
  assert.equal(groups.get('2026-11-18')?.[0]?.event, event);
  assert.equal(groups.get('2026-11-18')?.[0]?.continues, true);
  assert.equal(groups.has('2026-11-19'), false);
});

test('year covers local dates using four requests within the API range cap', () => {
  const anchor = new Date('2028-02-29T00:00:00Z');
  const quarters = calendarQuarters(anchor);
  assert.equal(quarters.length, 4);
  assert.equal(quarters[0]?.from, '2027-12-31T00:00:00.000Z');
  assert.equal(quarters[3]?.to, '2029-01-02T00:00:00.000Z');
  for (const { from, to } of quarters) {
    assert.ok(Date.parse(to) - Date.parse(from) <= 94 * 86_400_000);
  }
  assert.equal(isoDay(moveCalendar(anchor, 'year', 1)), '2029-01-01');
});

test('timed view uses workspace wall time and assigns overlapping tasks their own lanes', () => {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const positioned = timedTasks(
    [
      { id: 'a', title: 'First 1:10', start: '2026-11-01T05:10:00.000Z' },
      { id: 'b', title: 'Second 1:10', start: '2026-11-01T06:10:00.000Z' },
      { id: 'c', title: 'Later', start: '2026-11-01T13:00:00.000Z' },
    ],
    format,
  );
  assert.deepEqual(
    positioned.map(({ minute, lane, columns }) => [minute, lane, columns]),
    [
      [70, 0, 2],
      [70, 1, 2],
      [480, 0, 1],
    ],
  );
});

test('calendar uses the workspace day and moves from the end of a long month safely', () => {
  const inPerth = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Perth',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  assert.equal(
    calendarDay(inPerth, new Date('2026-11-15T23:00:00Z')),
    '2026-11-16',
  );
  assert.equal(
    isoDay(moveCalendar(new Date('2026-01-31T00:00:00Z'), 'month', 1)),
    '2026-02-01',
  );
});
