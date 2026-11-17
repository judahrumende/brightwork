CREATE TABLE task_automations (
  task_id uuid PRIMARY KEY REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  creator_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  next_at timestamptz,
  check_at timestamptz NOT NULL DEFAULT now(),
  turn_id uuid UNIQUE REFERENCES agent_turns(id) ON DELETE SET NULL,
  last_scheduled_at timestamptz
);
--> statement-breakpoint
CREATE INDEX task_automation_check ON task_automations (check_at) WHERE enabled;
