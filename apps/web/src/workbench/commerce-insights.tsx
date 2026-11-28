import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../auth/client';
import { Button } from '../ui/primitives';

type CommerceReport = {
  mode: 'test' | 'live';
  revenue: {
    source: 'shopify' | 'stripe';
    currency: string;
    sales: number;
    gross: string;
    refunded: string;
    net: string;
  }[];
  customers: { identified: number; repeat: number; unattributed: number };
};
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const money = (value: string, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(Number(value));

export function CommerceInsights({
  companyId,
  onBack,
}: {
  companyId: string;
  onBack: () => void;
}) {
  const [range, setRange] = useState<{
    from: string;
    through: string;
    mode: 'test' | 'live';
  }>(() => ({
    from: isoDay(Date.now() - 29 * 86_400_000),
    through: isoDay(Date.now()),
    mode: 'test',
  }));
  const report = useQuery({
    queryKey: ['commerce-insights', companyId, range],
    queryFn: ({ signal }) =>
      api<CommerceReport>(
        '/api/companies/' +
          companyId +
          '/insights/commerce?' +
          new URLSearchParams(range),
        { signal },
      ),
  });
  return (
    <section aria-label="Commerce insights">
      <Button variant="secondary" onClick={onBack}>
        Back to overview
      </Button>
      <h1>Commerce insights</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setRange({
            from: String(data.get('from')),
            through: String(data.get('through')),
            mode: data.get('mode') === 'live' ? 'live' : 'test',
          });
        }}
      >
        <label>
          From
          <input required type="date" name="from" defaultValue={range.from} />
        </label>
        <label>
          Stripe payment mode
          <select name="mode" defaultValue={range.mode}>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label>
          Through
          <input
            required
            type="date"
            name="through"
            defaultValue={range.through}
          />
        </label>
        <Button type="submit">Apply dates</Button>
      </form>
      <p>Dates use UTC. Refunds are reported against the original sale.</p>
      {report.isPending && <p role="status">Loading commerce insights…</p>}
      {report.isError && <p role="alert">{errorMessage(report.error)}</p>}
      {report.data && (
        <>
          <h2>Sales</h2>
          {report.data.revenue.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <caption>Revenue by provider and currency</caption>
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Sales</th>
                    <th scope="col">Gross</th>
                    <th scope="col">Refunded</th>
                    <th scope="col">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.revenue.map((row) => (
                    <tr key={row.source + row.currency}>
                      <th scope="row">
                        {row.source === 'stripe' ? 'Stripe Connect' : 'Shopify'}
                      </th>
                      <td>{row.sales}</td>
                      <td>{money(row.gross, row.currency)}</td>
                      <td>{money(row.refunded, row.currency)}</td>
                      <td>{money(row.net, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No recorded sales in this date range.</p>
          )}
          <h2>Customers</h2>
          <dl>
            <dt>Identified customers</dt>
            <dd>{report.data.customers.identified}</dd>
            <dt>Repeat customers</dt>
            <dd>{report.data.customers.repeat}</dd>
            <dt>Sales with unknown customer</dt>
            <dd>{report.data.customers.unattributed}</dd>
          </dl>
          <p>
            Customer counts identify repeat purchases within each store or
            seller account. Stripe rows show {report.data.mode} payments;
            Shopify rows are unaffected by this selector.
          </p>
        </>
      )}
    </section>
  );
}
