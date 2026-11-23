ALTER TABLE stripe_sales
  ADD COLUMN checkout_hold_until timestamptz,
  ADD COLUMN checkout_recover_at timestamptz;
--> statement-breakpoint
UPDATE stripe_sales
SET checkout_recover_at = created_at + interval '45 minutes'
WHERE direct_checkout AND closed_at IS NULL AND paid_at IS NULL;
--> statement-breakpoint
CREATE INDEX stripe_sales_checkout_recovery
ON stripe_sales(checkout_recover_at, id)
WHERE direct_checkout AND closed_at IS NULL AND paid_at IS NULL;
