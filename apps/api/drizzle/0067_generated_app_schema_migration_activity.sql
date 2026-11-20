ALTER TABLE generated_app_activity DROP CONSTRAINT generated_app_activity_action_check;
ALTER TABLE generated_app_activity ADD CONSTRAINT generated_app_activity_action_check
  CHECK (action IN (
    'record.created', 'record.updated', 'record.deleted', 'record.workflow_action',
    'record.schema_migrated', 'collection.saved', 'collection.reset',
    'user.role_changed', 'user.removed', 'user.invited', 'file.deleted'
  ));
