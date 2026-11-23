ALTER TABLE stripe_sales ADD COLUMN checkout_attempted_at timestamptz;
--> statement-breakpoint
ALTER TABLE stripe_sales ADD COLUMN closed_at timestamptz;
--> statement-breakpoint
UPDATE stripe_sales SET checkout_attempted_at = created_at WHERE checkout_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE generated_store_orders ADD COLUMN sale_id uuid UNIQUE REFERENCES stripe_sales(id);
