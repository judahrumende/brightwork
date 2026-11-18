import { sql } from 'drizzle-orm';
import type { Database } from '../db/database';

type BuildRow = {
  build_id: string;
  turn_id: string;
  run_id: string | null;
  tool_call_id: string;
  state: string;
  active: boolean;
  creation_id: string | null;
  title: string | null;
  revision: number | null;
  version_id: string | null;
  source_hash: string | null;
  failure: string | null;
};

export function buildActivity(
  db: Database,
  businessId: string,
  filter: { chatId?: string; buildId?: string; active?: boolean } = {},
) {
  return db.execute<BuildRow>(sql`
    SELECT activity.id AS build_id, turn.id AS turn_id, turn.run_id,
           part ->> 'toolCallId' AS tool_call_id,
           CASE
             WHEN part ->> 'status' = 'completed' AND site.id IS NOT NULL THEN 'completed'
             WHEN jsonb_typeof(part -> 'output' -> 'error') = 'string' THEN 'failed'
             WHEN turn.state IN ('failed', 'completed') THEN 'failed'
             ELSE part ->> 'status'
           END AS state,
           turn.state = 'running' AND part ->> 'status' IN ('preparing', 'running') AS active,
           site.id AS creation_id, coalesce(first_version.title, site.title) AS title,
           first_version.revision, first_version.id AS version_id,
           encode(sha256(convert_to(first_version.document, 'UTF8')), 'hex') AS source_hash,
           CASE WHEN jsonb_typeof(part -> 'output' -> 'error') = 'string'
                THEN part -> 'output' ->> 'error' END AS failure
    FROM agent_turns AS turn
    CROSS JOIN LATERAL jsonb_array_elements(turn.parts) WITH ORDINALITY AS tools(part, position)
    CROSS JOIN LATERAL (
      SELECT overlay(overlay(md5(turn.id::text || ':' || (part ->> 'toolCallId') || ':' || position::text)
                            placing '3' from 13) placing '8' from 17)::uuid AS id
    ) AS activity
    LEFT JOIN workspace_artifacts AS site ON site.id = CASE
         WHEN part -> 'output' ->> 'id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
         THEN (part -> 'output' ->> 'id')::uuid END
         AND site.turn_id = turn.id AND site.business_id = turn.business_id AND site.kind = 'website'
    LEFT JOIN LATERAL (
      SELECT id, revision, document, title FROM website_versions
      WHERE artifact_id = site.id ORDER BY revision LIMIT 1
    ) AS first_version ON true
    WHERE turn.business_id = ${businessId}
      AND part ->> 'type' = 'tool' AND part ->> 'name' = 'build'
      AND coalesce(part ->> 'toolCallId', '') <> ''
      ${filter.chatId ? sql`AND coalesce(turn.run_id, turn.id) = ${filter.chatId}` : sql.empty()}
      ${filter.buildId ? sql`AND activity.id = ${filter.buildId}` : sql.empty()}
      ${filter.active ? sql`AND turn.state = 'running' AND part ->> 'status' IN ('preparing', 'running')` : sql.empty()}
    ORDER BY turn.created_at DESC, turn.id DESC, position DESC
    LIMIT ${filter.buildId ? 1 : 100}
  `);
}

export function buildSummary(row: BuildRow) {
  return {
    buildId: row.build_id,
    creationId: row.creation_id,
    revision: row.revision,
    action: 'build',
    status: row.state,
    phase: row.active ? 'building' : row.state,
    summary:
      row.title ??
      (row.active ? 'Building website' : 'Website version unavailable'),
    origin: { turnId: row.turn_id, toolCallId: row.tool_call_id },
    result: row.version_id
      ? { versionId: row.version_id, sourceHash: row.source_hash }
      : null,
    error: row.failure,
  };
}
