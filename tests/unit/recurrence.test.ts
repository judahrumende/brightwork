import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarEventTimes,
  upcomingOccurrences,
} from '../../apps/api/src/workspace/recurrence.ts';

test('calendar events use the selected zone and reject gaps and reversed intervals', () => {
  assert.deepEqual(
    calendarEventTimes(
      '2026-11-17T23:30',
      '2026-11-18T01:00',
      'Australia/Perth',
    ),
    {
      startsAt: new Date('2026-11-17T15:30:00Z'),
      endsAt: new Date('2026-11-17T17:00:00Z'),
    },
  );
  assert.equal(
    calendarEventTimes(
      '2026-03-08T02:15',
      '2026-03-08T04:00',
      'America/New_York',
    ),
    null,
  );
  assert.equal(
    calendarEventTimes(
      '2026-11-17T23:30',
      '2026-11-17T22:30',
      'Australia/Perth',
    ),
    null,
  );
  assert.equal(
    calendarEventTimes(
      '2026-11-01T01:15',
      '2026-11-01T02:00',
      'America/New_York',
    )?.startsAt.toISOString(),
    '2026-11-01T05:15:00.000Z',
  );
});

test('daily tasks retain the local hour when daylight saving jumps forward', () => {
  const result = upcomingOccurrences(
    new Date('2026-03-07T07:30:00Z'),
    'daily',
    'America/New_York',
    new Date('2026-03-07T00:00:00Z'),
    3,
  );
  assert.deepEqual(result, [
    '2026-03-07T07:30:00.000Z',
    '2026-03-08T07:30:00.000Z',
    '2026-03-09T06:30:00.000Z',
  ]);
});

test('overlapping local times use the earlier instant', () => {
  const result = upcomingOccurrences(
    new Date('2026-10-31T05:30:00Z'),
    'daily',
    'America/New_York',
    new Date('2026-11-01T00:00:00Z'),
    2,
  );
  assert.deepEqual(result, [
    '2026-11-01T05:30:00.000Z',
    '2026-11-02T06:30:00.000Z',
  ]);
});

test('monthly tasks use the last available day without changing the original day', () => {
  const result = upcomingOccurrences(
    new Date('2026-01-31T02:30:00Z'),
    'monthly',
    'Australia/Perth',
    new Date('2026-02-01T00:00:00Z'),
    3,
  );
  assert.deepEqual(result, [
    '2026-02-28T02:30:00.000Z',
    '2026-03-31T02:30:00.000Z',
    '2026-04-30T02:30:00.000Z',
  ]);
});

test('finds upcoming weekly occurrences for an old task without replaying its history', () => {
  const result = upcomingOccurrences(
    new Date('2000-01-03T02:30:00Z'),
    'weekly',
    'Australia/Perth',
    new Date('2026-11-16T03:00:00Z'),
    2,
  );
  assert.deepEqual(result, [
    '2026-11-23T02:30:00.000Z',
    '2026-11-30T02:30:00.000Z',
  ]);
  assert.deepEqual(
    upcomingOccurrences(new Date(0), 'once', 'UTC', new Date(1000)),
    [],
  );
});

test('uses an inclusive start and exclusive end for calendar windows', () => {
  const first = new Date('2026-11-02T01:00:00Z');
  const end = new Date('2026-11-04T01:00:00Z');
  assert.deepEqual(upcomingOccurrences(first, 'daily', 'UTC', first, 10, end), [
    '2026-11-02T01:00:00.000Z',
    '2026-11-03T01:00:00.000Z',
  ]);
  assert.deepEqual(upcomingOccurrences(end, 'once', 'UTC', first, 10, end), []);
});
