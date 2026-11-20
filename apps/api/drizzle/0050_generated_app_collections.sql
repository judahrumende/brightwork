ALTER TABLE generated_app_records
  ADD COLUMN collection text NOT NULL DEFAULT 'records'
  CHECK (collection ~ '^[a-z][a-z0-9_-]{0,62}$');

CREATE INDEX generated_app_records_collection_updated
  ON generated_app_records (site_id, collection, updated_at DESC);
