ALTER TABLE workspace_artifacts ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);
--> statement-breakpoint
ALTER TABLE website_publications ADD COLUMN draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision >= 1);
