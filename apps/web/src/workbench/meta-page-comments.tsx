import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';

type Comment = {
  id: string;
  postId: string;
  parentId: string;
  body: string | null;
  ownPage: boolean;
};
type Reply = {
  id: string;
  commentId: string;
  body: string;
  status: string;
  providerId: string | null;
};

export function MetaPageComments({
  base,
  admin,
}: {
  base: string;
  admin: boolean;
}) {
  const client = useQueryClient();
  const path = base + '/page';
  const connection = useQuery({
    queryKey: [path],
    queryFn: ({ signal }) =>
      api<{
        connection: { pageId: string; name: string; connected: boolean } | null;
      }>(path, { signal }),
  });
  const thread = useQuery({
    queryKey: [path, 'comments'],
    queryFn: ({ signal }) =>
      api<{ comments: Comment[]; replies: Reply[] }>(path + '/comments', {
        signal,
      }),
    refetchInterval: 15_000,
  });
  const [selected, setSelected] = useState('');
  const [body, setBody] = useState('');
  const draft = useRef<{ id: string; commentId: string; body: string } | null>(
    null,
  );
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: [path] }),
      client.invalidateQueries({ queryKey: [base] }),
    ]);
  };
  const connect = useMutation({
    mutationFn: ({
      data,
      disconnect,
    }: {
      data: object;
      disconnect?: boolean;
    }) => write(path + (disconnect ? '/disconnect' : '/connect'), data),
    onSuccess: refresh,
  });
  const send = useMutation({
    mutationFn: (input: NonNullable<typeof draft.current>) =>
      write(path + '/replies', input),
    async onSuccess() {
      await refresh();
      draft.current = null;
      setBody('');
    },
  });
  const current = connection.data?.connection;
  const comment = thread.data?.comments.find((item) => item.id === selected);
  const comments = thread.data?.comments ?? [];
  const replies = thread.data?.replies ?? [];
  const error = connection.error ?? thread.error ?? connect.error ?? send.error;
  return (
    <section aria-label="Facebook Page comments">
      <h2>Page comments</h2>
      {current && (
        <p>
          {current.name} · {current.connected ? 'Connected' : 'Disconnected'}
        </p>
      )}
      {admin && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              connect.mutate(
                { data: Object.fromEntries(new FormData(form)) },
                { onSuccess: () => form.reset() },
              );
            }}
          >
            <label>
              Facebook Page ID
              <input
                name="pageId"
                defaultValue={current?.pageId}
                required
                inputMode="numeric"
              />
            </label>
            <label>
              Page access token
              <input name="token" type="password" required autoComplete="off" />
            </label>
            <Button type="submit" disabled={connect.isPending}>
              Connect or reconnect Page
            </Button>
          </form>
          {current?.connected && (
            <Button
              disabled={connect.isPending}
              variant="secondary"
              onClick={() => connect.mutate({ data: {}, disconnect: true })}
            >
              Disconnect Page
            </Button>
          )}
        </>
      )}
      {comments.length ? (
        <label>
          Facebook comment
          <select
            value={selected}
            disabled={send.isPending}
            onChange={(event) => {
              setSelected(event.currentTarget.value);
              setBody('');
            }}
          >
            <option value="">Choose a comment</option>
            {comments
              .filter((item) => !item.ownPage)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.body?.slice(0, 100) || 'Comment ' + item.id}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <p>No Page comments received yet.</p>
      )}
      {comment && (
        <>
          <ol aria-label="Comment thread">
            {comments
              .filter(
                (item) =>
                  item.postId === comment.postId &&
                  (item.id === comment.id ||
                    item.id === comment.parentId ||
                    item.parentId === comment.id) &&
                  !replies.some((reply) => reply.providerId === item.id),
              )
              .slice()
              .reverse()
              .map((item) => (
                <li key={item.id}>{item.body || 'Comment has no text'}</li>
              ))}
            {replies
              .filter((item) => item.commentId === comment.id)
              .slice()
              .reverse()
              .map((item) => (
                <li key={item.id}>
                  {item.body} ·{' '}
                  {item.status === 'published'
                    ? 'Published'
                    : 'Check Facebook before sending again'}
                </li>
              ))}
          </ol>
          {admin && current?.connected && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const text = body.trim();
                if (!text || send.isPending) return;
                if (
                  !draft.current ||
                  draft.current.body !== text ||
                  draft.current.commentId !== comment.id
                )
                  draft.current = {
                    id: crypto.randomUUID(),
                    body: text,
                    commentId: comment.id,
                  };
                send.mutate(draft.current);
              }}
            >
              <label>
                Facebook reply
                <textarea
                  required
                  maxLength={4000}
                  value={body}
                  onChange={(event) => setBody(event.currentTarget.value)}
                />
              </label>
              <Button type="submit" disabled={send.isPending}>
                Publish reply on Facebook
              </Button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{errorMessage(error)}</p>}
    </section>
  );
}
