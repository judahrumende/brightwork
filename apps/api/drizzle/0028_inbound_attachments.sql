ALTER TABLE inbound_emails ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
