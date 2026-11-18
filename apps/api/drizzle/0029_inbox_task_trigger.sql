ALTER TABLE task_automations ADD COLUMN email_after timestamptz;
--> statement-breakpoint
ALTER TABLE inbound_emails ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT clock_timestamp();
--> statement-breakpoint
CREATE INDEX inbound_email_recorded_idx ON inbound_emails (business_id, recorded_at, id);
--> statement-breakpoint
CREATE TABLE task_email_occurrences (
  task_id uuid NOT NULL REFERENCES task_automations(task_id) ON DELETE CASCADE,
  email_id uuid NOT NULL REFERENCES inbound_emails(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, email_id)
);
