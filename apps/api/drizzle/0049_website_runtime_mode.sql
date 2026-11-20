ALTER TABLE website_versions ADD COLUMN runtime_mode text NOT NULL DEFAULT 'static' CHECK (runtime_mode IN ('static', 'store', 'app'));
ALTER TABLE website_publications ADD COLUMN runtime_mode text NOT NULL DEFAULT 'static' CHECK (runtime_mode IN ('static', 'store', 'app'));
UPDATE website_versions SET runtime_mode = 'store' WHERE artifact_id IN (SELECT site_id FROM generated_stores);
UPDATE website_publications SET runtime_mode = 'store' WHERE artifact_id IN (SELECT site_id FROM generated_stores);
