ALTER TABLE "website_versions" ADD COLUMN "reverted_from_id" uuid REFERENCES "website_versions" ("id") ON DELETE SET NULL;
