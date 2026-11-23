ALTER TABLE generated_stores ADD COLUMN direct_checkout boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE stripe_sales ADD COLUMN direct_checkout boolean NOT NULL DEFAULT false;
