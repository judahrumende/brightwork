CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  language text,
  timezone text,
  browser_language text NOT NULL DEFAULT 'en-US',
  browser_timezone text NOT NULL DEFAULT 'UTC',
  appearance text NOT NULL DEFAULT 'system',
  background text NOT NULL DEFAULT 'clouds',
  reduce_effects boolean NOT NULL DEFAULT false,
  show_predictions boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE auth_identities (
  provider text NOT NULL,
  subject text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject)
);
--> statement-breakpoint
CREATE TABLE auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  link_hash text NOT NULL UNIQUE,
  tries integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  idea text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE business_members (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, account_id)
);
