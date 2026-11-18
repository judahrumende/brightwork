CREATE TABLE referral_codes (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
--> statement-breakpoint
CREATE TABLE referrals (
  referred_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  referrer_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invoice_id text UNIQUE,
  refunded boolean NOT NULL DEFAULT false,
  CHECK (referred_id <> referrer_id)
);
--> statement-breakpoint
CREATE INDEX referrals_referrer ON referrals (referrer_id);
--> statement-breakpoint
ALTER TABLE credit_entries DROP CONSTRAINT credit_entries_kind_check;
--> statement-breakpoint
ALTER TABLE credit_entries ADD CHECK (kind IN ('starter', 'model', 'tool', 'subscription', 'refund', 'referral'));
