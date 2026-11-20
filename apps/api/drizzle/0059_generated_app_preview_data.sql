ALTER TABLE generated_app_records
  ADD COLUMN environment text NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live', 'preview')),
  ADD COLUMN data_revision integer NOT NULL DEFAULT 0
    CHECK (data_revision >= 0);
ALTER TABLE generated_app_records
  ADD CONSTRAINT generated_app_records_environment_revision_check
  CHECK ((environment = 'live' AND data_revision = 0)
      OR (environment = 'preview' AND data_revision > 0));
ALTER TABLE generated_app_records DROP CONSTRAINT generated_app_records_pkey;
ALTER TABLE generated_app_records ADD CONSTRAINT generated_app_records_pkey
  PRIMARY KEY (site_id, environment, data_revision, id);
CREATE INDEX generated_app_records_environment_updated
  ON generated_app_records (site_id, environment, data_revision, collection, updated_at DESC);
--> statement-breakpoint
ALTER TABLE generated_app_activity
  ADD COLUMN environment text NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live', 'preview')),
  ADD COLUMN data_revision integer NOT NULL DEFAULT 0
    CHECK (data_revision >= 0);
ALTER TABLE generated_app_activity
  ADD CONSTRAINT generated_app_activity_environment_revision_check
  CHECK ((environment = 'live' AND data_revision = 0)
      OR (environment = 'preview' AND data_revision > 0));
CREATE INDEX generated_app_activity_environment_created
  ON generated_app_activity (site_id, environment, data_revision, created_at DESC);
