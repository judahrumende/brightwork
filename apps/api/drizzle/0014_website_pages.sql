ALTER TABLE workspace_artifacts ADD COLUMN pages jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE website_versions ADD COLUMN pages jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE website_publications ADD COLUMN pages jsonb NOT NULL DEFAULT '[]'::jsonb;
