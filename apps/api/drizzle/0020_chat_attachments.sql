CREATE TABLE chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL CHECK (octet_length(content) <= 24576)
);
--> statement-breakpoint
CREATE INDEX chat_attachments_turn ON chat_attachments(turn_id);
--> statement-breakpoint
CREATE INDEX agent_turns_chat_history ON agent_turns(business_id, created_at DESC, id DESC);
