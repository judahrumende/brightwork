ALTER TABLE generated_app_collections
  ADD COLUMN fields jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(fields) = 'array');
