ALTER TABLE inbound_emails ADD COLUMN message_id text;
ALTER TABLE inbound_emails ADD COLUMN thread_id uuid NOT NULL DEFAULT gen_random_uuid();
--> statement-breakpoint
CREATE INDEX inbound_message_identity ON inbound_emails(business_id, message_id);
CREATE INDEX inbound_thread_messages ON inbound_emails(business_id, thread_id, received_at);
--> statement-breakpoint
ALTER TABLE workspace_artifacts ADD COLUMN reply_recipient text;
ALTER TABLE workspace_artifacts ADD COLUMN reply_message_id text;
ALTER TABLE outbound_emails ADD COLUMN reply_to text;
ALTER TABLE outbound_emails ADD COLUMN in_reply_to text;
