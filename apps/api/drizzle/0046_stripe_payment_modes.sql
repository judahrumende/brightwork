ALTER TABLE stripe_sellers ADD COLUMN mode text NOT NULL DEFAULT 'test'
  CHECK (mode IN ('test', 'live'));
ALTER TABLE stripe_sellers DROP CONSTRAINT stripe_sellers_pkey;
ALTER TABLE stripe_sellers DROP CONSTRAINT stripe_sellers_account_id_key;
ALTER TABLE stripe_sellers ADD CONSTRAINT stripe_sellers_pkey PRIMARY KEY (business_id, mode);
ALTER TABLE stripe_sellers ADD CONSTRAINT stripe_sellers_account_mode_key UNIQUE (account_id, mode);
--> statement-breakpoint
ALTER TABLE stripe_sales ADD COLUMN mode text NOT NULL DEFAULT 'test'
  CHECK (mode IN ('test', 'live'));
ALTER TABLE stripe_sales DROP CONSTRAINT stripe_sales_checkout_id_key;
ALTER TABLE stripe_sales DROP CONSTRAINT stripe_sales_payment_id_key;
ALTER TABLE stripe_sales ADD CONSTRAINT stripe_sales_mode_checkout_key UNIQUE (mode, checkout_id);
ALTER TABLE stripe_sales ADD CONSTRAINT stripe_sales_mode_payment_key UNIQUE (mode, payment_id);
CREATE INDEX stripe_sales_workspace_mode ON stripe_sales (business_id, mode, created_at DESC);
--> statement-breakpoint
ALTER TABLE generated_stores ADD COLUMN payment_mode text NOT NULL DEFAULT 'test'
  CHECK (payment_mode IN ('test', 'live'));
--> statement-breakpoint
ALTER TABLE stripe_connect_events ADD COLUMN mode text NOT NULL DEFAULT 'test'
  CHECK (mode IN ('test', 'live'));
ALTER TABLE stripe_connect_events DROP CONSTRAINT stripe_connect_events_pkey;
ALTER TABLE stripe_connect_events ADD CONSTRAINT stripe_connect_events_pkey PRIMARY KEY (mode, id);
