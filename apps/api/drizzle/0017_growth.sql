CREATE TABLE "social_publications" (
  "artifact_id" uuid PRIMARY KEY REFERENCES "workspace_artifacts"("id") ON DELETE CASCADE,
  "actor_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "revision" integer NOT NULL,
  "page_id" text NOT NULL,
  "state" text NOT NULL CHECK ("state" IN ('publishing', 'published', 'unknown')),
  "remote_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ad_wallet_budgets" (
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "currency" text NOT NULL,
  "monthly_target" numeric(11,2) NOT NULL CHECK ("monthly_target" >= 0),
  PRIMARY KEY ("business_id", "account_id", "currency")
);
