CREATE TABLE generated_store_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  kind text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX generated_store_activity_recent
  ON generated_store_activity (site_id, created_at DESC, id DESC);
