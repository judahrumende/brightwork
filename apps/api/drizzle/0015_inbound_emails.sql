CREATE TABLE inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  sender text NOT NULL,
  subject text NOT NULL,
  body text,
  html text,
  received_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbound_email_delivery_idx ON inbound_emails (provider_id, business_id);
--> statement-breakpoint
CREATE INDEX inbound_email_inbox_idx ON inbound_emails (business_id, received_at);
