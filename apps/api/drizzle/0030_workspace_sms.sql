CREATE TABLE sms_connections (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  account_sid text NOT NULL,
  number_sid text NOT NULL,
  phone text UNIQUE NOT NULL,
  token text
);
--> statement-breakpoint
CREATE TABLE sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES sms_connections(business_id) ON DELETE CASCADE,
  provider_id text,
  peer text NOT NULL,
  direction text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  opt_out boolean,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (business_id, provider_id)
);
--> statement-breakpoint
CREATE INDEX sms_messages_workspace ON sms_messages (business_id, created_at DESC, id);
--> statement-breakpoint
CREATE INDEX sms_messages_consent ON sms_messages (business_id, peer, created_at DESC, id) WHERE opt_out IS NOT NULL;
