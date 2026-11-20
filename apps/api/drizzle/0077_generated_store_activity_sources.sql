ALTER TABLE generated_store_activity ADD COLUMN source_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX generated_store_activity_source_key
  ON generated_store_activity (source_key) WHERE source_key IS NOT NULL;
