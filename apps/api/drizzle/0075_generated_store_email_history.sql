CREATE INDEX generated_store_email_history
  ON generated_store_email_outbox (site_id, created_at DESC, id DESC);
