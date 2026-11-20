CREATE TABLE generated_app_records (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, id)
);
CREATE INDEX generated_app_records_site_updated ON generated_app_records (site_id, updated_at DESC);
