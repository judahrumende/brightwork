CREATE TABLE workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  UNIQUE (business_id, email)
);
--> statement-breakpoint
CREATE INDEX invitation_inbox ON workspace_invitations(email, expires_at) WHERE accepted_at IS NULL;
--> statement-breakpoint
CREATE TABLE workspace_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  sealed text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN show_notification_badges boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE workspace_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  challenge text NOT NULL,
  verified_at timestamptz,
  UNIQUE (business_id, hostname)
);
