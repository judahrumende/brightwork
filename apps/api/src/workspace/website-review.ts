import type { WebsitePage } from '@brightwork/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/database';

type Version = { document: string; pages: WebsitePage[]; title: string | null };
type ReviewRow = {
  creation_id: string;
  version_id: string;
  revision: number;
  title: string;
  saved_at: string | Date;
  base_version_id: string | null;
  base_revision: number | null;
  base_source: 'published' | 'previous' | null;
  before: Version | null;
  after: Version;
};

export async function websiteReviews(
  db: Database,
  businessId: string,
  filter: {
    id?: string;
    versionId?: string;
    revision?: number;
    onlyPublished?: boolean;
  } = {},
) {
  const rows = await db.execute<ReviewRow>(sql`
    SELECT site.id AS creation_id, draft.id AS version_id, draft.revision,
           draft.title, draft.saved_at,
           CASE WHEN live.id IS NOT NULL THEN live_version.id ELSE previous.id END AS base_version_id,
           coalesce(live.draft_revision, previous.revision) AS base_revision,
           CASE WHEN live.id IS NOT NULL THEN 'published'
                WHEN previous.id IS NOT NULL THEN 'previous' END AS base_source,
           CASE WHEN live.id IS NOT NULL THEN jsonb_build_object('document', live.document, 'pages', live.pages, 'title', live_version.title)
                WHEN previous.id IS NOT NULL THEN jsonb_build_object('document', previous.document, 'pages', previous.pages, 'title', previous.title)
           END AS before,
           jsonb_build_object('document', draft.document, 'pages', draft.pages, 'title', draft.title) AS after
    FROM workspace_artifacts AS site
    JOIN website_versions AS draft ON draft.artifact_id = site.id AND draft.revision = site.revision
    LEFT JOIN website_publications AS live ON live.artifact_id = site.id AND live.unpublished_at IS NULL
    LEFT JOIN website_versions AS live_version ON live_version.artifact_id = site.id AND live_version.revision = live.draft_revision
    LEFT JOIN website_versions AS previous ON previous.artifact_id = site.id AND previous.revision = site.revision - 1
    WHERE site.business_id = ${businessId} AND site.kind = 'website' AND site.state = 'pending'
      ${filter.id ? sql`AND site.id = ${filter.id}` : sql.empty()}
      ${filter.versionId ? sql`AND draft.id = ${filter.versionId}` : sql.empty()}
      ${filter.revision ? sql`AND draft.revision = ${filter.revision}` : sql.empty()}
      ${filter.onlyPublished ? sql`AND live.id IS NOT NULL AND draft.revision <> live.draft_revision` : sql.empty()}
    ORDER BY draft.saved_at DESC, draft.id DESC
    LIMIT ${filter.id ? 1 : 30}
  `);
  return rows.map((row) => {
    const oldPages = versionPages(row.before);
    const newPages = versionPages(row.after);
    const edits = [
      ...new Set([...newPages.keys(), ...oldPages.keys()]),
    ].flatMap((path) => {
      const oldPage = oldPages.get(path);
      const newPage = newPages.get(path);
      if (oldPage?.html === newPage?.html && oldPage?.title === newPage?.title)
        return [];
      return [
        { path, change: !oldPage ? 'added' : !newPage ? 'removed' : 'updated' },
      ];
    });
    return {
      change: {
        creationId: row.creation_id,
        versionId: row.version_id,
        revision: row.revision,
        baseVersionId: row.base_version_id,
        baseRevision: row.base_revision,
        baseSource: row.base_source,
        title: row.title,
        savedAt: new Date(row.saved_at).toISOString(),
        standing: 'pending',
        previewUrl: '/f/' + businessId + '/build?item=' + row.creation_id,
        edits,
      },
      before: row.before,
      after: row.after,
    };
  });
}

function versionPages(version: Version | null) {
  return new Map(
    version
      ? [
          ['/', { html: version.document, title: version.title }],
          ...version.pages.map(
            ({ slug, html, title }) => ['/' + slug, { html, title }] as const,
          ),
        ]
      : [],
  );
}
