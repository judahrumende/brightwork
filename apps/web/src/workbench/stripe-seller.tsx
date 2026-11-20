import { CommerceHistoryRefresh } from './commerce-history-refresh';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';

export type SaleSummary = {
  id: string;
  mode: 'test' | 'live';
  title: string;
  currency: string;
  amount: number;
  amountRefunded: number;
  paidAt: string | null;
};

export function salePrice(amount: number, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  });
  return formatter.format(
    amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2),
  );
}

const currencies = ['aud', 'usd', 'nzd', 'cad', 'gbp', 'eur'];

export function StripeSeller({ endpoint }: { endpoint: string }) {
  const query = useQueryClient();
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const modes = useQuery({
    queryKey: [endpoint, 'modes'],
    queryFn: ({ signal }) =>
      api<{ availableModes: Array<'test' | 'live'> }>(endpoint + '?mode=test', {
        signal,
      }),
  });
  const availableModes = modes.data?.availableModes ?? [];
  const selectedMode = availableModes.includes(mode)
    ? mode
    : (availableModes[0] ?? mode);
  const modePath = (suffix = '') => endpoint + suffix + '?mode=' + selectedMode;
  const modeEndpoint = modePath();
  const result = useQuery({
    queryKey: [endpoint, selectedMode],
    queryFn: ({ signal }) =>
      api<{
        enabled: boolean;
        mode: 'test' | 'live';
        availableModes: Array<'test' | 'live'>;
        seller: { ready: boolean; detailsSubmitted: boolean } | null;
        orders: SaleSummary[];
      }>(modeEndpoint, { signal }),
    refetchInterval: 15_000,
  });
  const orderId = useRef(crypto.randomUUID());
  const [created, setCreated] = useState('');
  const onboarding = useMutation({
    mutationFn: () => write<{ url: string }>(modePath('/onboarding'), {}),
    onSuccess: ({ url }) => location.assign(url),
  });
  const create = useMutation({
    mutationFn: (values: {
      title: FormDataEntryValue | null;
      price: FormDataEntryValue | null;
      currency: FormDataEntryValue | null;
    }) => {
      const [units, cents = ''] = String(values.price).split('.');
      const amount = Number(units) * 100 + Number(cents.padEnd(2, '0'));
      return write<{ path: string }>(modePath('/sales'), {
        id: orderId.current,
        title: values.title,
        currency: values.currency,
        amount,
      });
    },
    async onSuccess({ path }) {
      orderId.current = crypto.randomUUID();
      setCreated(path);
      await query.invalidateQueries({ queryKey: [endpoint] });
    },
  });
  const data = result.data;
  const error = modes.error ?? result.error ?? onboarding.error ?? create.error;
  if (!modes.isPending && availableModes.length === 0) return null;
  return (
    <section aria-label="Stripe Connect">
      <h2>Stripe Connect</h2>
      {result.isPending && <p role="status">Loading Stripe Connect…</p>}
      {availableModes.length ? (
        <label>
          Payment mode{' '}
          <select
            value={selectedMode}
            onChange={(event) => setMode(event.target.value as 'test' | 'live')}
          >
            {availableModes.map((value) => (
              <option key={value} value={value}>
                {value === 'test' ? 'Test' : 'Live'}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {data?.enabled && (
        <>
          <p>{selectedMode === 'test' ? 'Test mode' : 'Live mode'}</p>
          {data.seller?.ready ? (
            <p>
              Ready to accept {selectedMode === 'test' ? 'test' : 'live'}{' '}
              payments
            </p>
          ) : (
            <Button
              disabled={onboarding.isPending}
              onClick={() => onboarding.mutate()}
            >
              {data.seller
                ? 'Continue Stripe onboarding'
                : 'Set up Stripe seller account'}
            </Button>
          )}
          {data.seller?.ready && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate(
                  Object.fromEntries(new FormData(event.currentTarget)) as {
                    title: FormDataEntryValue;
                    price: FormDataEntryValue;
                    currency: FormDataEntryValue;
                  },
                );
              }}
            >
              <label>
                Sale title
                <input name="title" required maxLength={200} />
              </label>
              <label>
                Amount
                <input
                  name="price"
                  inputMode="decimal"
                  pattern="[0-9]{1,6}(\.[0-9]{1,2})?"
                  required
                />
              </label>
              <label>
                Currency
                <select name="currency">
                  {currencies.map((value) => (
                    <option key={value} value={value}>
                      {value.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={create.isPending}>
                Create sale link
              </Button>
            </form>
          )}
          {created && (
            <p role="status">
              Sale link created. <a href={created}>Open the new sale</a>
            </p>
          )}
          {data.seller && (
            <CommerceHistoryRefresh
              endpoint={endpoint}
              queryKey={[endpoint, selectedMode]}
              query={'?mode=' + selectedMode}
            />
          )}
          <ul aria-label="Stripe sales">
            {data.orders.map((sale) => (
              <li key={sale.id}>
                <a href={'/sale/' + sale.id}>{sale.title}</a> ·{' '}
                {salePrice(sale.amount, sale.currency)} ·{' '}
                {sale.paidAt ? 'Paid' : 'Awaiting payment'}
                {sale.amountRefunded > 0 &&
                  ' · Refunded ' +
                    salePrice(sale.amountRefunded, sale.currency)}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert">{errorMessage(error)}</p>}
    </section>
  );
}
