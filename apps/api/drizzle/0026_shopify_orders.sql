CREATE TABLE shopify_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  shop text NOT NULL UNIQUE,
  credentials text,
  connected_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE shopify_orders (
  connection_id uuid NOT NULL REFERENCES shopify_connections(id) ON DELETE CASCADE,
  id text NOT NULL,
  updated_at timestamptz NOT NULL,
  status text,
  cancelled boolean NOT NULL,
  currency text NOT NULL,
  value numeric(24, 8) NOT NULL,
  PRIMARY KEY (connection_id, id)
);
--> statement-breakpoint
CREATE TABLE shopify_deliveries (
  connection_id uuid NOT NULL REFERENCES shopify_connections(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  PRIMARY KEY (connection_id, event_id)
);
