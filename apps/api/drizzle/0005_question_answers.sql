ALTER TABLE workspace_artifacts
  ADD COLUMN answer text,
  ADD COLUMN answered_at timestamptz;
