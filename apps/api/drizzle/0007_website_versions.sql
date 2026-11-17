CREATE TABLE website_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  title text NOT NULL,
  document text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  bookmarked boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX website_artifact_revision ON website_versions (artifact_id, revision);
--> statement-breakpoint
INSERT INTO website_versions (artifact_id, revision, title, document, saved_at)
SELECT id, revision, title, body, created_at FROM workspace_artifacts WHERE kind = 'website';
