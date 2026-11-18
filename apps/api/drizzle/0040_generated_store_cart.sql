CREATE TABLE generated_store_order_lines (
  site_id uuid NOT NULL,
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  unit_price integer NOT NULL CHECK (unit_price BETWEEN 1 AND 100000000),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  PRIMARY KEY (site_id, order_id, product_id),
  FOREIGN KEY (site_id, order_id) REFERENCES generated_store_orders(site_id, id) ON DELETE CASCADE,
  FOREIGN KEY (site_id, product_id) REFERENCES generated_store_products(site_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO generated_store_order_lines(site_id, order_id, product_id, product_name, unit_price, quantity)
SELECT site_id, id, product_id, product_name, unit_price, quantity FROM generated_store_orders;
