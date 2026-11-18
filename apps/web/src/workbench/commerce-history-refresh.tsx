import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';

export function CommerceHistoryRefresh({
  endpoint,
  queryKey,
}: {
  endpoint: string;
  queryKey: string[];
}) {
  const cache = useQueryClient();
  const refresh = useMutation({
    mutationFn: (after: string | null) =>
      write<{
        checked: number;
        refreshed: number;
        failed: number;
        next: string | null;
      }>(endpoint + '/history/refresh', after ? { after } : {}),
    async onSuccess() {
      await cache.invalidateQueries({ queryKey });
      await cache.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey.some(
            (part) =>
              typeof part === 'string' && part.includes('/insights/commerce'),
          ),
      });
    },
  });
  const batch = refresh.data;
  return (
    <>
      <Button
        variant="quiet"
        size="small"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate(batch?.next ?? null)}
      >
        {refresh.isPending
          ? 'Refreshing…'
          : batch?.next
            ? 'Refresh next batch'
            : 'Refresh order history'}
      </Button>
      {batch && (
        <p role="status">
          Checked {batch.checked}. Refreshed {batch.refreshed}.
          {batch.failed > 0 &&
            ' Provider requests failed for ' + batch.failed + '.'}
          {batch.next && ' More orders are available.'}
        </p>
      )}
      {refresh.isError && <p role="alert">{errorMessage(refresh.error)}</p>}
    </>
  );
}
