CREATE TABLE stripe_store_refund_requests (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES stripe_sales(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX stripe_store_refund_requests_sale ON stripe_store_refund_requests (sale_id);
