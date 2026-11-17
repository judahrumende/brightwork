ALTER TABLE website_publications ADD COLUMN rollback_source_id uuid
  REFERENCES website_publications(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX website_publication_history ON website_publications(artifact_id, published_at DESC);
