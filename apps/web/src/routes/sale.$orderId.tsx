import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import { salePrice } from '../workbench/stripe-seller';
import type { SaleSummary } from '../workbench/stripe-seller';

export const Route = createFileRoute('/sale/$orderId')({
  component: PublicSale,
});

function PublicSale() {
  const { orderId } = Route.useParams();
  const endpoint = '/api/sales/' + encodeURIComponent(orderId);
  const sale = useQuery({
    queryKey: [endpoint],
    queryFn: ({ signal }) => api<SaleSummary>(endpoint, { signal }),
    refetchInterval: 5000,
    retry: false,
  });
  const checkout = useMutation({
    mutationFn: () => write<{ url: string }>(endpoint + '/checkout', {}),
    onSuccess: ({ url }) => location.assign(url),
  });
  return (
    <main>
      {sale.isPending && <p role="status">Loading sale…</p>}
      {sale.isError && <h1>Sale unavailable</h1>}
      {sale.data && (
        <>
          <h1>{sale.data.title}</h1>
          <p>{salePrice(sale.data.amount, sale.data.currency)}</p>
          <p>Stripe test payment</p>
          {sale.data.paidAt ? (
            <p>Payment received</p>
          ) : (
            <Button
              disabled={checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              Continue to Stripe Checkout
            </Button>
          )}
          {sale.data.amountRefunded > 0 && (
            <p>
              Refunded {salePrice(sale.data.amountRefunded, sale.data.currency)}
            </p>
          )}
        </>
      )}
      {checkout.error && <p role="alert">{errorMessage(checkout.error)}</p>}
    </main>
  );
}
