ALTER TABLE business_runs ADD COLUMN publish_websites boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE publication_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES business_runs(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'published', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  failure text
);
--> statement-breakpoint
CREATE UNIQUE INDEX publication_request_revision ON publication_requests (artifact_id, revision);
--> statement-breakpoint
CREATE INDEX run_publication_queue ON publication_requests (run_id, created_at) WHERE state = 'queued';
