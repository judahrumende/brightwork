import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';

export function BillingSettings() {
  const status = useQuery({
    queryKey: ['account', 'billing'],
    queryFn: ({ signal }) =>
      api<{
        enabled: boolean;
        state: string;
        testMode?: boolean;
        periodEnd?: string | null;
        paid: boolean;
        canOpenPortal?: boolean;
        canCheckout?: boolean;
        cancelAtPeriodEnd?: boolean;
      }>('/api/me/billing', { signal }),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function open(action: 'checkout' | 'portal') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { url } = await write<{ url: string }>('/api/me/billing/' + action);
      location.assign(url);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }
  const billing = status.data;
  return (
    <section aria-label="Subscription">
      <h2>Subscription</h2>
      {status.isPending && <p role="status">Loading subscription…</p>}
      {status.isError && <p role="alert">{errorMessage(status.error)}</p>}
      {billing && !billing.enabled && (
        <p>Stripe test billing is unavailable.</p>
      )}
      {billing?.enabled && (
        <>
          {billing.testMode && <p>Stripe test mode</p>}
          <p>Subscription status · {billing.state.replaceAll('_', ' ')}</p>
          {billing.periodEnd && (
            <p>
              {billing.cancelAtPeriodEnd ? 'Ends' : 'Current period ends'}{' '}
              <time dateTime={billing.periodEnd}>
                {new Date(billing.periodEnd).toLocaleDateString()}
              </time>
            </p>
          )}
          {billing.canCheckout && (
            <Button disabled={busy} onClick={() => void open('checkout')}>
              Start test subscription
            </Button>
          )}
          {billing.canOpenPortal && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void open('portal')}
            >
              Manage subscription
            </Button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
