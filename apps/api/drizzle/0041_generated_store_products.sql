ALTER TABLE generated_store_products
  ADD COLUMN parent_id uuid,
  ADD COLUMN sku text,
  ADD CONSTRAINT generated_store_product_parent
    FOREIGN KEY (site_id, parent_id) REFERENCES generated_store_products(site_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT generated_store_product_parent_check CHECK (parent_id <> id);
--> statement-breakpoint
CREATE INDEX generated_store_product_variants ON generated_store_products(site_id, parent_id) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX generated_store_product_sku ON generated_store_products(site_id, lower(sku)) WHERE sku IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX generated_store_variant_label ON generated_store_products(site_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE generated_store_product_photos (
  site_id uuid NOT NULL,
  product_id uuid NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 524288),
  alt text NOT NULL CHECK (length(alt) BETWEEN 1 AND 160),
  PRIMARY KEY (site_id, product_id),
  FOREIGN KEY (site_id, product_id) REFERENCES generated_store_products(site_id, id) ON DELETE CASCADE
);
