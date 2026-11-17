import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../auth/client';
import { Icon } from '../ui/icons';
import { Menu } from '../ui/overlays';
import { Button, EmptyState } from '../ui/primitives';
import {
  pageViewSeries,
  trafficRanges,
  type TrafficDay,
  type TrafficRange,
} from './traffic-series';
import styles from './visitors.module.css';

export function useTraffic(companyId: string) {
  return useQuery({
    queryKey: ['company', companyId, 'traffic'],
    queryFn: ({ signal }) =>
      api<{ daily: TrafficDay[] }>(`/api/companies/${companyId}/traffic`, {
        signal,
      }),
    refetchInterval: 30_000,
  });
}

const calendarLabel = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const chartHeight = 142;
const chartWidth = 640;

function PageViewChart({
  points,
  label,
}: {
  points: TrafficDay[];
  label: string;
}) {
  const [pointIndex, setPointIndex] = useState<number>();
  const maximum = Math.max(1, ...points.map(({ views }) => views));
  const lastIndex = points.length - 1;
  const activeIndex = Math.min(pointIndex ?? lastIndex, lastIndex);
  const selected = points[activeIndex]!;
  const positions = points.map(({ views }, index) => ({
    x: lastIndex ? (index / lastIndex) * chartWidth : chartWidth / 2,
    y: ((maximum - views) / maximum) * (chartHeight - 12) + 6,
  }));
  const active = positions[activeIndex]!;
  const line = positions.map(({ x, y }) => `${x},${y}`).join(' ');
  const selectedDay = calendarLabel.format(new Date(selected.day));
  return (
    <section className={styles.panel} aria-label="Page views chart">
      <header className={styles.chartHeading}>
        <h2>Page views</h2>
        <small>{label}</small>
      </header>
      <div className={styles.plot}>
        <div className={styles.axis} aria-hidden="true">
          <span>{maximum.toLocaleString()}</span>
          <span>0</span>
        </div>
        <div>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className={styles.graph}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const fraction = (event.clientX - bounds.left) / bounds.width;
              setPointIndex(Math.max(0, Math.round(fraction * lastIndex)));
            }}
          >
            {[6, chartHeight / 2, chartHeight - 6].map((y) => (
              <line
                key={y}
                className={styles.gridline}
                x2={chartWidth}
                y1={y}
                y2={y}
              />
            ))}
            <polyline
              className={styles.line}
              points={line}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className={styles.crosshair}
              x1={active.x}
              x2={active.x}
              y2={chartHeight}
            />
            <line
              className={styles.point}
              x1={active.x}
              x2={active.x}
              y1={active.y}
              y2={active.y}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className={styles.axisLabels} aria-hidden="true">
            <span>{calendarLabel.format(new Date(points[0]!.day))}</span>
            {lastIndex > 0 && (
              <span>
                {calendarLabel.format(new Date(points[lastIndex]!.day))}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className={styles.inspect}>
        {lastIndex > 0 && (
          <input
            type="range"
            max={lastIndex}
            value={activeIndex}
            aria-label="Inspect a day"
            aria-valuetext={`${selectedDay}, ${selected.views} page views`}
            onChange={(event) =>
              setPointIndex(event.currentTarget.valueAsNumber)
            }
          />
        )}
        <p>
          <time dateTime={selected.day}>{selectedDay}</time>
          <strong>{selected.views.toLocaleString()} page views</strong>
        </p>
      </div>
    </section>
  );
}

export function Visitors({
  traffic,
  onBack,
}: {
  traffic: ReturnType<typeof useTraffic>;
  onBack: () => void;
}) {
  const [range, setRange] = useState<TrafficRange>('last_7_days');
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  const label = trafficRanges.find(([value]) => value === range)![1];
  const points = pageViewSeries(traffic.data?.daily ?? [], range, new Date());
  const pageViews = points.reduce((total, point) => total + point.views, 0);
  return (
    <section className={styles.visitors} aria-labelledby="visitors-heading">
      <header className={styles.heading}>
        <Button
          ref={back}
          size="icon"
          variant="quiet"
          aria-label="Back to Home"
          onClick={onBack}
        >
          <span className={styles.backIcon}>
            <Icon name="arrow" size={20} />
          </span>
        </Button>
        <h1 id="visitors-heading">Visitors</h1>
      </header>
      <div className={styles.toolbar}>
        <Menu
          trigger={
            <Button size="small" variant="secondary">
              {label} <Icon name="chevron" />
            </Button>
          }
          entries={trafficRanges.map(([id, label]) => ({
            id,
            label,
            selected: range === id,
            onSelect: () => setRange(id),
          }))}
        />
        <small>Dates in UTC</small>
      </div>
      {traffic.isPending && <p role="status">Loading website traffic…</p>}
      {traffic.isError && (
        <div className={styles.panel} role="alert">
          <EmptyState
            title="Website traffic couldn't be loaded"
            action={
              <Button
                variant="secondary"
                onClick={() => void traffic.refetch()}
              >
                Try again
              </Button>
            }
          />
        </div>
      )}
      {traffic.data && (
        <>
          <div className={styles.summary}>
            <article className={styles.panel}>
              <h2>Page views</h2>
              <strong>{pageViews.toLocaleString()}</strong>
            </article>
          </div>
          <PageViewChart key={range} points={points} label={label} />
        </>
      )}
    </section>
  );
}
