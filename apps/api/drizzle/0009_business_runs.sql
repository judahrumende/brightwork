CREATE TABLE business_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  creator_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  goal text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'completed', 'failed')),
  credit_limit numeric(24,10) NOT NULL CHECK (credit_limit > 0),
  credits_used numeric(24,10) NOT NULL DEFAULT 0 CHECK (credits_used >= 0 AND credits_used <= credit_limit),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  waiting_for text CHECK (waiting_for IN ('answer', 'approval')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  failure text
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_open_run_per_business ON business_runs (business_id) WHERE state IN ('active', 'paused');
--> statement-breakpoint
CREATE INDEX active_runs_due ON business_runs (next_check_at) WHERE state = 'active';
--> statement-breakpoint
ALTER TABLE agent_turns ADD COLUMN run_id uuid REFERENCES business_runs(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE run_steps (
  run_id uuid NOT NULL REFERENCES business_runs(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  instruction text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  turn_id uuid UNIQUE REFERENCES agent_turns(id) ON DELETE SET NULL,
  completed_at timestamptz,
  PRIMARY KEY (run_id, position)
);
