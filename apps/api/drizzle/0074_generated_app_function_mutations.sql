CREATE TABLE generated_app_function_mutations (
  invocation_id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX generated_app_function_mutations_expiry
  ON generated_app_function_mutations (expires_at);
