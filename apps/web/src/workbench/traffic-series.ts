export type TrafficDay = { day: string; views: number };
export const trafficRanges = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last_7_days', 'Last 7 days'],
  ['last_14_days', 'Last 14 days'],
  ['last_30_days', 'Last 30 days'],
  ['last_90_days', 'Last 90 days'],
  ['this_month', 'This month'],
] as const;
export type TrafficRange = (typeof trafficRanges)[number][0];

const dayMs = 86_400_000;

export function pageViewSeries(
  rows: readonly TrafficDay[],
  range: TrafficRange,
  asOf: Date,
): TrafficDay[] {
  const today = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  const end = range === 'yesterday' ? today - dayMs : today;
  const days = {
    today: 1,
    yesterday: 1,
    last_7_days: 7,
    last_14_days: 14,
    last_30_days: 30,
    last_90_days: 90,
    this_month: asOf.getUTCDate(),
  }[range];
  const totals = new Map(rows.map(({ day, views }) => [day, views]));
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(end - (days - index - 1) * dayMs)
      .toISOString()
      .slice(0, 10);
    return { day, views: totals.get(day) ?? 0 };
  });
}
