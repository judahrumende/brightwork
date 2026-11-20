CREATE TABLE generated_app_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'record.created', 'record.updated', 'record.deleted', 'record.workflow_action',
    'collection.saved', 'collection.reset',
    'user.role_changed', 'user.removed'
  )),
  target_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX generated_app_activity_site_created
  ON generated_app_activity (site_id, created_at DESC);
