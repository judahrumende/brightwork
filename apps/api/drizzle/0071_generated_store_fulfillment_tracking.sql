ALTER TABLE generated_store_orders
  ADD COLUMN tracking_carrier text,
  ADD COLUMN tracking_number text,
  ADD COLUMN tracking_url text,
  ADD CONSTRAINT generated_store_order_tracking_carrier CHECK (
    tracking_carrier IS NULL OR char_length(btrim(tracking_carrier)) BETWEEN 1 AND 80
  ),
  ADD CONSTRAINT generated_store_order_tracking_number CHECK (
    tracking_number IS NULL OR char_length(btrim(tracking_number)) BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT generated_store_order_tracking_complete CHECK (
    (tracking_carrier IS NULL AND tracking_number IS NULL AND tracking_url IS NULL)
    OR (tracking_carrier IS NOT NULL AND tracking_number IS NOT NULL
      AND tracking_url LIKE 'https://%' AND char_length(tracking_url) BETWEEN 9 AND 2048)
  );
