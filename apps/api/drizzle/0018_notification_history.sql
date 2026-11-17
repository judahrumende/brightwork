CREATE TABLE workspace_notifications (
  id serial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (business_id, key)
);
--> statement-breakpoint
CREATE INDEX workspace_notifications_history ON workspace_notifications(business_id, id DESC);
--> statement-breakpoint
CREATE INDEX workspace_notifications_open ON workspace_notifications(artifact_id) WHERE resolved_at IS NULL;
--> statement-breakpoint
INSERT INTO workspace_notifications (business_id, artifact_id, key, title, created_at, resolved_at)
SELECT business_id, id,
  CASE WHEN kind = 'question' THEN 'question:' || id
       ELSE 'creation:' || id || ':' || revision END,
  title, created_at,
  CASE WHEN kind = 'question' THEN answered_at
       WHEN state <> 'pending' THEN created_at END
FROM workspace_artifacts
WHERE kind = 'question' OR state IN ('pending', 'approved', 'rejected')
ORDER BY created_at, id;
--> statement-breakpoint
CREATE FUNCTION record_workspace_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_key text;
BEGIN
  IF NEW.kind = 'question' AND NEW.answer IS NULL THEN
    current_key := 'question:' || NEW.id;
  ELSIF NEW.kind <> 'question' AND NEW.state = 'pending' THEN
    current_key := 'creation:' || NEW.id || ':' || NEW.revision;
  END IF;

  UPDATE workspace_notifications
  SET resolved_at = now()
  WHERE artifact_id = NEW.id AND resolved_at IS NULL AND key IS DISTINCT FROM current_key;

  IF current_key IS NOT NULL THEN
    INSERT INTO workspace_notifications (business_id, artifact_id, key, title)
    VALUES (NEW.business_id, NEW.id, current_key, NEW.title)
    ON CONFLICT (business_id, key) DO UPDATE SET resolved_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_artifact_notification
AFTER INSERT OR UPDATE OF kind, state, revision, answer ON workspace_artifacts
FOR EACH ROW EXECUTE FUNCTION record_workspace_notification();
