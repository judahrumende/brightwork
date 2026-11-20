CREATE TABLE generated_store_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  order_id uuid NOT NULL,
  event_key text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'accepted', 'failed', 'needs_review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  provider_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generated_store_email_order_fk
    FOREIGN KEY (site_id, order_id)
    REFERENCES generated_store_orders(site_id, id) ON DELETE CASCADE,
  CONSTRAINT generated_store_email_event_unique UNIQUE (site_id, order_id, event_key)
);
--> statement-breakpoint
CREATE INDEX generated_store_email_due ON generated_store_email_outbox(next_check_at)
  WHERE state IN ('queued', 'sending');
