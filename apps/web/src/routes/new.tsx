import { createFileRoute } from '@tanstack/react-router';
import { NewBusiness } from '../workbench/new-business';
import { SessionBoundary } from '../workbench/session';

export const Route = createFileRoute('/new')({
  component: () => (
    <SessionBoundary signUp>
      {(session) => <NewBusiness session={session} />}
    </SessionBoundary>
  ),
});
