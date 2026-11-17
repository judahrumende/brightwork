CREATE TABLE email_delivery_events (
  id text PRIMARY KEY,
  provider_id text NOT NULL,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX email_delivery_provider ON email_delivery_events (provider_id, occurred_at DESC);
