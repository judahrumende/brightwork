import { createFileRoute } from '@tanstack/react-router';
import { HomeRedirect, SessionBoundary } from '../workbench/session';

export const Route = createFileRoute('/home')({
  component: () => (
    <SessionBoundary>
      {(session) => <HomeRedirect session={session} />}
    </SessionBoundary>
  ),
});
