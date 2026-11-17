import { createFileRoute } from '@tanstack/react-router';
import { SessionBoundary } from '../workbench/session';
import { Workbench, workspaceViews } from '../workbench/workbench';
import type { WorkspaceView } from '../workbench/workbench';

export const Route = createFileRoute('/f/$business/{-$view}')({
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { business, view = 'home' } = Route.useParams();
  const target = workspaceViews.includes(view as WorkspaceView)
    ? (view as WorkspaceView)
    : null;
  return (
    <SessionBoundary>
      {(session) => {
        const company = session.companyList.companies.find(
          (row) => row.id === business,
        );
        return company && target ? (
          <Workbench company={company} session={session} view={target} />
        ) : (
          <main>
            <h1>Workspace not found</h1>
            <a href="/home">Return to Home</a>
          </main>
        );
      }}
    </SessionBoundary>
  );
}
