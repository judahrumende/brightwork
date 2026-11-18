CREATE TABLE media_jobs (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'voice')),
  prompt text NOT NULL,
  credits numeric(24,10) NOT NULL CHECK (credits >= 0),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'submitting', 'processing', 'completed', 'failed', 'needs_review')),
  remote_id text,
  lease uuid,
  claim_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  asset bytea,
  mime text,
  CHECK ((asset IS NULL) = (mime IS NULL)),
  CHECK (asset IS NULL OR octet_length(asset) <= 25000000)
);
--> statement-breakpoint
CREATE INDEX media_jobs_claim ON media_jobs (claim_at) WHERE state IN ('queued', 'submitting', 'processing');
--> statement-breakpoint
CREATE INDEX media_jobs_workspace ON media_jobs (business_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE credit_entries DROP CONSTRAINT credit_entries_kind_check;
--> statement-breakpoint
ALTER TABLE credit_entries ADD CHECK (kind IN ('starter','model','tool','subscription','refund','referral','image','video','voice'));
