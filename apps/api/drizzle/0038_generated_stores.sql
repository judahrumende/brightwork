CREATE TABLE generated_stores (
  site_id uuid PRIMARY KEY REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  first_revision integer NOT NULL CHECK (first_revision > 0),
  currency text NOT NULL CHECK (currency IN ('AUD','USD','EUR','GBP','CAD','NZD'))
);
--> statement-breakpoint
CREATE TABLE generated_store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  stock integer NOT NULL CHECK (stock BETWEEN 0 AND 1000000),
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (site_id, id)
);
--> statement-breakpoint
CREATE TABLE generated_store_orders (
  site_id uuid NOT NULL REFERENCES generated_stores(site_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  unit_price integer NOT NULL CHECK (unit_price > 0),
  currency text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  email text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','fulfilled','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id, product_id) REFERENCES generated_store_products(site_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX generated_store_orders_recent ON generated_store_orders(site_id, created_at DESC);
