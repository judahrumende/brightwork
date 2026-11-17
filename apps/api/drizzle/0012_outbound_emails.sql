CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  revision integer NOT NULL CHECK (revision > 0),
  recipient text NOT NULL,
  sender text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'accepted', 'failed', 'needs_review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  provider_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX outbound_email_revision ON outbound_emails (artifact_id, revision);
--> statement-breakpoint
CREATE INDEX outbound_email_due ON outbound_emails (next_check_at) WHERE state IN ('queued', 'sending');
