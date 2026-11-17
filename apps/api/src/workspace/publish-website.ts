import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/database';
import { artifacts, publications } from '../db/schema';
import { publicationAction } from './publication-policy';

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
    });
  return true;
}
