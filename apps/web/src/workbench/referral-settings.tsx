import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../auth/client';

export function ReferralSettings() {
  const result = useQuery({
    queryKey: ['account', 'referrals'],
    queryFn: ({ signal }) =>
      api<{
        code: string;
        signups: number;
        conversions: number;
        reward: string;
      }>('/api/me/referrals', { signal }),
  });
  const status = result.data;
  return (
    <section aria-label="Referrals">
      <h2>Referrals</h2>
      {result.isPending && <p role="status">Loading referrals…</p>}
      {result.isError && <p role="alert">{errorMessage(result.error)}</p>}
      {status?.code && (
        <>
          <label>
            Referral link
            <input
              readOnly
              value={
                new URL(
                  '/api/referrals/visit?code=' +
                    encodeURIComponent(status.code),
                  location.origin,
                ).href
              }
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          {Number(status.reward) > 0 && (
            <p>
              Earn {status.reward} credits on a referral’s first eligible paid
              subscription invoice.
            </p>
          )}
          <p>
            {status.signups} sign-ups · {status.conversions} paid referrals
          </p>
        </>
      )}
    </section>
  );
}
