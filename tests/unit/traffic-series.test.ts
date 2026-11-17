import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageViewSeries } from '../../apps/web/src/workbench/traffic-series.ts';

test('fills absent dates and excludes counts outside the UTC window', () => {
  const rows = [
    { day: '2026-02-22', views: 200 },
    { day: '2026-02-28', views: 7 },
    { day: '2026-03-01', views: 3 },
    { day: '2026-03-02', views: 9 },
  ];
  const series = pageViewSeries(
    rows,
    'last_7_days',
    new Date('2026-03-02T00:12:00+01:00'),
  );
  assert.equal(series.length, 7);
  assert.deepEqual(series[0], { day: '2026-02-23', views: 0 });
  assert.deepEqual(series.slice(-2), rows.slice(1, 3));
  assert.equal(
    series.reduce((sum, entry) => sum + entry.views, 0),
    10,
  );
});

test('reports yesterday and the current month across month boundaries', () => {
  const asOf = new Date('2024-03-01T23:59:59Z');
  assert.deepEqual(pageViewSeries([], 'yesterday', asOf), [
    { day: '2024-02-29', views: 0 },
  ]);
  assert.deepEqual(pageViewSeries([], 'this_month', asOf), [
    { day: '2024-03-01', views: 0 },
  ]);
});
