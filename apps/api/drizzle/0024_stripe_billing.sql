CREATE TABLE billing_customers (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  customer_id text NOT NULL UNIQUE,
  subscription_id text,
  state text NOT NULL DEFAULT 'free',
  period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE billing_events (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE credit_entries DROP CONSTRAINT credit_entries_kind_check;
ALTER TABLE credit_entries ADD CHECK (kind IN ('starter', 'model', 'tool', 'subscription', 'refund'));
