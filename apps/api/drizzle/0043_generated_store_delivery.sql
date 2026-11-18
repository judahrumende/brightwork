ALTER TABLE generated_stores
  ADD COLUMN delivery_zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN delivery_revision integer NOT NULL DEFAULT 0 CHECK (delivery_revision >= 0);
--> statement-breakpoint
ALTER TABLE generated_store_orders ADD COLUMN delivery jsonb;
--> statement-breakpoint
CREATE TABLE generated_store_delivery_quotes (
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  input jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  buyer_email text,
  delivery_revision integer NOT NULL,
  currency text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, id)
);
--> statement-breakpoint
CREATE INDEX generated_store_delivery_quotes_expiry ON generated_store_delivery_quotes(expires_at);
