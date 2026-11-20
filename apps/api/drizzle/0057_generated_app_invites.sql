CREATE TABLE generated_app_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'admin')),
  invited_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, email)
);
CREATE INDEX generated_app_invites_expiry ON generated_app_invites (expires_at);
ALTER TABLE generated_app_activity DROP CONSTRAINT generated_app_activity_action_check;
ALTER TABLE generated_app_activity ADD CONSTRAINT generated_app_activity_action_check
  CHECK (action IN (
    'record.created', 'record.updated', 'record.deleted', 'record.workflow_action',
    'collection.saved', 'collection.reset', 'user.role_changed', 'user.removed', 'user.invited'
  ));
