ALTER TABLE generated_app_collections ADD COLUMN revision integer;

UPDATE generated_app_collections collection
SET revision = coalesce(
  (SELECT publication.draft_revision
   FROM website_publications publication
   WHERE publication.artifact_id = collection.site_id
     AND publication.unpublished_at IS NULL
   ORDER BY publication.published_at DESC
   LIMIT 1),
  (SELECT site.revision FROM workspace_artifacts site WHERE site.id = collection.site_id)
);

ALTER TABLE generated_app_collections ALTER COLUMN revision SET NOT NULL;
ALTER TABLE generated_app_collections DROP CONSTRAINT generated_app_collections_pkey;
ALTER TABLE generated_app_collections ADD CONSTRAINT generated_app_collections_pkey
  PRIMARY KEY (site_id, revision, name);
