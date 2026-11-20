ALTER TABLE generated_app_records
  ADD COLUMN owner_email text;

CREATE TABLE generated_app_collections (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{0,62}$'),
  read_access text NOT NULL DEFAULT 'public'
    CHECK (read_access IN ('public', 'authenticated', 'admin')),
  write_access text NOT NULL DEFAULT 'public'
    CHECK (write_access IN ('public', 'authenticated', 'admin')),
  owner_scoped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, name),
  CHECK (NOT owner_scoped OR (read_access <> 'public' AND write_access <> 'public'))
);
