import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StoreReport as Report } from '@brightwork/shared';
import { api, errorMessage } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './store-dashboard.module.css';

function recentRange() {
  const through = new Date();
  const from = new Date(through);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    through: through.toISOString().slice(0, 10),
  };
}

export function StoreReport({
  endpoint,
  mode,
}: {
  endpoint: string;
  mode: 'test' | 'live';
}) {
  const [range, setRange] = useState(recentRange);
  const report = useQuery({
    queryKey: ['store-data', endpoint, 'report', range],
    queryFn: ({ signal }) =>
      api<Report>(
        endpoint + '/report?' + new URLSearchParams({ ...range, mode }),
        {
          signal,
        },
      ),
  });
  function changeRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setRange({
      from: String(fields.get('from')),
      through: String(fields.get('through')),
    });
  }
  const data = report.data;
  const currency = data
    ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: data.currency,
      })
    : null;
  const money = (cents: bigint) =>
    currency
      ?.formatToParts(cents / 100n)
      .map((part) =>
        part.type === 'fraction'
          ? new Intl.NumberFormat(undefined, {
              minimumIntegerDigits: 2,
              useGrouping: false,
            }).format(cents % 100n)
          : part.value,
      )
      .join('');
  const totals = data?.days.reduce(
    (total, day) => ({
      requests: total.requests + day.requests,
      cancelled: total.cancelled + day.cancelled,
      paid: total.paid + day.paidOrders,
      gross: total.gross + BigInt(day.gross),
      refunds: total.refunds + BigInt(day.refunds),
    }),
    { requests: 0, cancelled: 0, paid: 0, gross: 0n, refunds: 0n },
  );
  const max = Math.max(1, ...(data?.days.map((day) => day.requests) ?? []));
  return (
    <>
      <h3>Store report</h3>
      <p>{mode === 'test' ? 'Test' : 'Live'} Stripe payment data</p>
      <form className={styles.listFilters} onSubmit={changeRange}>
        <label>
          From (UTC)
          <input required type="date" name="from" defaultValue={range.from} />
        </label>
        <label>
          Through (UTC)
          <input
            required
            type="date"
            name="through"
            defaultValue={range.through}
          />
        </label>
        <Button type="submit" variant="secondary">
          Apply dates
        </Button>
      </form>
      {report.isPending && <p role="status">Loading report…</p>}
      {report.error && <p role="alert">{errorMessage(report.error)}</p>}
      {data && totals && (
        <>
          <h4>Store usage</h4>
          <dl className={styles.metrics}>
            <div>
              <dt>Products</dt>
              <dd>{data.usage.products}</dd>
            </div>
            <div>
              <dt>Variants</dt>
              <dd>{data.usage.variants}</dd>
            </div>
            <div>
              <dt>Product photos</dt>
              <dd>{data.usage.photoCount}</dd>
            </div>
            <div>
              <dt>Product photo storage</dt>
              <dd>{BigInt(data.usage.photoBytes).toLocaleString()} bytes</dd>
            </div>
            <div>
              <dt>Model credits</dt>
              <dd>{Number(data.usage.modelCredits).toFixed(2)}</dd>
            </div>
            <div>
              <dt>Tool credits</dt>
              <dd>{Number(data.usage.toolCredits).toFixed(2)}</dd>
            </div>
            <div>
              <dt>Total build credits</dt>
              <dd>{Number(data.usage.totalCredits).toFixed(2)}</dd>
            </div>
            <div>
              <dt>Charged media jobs</dt>
              <dd>{data.usage.mediaJobs}</dd>
            </div>
            <div>
              <dt>Media credits</dt>
              <dd>{Number(data.usage.mediaCredits).toFixed(2)}</dd>
            </div>
          </dl>
          <p>
            Store resources are current totals. Build credits include model and
            tool charges tied to store revisions. Media credits use the
            configured Foundable rates and are not provider invoice amounts.
          </p>
          <dl className={styles.metrics}>
            <div>
              <dt>Order requests</dt>
              <dd>{totals.requests}</dd>
            </div>
            <div>
              <dt>Cancelled requests</dt>
              <dd>{totals.cancelled}</dd>
            </div>
            <div>
              <dt>Paid Stripe orders</dt>
              <dd>{totals.paid}</dd>
            </div>
            <div>
              <dt>Gross paid</dt>
              <dd>{money(totals.gross)}</dd>
            </div>
            <div>
              <dt>Refunds on those payments</dt>
              <dd>{money(totals.refunds)}</dd>
            </div>
            <div>
              <dt>Paid after refunds</dt>
              <dd>{money(totals.gross - totals.refunds)}</dd>
            </div>
          </dl>
          <p>
            Payments use the date Stripe confirmed them. Refunds are counted
            against the original payment date.
          </p>
          <div className={styles.table}>
            <table>
              <thead>
                <tr>
                  <th>Day (UTC)</th>
                  <th>Requests</th>
                  <th>Paid orders</th>
                  <th>Gross paid</th>
                  <th>Refunded</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((day) => (
                  <tr key={day.day}>
                    <th scope="row">{day.day}</th>
                    <td>
                      <span className={styles.actions}>
                        {day.requests}
                        <meter
                          aria-hidden="true"
                          min={0}
                          max={max}
                          value={day.requests}
                        />
                      </span>
                    </td>
                    <td>{day.paidOrders}</td>
                    <td>{money(BigInt(day.gross))}</td>
                    <td>{money(BigInt(day.refunds))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
