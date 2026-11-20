CREATE TABLE generated_app_jobs (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('live', 'preview')),
  data_revision integer NOT NULL,
  schema_revision integer NOT NULL CHECK (schema_revision > 0),
  id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_email text NOT NULL,
  collection text NOT NULL CHECK (collection ~ '^[a-z][a-z0-9_-]{0,62}$'),
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_-]{0,62}$'),
  run_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
  lease uuid,
  lease_until timestamptz,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (site_id, environment, data_revision, id),
  CHECK ((environment = 'live' AND data_revision = 0) OR
         (environment = 'preview' AND data_revision > 0))
);

CREATE INDEX generated_app_jobs_due
  ON generated_app_jobs (run_at, created_at)
  WHERE state = 'queued';

CREATE INDEX generated_app_jobs_lease
  ON generated_app_jobs (lease_until)
  WHERE state = 'running';

CREATE INDEX generated_app_jobs_actor
  ON generated_app_jobs (site_id, environment, data_revision, actor_email, created_at DESC);
