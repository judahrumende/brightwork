CREATE OR REPLACE VIEW commerce_insight_facts AS
SELECT connection.business_id, 'shopify'::text AS source, orders.processed_at AS occurred_at,
       orders.currency, orders.gross_received AS gross, orders.amount_refunded AS refunded,
       orders.customer_key, NULL::text AS payment_mode
FROM shopify_orders AS orders
JOIN shopify_connections AS connection ON connection.id = orders.connection_id
WHERE orders.gross_received > 0 AND orders.amount_refunded IS NOT NULL AND orders.processed_at IS NOT NULL
UNION ALL
SELECT business_id, 'stripe'::text, paid_at, upper(currency),
       amount::numeric / unit.scale, amount_refunded::numeric / unit.scale,
       customer_key, mode AS payment_mode
FROM stripe_sales
CROSS JOIN LATERAL (SELECT CASE
  WHEN currency IN ('bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','vnd','vuv','xaf','xof','xpf') THEN 1
  WHEN currency IN ('bhd','jod','kwd','omr','tnd') THEN 1000
  ELSE 100 END AS scale) AS unit
WHERE paid_at IS NOT NULL;
