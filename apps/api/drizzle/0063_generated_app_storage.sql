CREATE TABLE generated_app_files (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('live', 'preview')),
  data_revision integer NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 180),
  mime text NOT NULL CHECK (length(mime) BETWEEN 1 AND 120),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, environment, data_revision, id),
  CHECK ((environment = 'live' AND data_revision = 0) OR
         (environment = 'preview' AND data_revision > 0)),
  CHECK (octet_length(bytes) <= 1048576)
);

CREATE INDEX generated_app_files_owner_created
  ON generated_app_files (site_id, environment, data_revision, owner_email, created_at DESC);
