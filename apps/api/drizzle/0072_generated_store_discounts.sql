CREATE TABLE generated_store_discounts (
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code = upper(code) AND code ~ '^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$'),
  percent_off smallint NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
  active boolean NOT NULL DEFAULT true,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, code)
);
--> statement-breakpoint
ALTER TABLE generated_store_orders
  ADD COLUMN discount_code text,
  ADD COLUMN discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD CONSTRAINT generated_store_order_discount_complete CHECK (
    (discount_code IS NULL AND discount_amount = 0)
    OR (discount_code IS NOT NULL AND discount_amount > 0)
  );
