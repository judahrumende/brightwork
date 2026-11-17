import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Sky } from '../sky/sky';
import { ApiError, errorMessage, readSession, write } from '../auth/client';
import type { Session } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './workbench.module.css';

export const creditKey = ['account', 'credits'] as const;
export const sessionKey = ['account', 'session'] as const;
export const workspacePath = (id: string, view = 'home') =>
  '/f/' + encodeURIComponent(id) + (view === 'home' ? '' : '/' + view);

function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: readSession,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (attempt, error) =>
      !(error instanceof ApiError && error.status === 401) && attempt < 1,
  });
}

export function usePreferences(profile: Session['profile']) {
  const { appearance, reduceEffects } = profile;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const node = document.documentElement;
    const apply = () => {
      node.dataset.theme =
        appearance === 'system'
          ? media.matches
            ? 'dark'
            : 'light'
          : appearance;
      node.toggleAttribute('data-reduce-effects', reduceEffects);
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
      delete node.dataset.theme;
      node.removeAttribute('data-reduce-effects');
    };
  }, [appearance, reduceEffects]);
}

export function SessionBoundary({
  children,
  signUp = false,
}: {
  children: (session: Session) => React.ReactNode;
  signUp?: boolean;
}) {
  const session = useSession();
  const unauthorized =
    session.error instanceof ApiError && session.error.status === 401;
  useEffect(() => {
    if (unauthorized)
      location.replace(
        (signUp ? '/sign-up' : '/sign-in') +
          '?returnTo=' +
          encodeURIComponent(location.pathname + location.search),
      );
  }, [unauthorized, signUp]);
  if (session.data) return children(session.data);
  return (
    <main className={styles.centered}>
      <Sky scene="quiet" />
      <div className={styles.centerCard}>
        {session.isPending || unauthorized ? (
          <p role="status">Opening your workspace…</p>
        ) : (
          <>
            <h1>Workspace unavailable</h1>
            <p role="alert">{errorMessage(session.error)}</p>
            <Button
              onClick={() => {
                void session.refetch();
              }}
            >
              Try again
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

export function HomeRedirect({ session }: { session: Session }) {
  const id =
    session.companyList.lastOpened ?? session.companyList.companies[0]?.id;
  useEffect(() => {
    location.replace(id ? workspacePath(id) : '/new');
  }, [id]);
  return (
    <main className={styles.centered}>
      <Sky scene="quiet" />
      <p role="status">Opening your workspace…</p>
    </main>
  );
}

export function usePresence() {
  useEffect(() => {
    const beat = () => {
      if (!document.hidden)
        void write('/api/me/presence').catch(() => {
          /* The next heartbeat retries. */
        });
    };
    beat();
    document.addEventListener('visibilitychange', beat);
    const timer = setInterval(beat, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, []);
}
