CREATE TABLE run_events (
  id serial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES business_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE INDEX run_events_history ON run_events(run_id, id DESC);
--> statement-breakpoint
INSERT INTO run_events (run_id, kind, detail, created_at)
SELECT id, 'started', goal, created_at FROM business_runs;
--> statement-breakpoint
INSERT INTO run_events (run_id, kind, detail, created_at)
SELECT id, state, coalesce(failure, ''), coalesce(ended_at, created_at)
FROM business_runs WHERE state <> 'active';
--> statement-breakpoint
CREATE FUNCTION record_run_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO run_events (run_id, kind, detail) VALUES (NEW.id, 'started', NEW.goal);
  ELSE
    IF OLD.state IS DISTINCT FROM NEW.state THEN
      INSERT INTO run_events (run_id, kind, detail)
      VALUES (NEW.id, CASE WHEN NEW.state = 'active' THEN 'resumed' ELSE NEW.state END, coalesce(NEW.failure, ''));
    END IF;
    IF OLD.waiting_for IS DISTINCT FROM NEW.waiting_for THEN
      INSERT INTO run_events (run_id, kind, detail)
      VALUES (NEW.id, CASE WHEN NEW.waiting_for IS NULL THEN 'unblocked' ELSE 'waiting' END,
              coalesce(NEW.waiting_for, OLD.waiting_for));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_run_history AFTER INSERT OR UPDATE OF state, waiting_for ON business_runs
FOR EACH ROW EXECUTE FUNCTION record_run_change();
--> statement-breakpoint
CREATE FUNCTION record_run_step_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO run_events (run_id, kind, detail) VALUES (NEW.run_id, 'planned', NEW.instruction);
  ELSIF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    INSERT INTO run_events (run_id, kind, detail) VALUES (NEW.run_id, 'step_finished', NEW.instruction);
  ELSIF NEW.turn_id IS NOT NULL AND NEW.turn_id IS DISTINCT FROM OLD.turn_id THEN
    INSERT INTO run_events (run_id, kind, detail) VALUES (NEW.run_id, 'step_queued', NEW.instruction);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER run_step_history AFTER INSERT OR UPDATE OF completed_at, turn_id ON run_steps
FOR EACH ROW EXECUTE FUNCTION record_run_step_change();
