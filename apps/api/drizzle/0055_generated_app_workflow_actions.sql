ALTER TABLE generated_app_collections
  ADD COLUMN actions jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(actions) = 'array');
