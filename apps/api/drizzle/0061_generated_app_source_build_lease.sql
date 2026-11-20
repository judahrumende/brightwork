ALTER TABLE generated_app_source_revisions
  ADD COLUMN build_lease_until timestamptz;

CREATE INDEX generated_app_source_build_lease
  ON generated_app_source_revisions (build_lease_until)
  WHERE build_state = 'building';
