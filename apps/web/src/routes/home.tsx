import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Session } from '../auth/client';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import {
  HomeRedirect,
  SessionBoundary,
  workspacePath,
} from '../workbench/session';
import styles from '../workbench/workbench.module.css';

export const Route = createFileRoute('/home')({
  component: () => (
    <SessionBoundary>
      {(session) => <HomeInvitations session={session} />}
    </SessionBoundary>
  ),
});

function HomeInvitations({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useQuery({
    queryKey: ['account', session.userId, 'invitations'],
    queryFn: ({ signal }) =>
      api<{ invitations: { id: string; name: string; role: string }[] }>(
        '/api/me/invitations',
        { signal },
      ),
  });
  const explicit = new URLSearchParams(location.search).has('invitations');
  if (!explicit && !list.isPending && !list.data?.invitations.length)
    return <HomeRedirect session={session} />;
  const previous =
    session.companyList.lastOpened ?? session.companyList.companies[0]?.id;
  async function accept(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { workspaceId } = await write<{ workspaceId: string }>(
        '/api/me/invitations/' + id + '/accept',
      );
      location.replace(workspacePath(workspaceId));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }
  return (
    <main className={styles.centered}>
      <section className={styles.centerCard}>
        <h1>Workspace invitations</h1>
        {list.isPending && <p role="status">Checking invitations…</p>}
        {list.data?.invitations.length === 0 && <p>No pending invitations.</p>}
        <ul>
          {list.data?.invitations.map((item) => (
            <li key={item.id}>
              {item.name} · {item.role}{' '}
              <Button
                size="small"
                disabled={busy}
                onClick={() => void accept(item.id)}
              >
                Accept invitation
              </Button>
            </li>
          ))}
        </ul>
        {list.isError && <p role="alert">{errorMessage(list.error)}</p>}
        {error && <p role="alert">{error}</p>}
        <a href={previous ? workspacePath(previous) : '/new'}>
          Continue to your workspace
        </a>
      </section>
    </main>
  );
}
