CREATE TABLE generated_app_source_revisions (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  base_revision integer CHECK (base_revision IS NULL OR base_revision > 0),
  source_files jsonb NOT NULL,
  source_hash text NOT NULL,
  build_state text NOT NULL DEFAULT 'unverified'
    CHECK (build_state IN ('unverified', 'queued', 'building', 'passed', 'failed')),
  build_attempts integer NOT NULL DEFAULT 0 CHECK (build_attempts >= 0),
  build_log text NOT NULL DEFAULT '',
  preview_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  built_at timestamptz,
  PRIMARY KEY (site_id, revision)
);

CREATE INDEX generated_app_source_build_queue
  ON generated_app_source_revisions (build_state, created_at);
