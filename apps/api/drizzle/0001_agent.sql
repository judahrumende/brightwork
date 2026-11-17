CREATE TABLE agent_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  creator_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  prompt text NOT NULL,
  answer text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'queued',
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX agent_turns_business_time ON agent_turns(business_id, created_at);
--> statement-breakpoint
CREATE TABLE workspace_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES agent_turns(id) ON DELETE SET NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX workspace_artifacts_business_time ON workspace_artifacts(business_id, created_at);
