ALTER TABLE agent_turns ADD COLUMN usage jsonb NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0}'::jsonb;
--> statement-breakpoint
CREATE TABLE website_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  document text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  unpublished_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_live_website_per_artifact ON website_publications(artifact_id) WHERE unpublished_at IS NULL;
--> statement-breakpoint
CREATE TABLE website_visit_days (
  artifact_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  day date NOT NULL,
  views integer NOT NULL DEFAULT 0,
  PRIMARY KEY (artifact_id, day)
);
