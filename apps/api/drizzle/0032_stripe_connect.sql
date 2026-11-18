CREATE TABLE stripe_sellers (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  account_id text NOT NULL UNIQUE,
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE stripe_sales (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  title text NOT NULL,
  currency text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  amount_refunded integer NOT NULL DEFAULT 0 CHECK (amount_refunded BETWEEN 0 AND amount),
  checkout_id text UNIQUE,
  payment_id text UNIQUE,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX stripe_sales_workspace ON stripe_sales (business_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE stripe_connect_events (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
