ALTER TABLE credit_entries DROP CONSTRAINT credit_entries_kind_check;
--> statement-breakpoint
ALTER TABLE credit_entries ADD CHECK (kind IN ('starter','model','tool','subscription','refund','referral','image','video','voice','storage'));
