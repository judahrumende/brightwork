import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/database';
import {
  artifacts,
  generatedAppSourceRevisions,
  publications,
  websiteVersions,
} from '../db/schema';
import { publicationAction } from './publication-policy';
import { prepareGeneratedAppRecordsForRevision } from './generated-app-records';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function publishWebsite(
  tx: Transaction,
  businessId: string,
  id: string,
  revision: number,
  enabled: boolean,
) {
  const [draft] = await tx
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.businessId, businessId),
        eq(artifacts.id, id),
        eq(artifacts.kind, 'website'),
        eq(artifacts.revision, revision),
      ),
    )
    .for('update');
  if (!draft) return false;

  const [version] = await tx
    .select({ runtimeMode: websiteVersions.runtimeMode })
    .from(websiteVersions)
    .where(
      and(
        eq(websiteVersions.artifactId, id),
        eq(websiteVersions.revision, revision),
      ),
    );
  if (!version) return false;

  if (enabled && version.runtimeMode === 'app') {
    const [source] = await tx
      .select({
        buildState: generatedAppSourceRevisions.buildState,
        previewDocument: generatedAppSourceRevisions.previewDocument,
      })
      .from(generatedAppSourceRevisions)
      .where(
        and(
          eq(generatedAppSourceRevisions.siteId, id),
          eq(generatedAppSourceRevisions.revision, revision),
        ),
      );
    if (source?.buildState !== 'passed' || !source.previewDocument)
      return false;
  }

  const active = and(
    eq(publications.artifactId, id),
    isNull(publications.unpublishedAt),
  );
  const [current] = await tx
    .select({ revision: publications.draftRevision })
    .from(publications)
    .where(active);
  const action = publicationAction(
    enabled,
    draft.state,
    revision,
    current?.revision,
  );
  if (action === 'reject') return false;
  if (action === 'unchanged') return true;
  if (
    enabled &&
    version.runtimeMode === 'app' &&
    !(await prepareGeneratedAppRecordsForRevision(tx, id, revision))
  )
    return false;
  if (current)
    await tx
      .update(publications)
      .set({ unpublishedAt: new Date() })
      .where(active);
  if (action === 'publish')
    await tx.insert(publications).values({
      artifactId: id,
      document: draft.body,
      pages: draft.pages,
      draftRevision: revision,
      runtimeMode: version.runtimeMode,
    });
  return true;
}
