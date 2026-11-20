ALTER TABLE media_jobs ADD COLUMN site_id uuid REFERENCES workspace_artifacts(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX media_jobs_site_usage ON media_jobs (site_id, created_at DESC) WHERE site_id IS NOT NULL;
