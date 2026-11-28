CREATE TABLE generated_store_buyers (
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, email)
);
--> statement-breakpoint
CREATE TABLE generated_store_signins (
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  email text NOT NULL,
  code_digest text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, id)
);
--> statement-breakpoint
CREATE INDEX generated_store_signins_expiry ON generated_store_signins(site_id, expires_at);
--> statement-breakpoint
CREATE TABLE generated_store_buyer_sessions (
  site_id uuid NOT NULL,
  token_digest text NOT NULL,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, token_digest),
  FOREIGN KEY (site_id, email) REFERENCES generated_store_buyers(site_id, email) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX generated_store_buyer_sessions_expiry ON generated_store_buyer_sessions(site_id, expires_at);
--> statement-breakpoint
CREATE INDEX generated_store_buyer_orders ON generated_store_orders(site_id, email, created_at DESC, id DESC);
