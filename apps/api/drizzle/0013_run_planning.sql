ALTER TABLE agent_turns ADD COLUMN purpose text NOT NULL DEFAULT 'work'
  CHECK (purpose IN ('work', 'plan'));
--> statement-breakpoint
ALTER TABLE agent_turns ADD COLUMN plan jsonb;
