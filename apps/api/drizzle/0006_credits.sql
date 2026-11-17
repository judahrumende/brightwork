CREATE TABLE credit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES agent_turns(id) ON DELETE SET NULL,
  operation_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('starter', 'model', 'tool')),
  amount numeric(24, 10) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, operation_key)
);
