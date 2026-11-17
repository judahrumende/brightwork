CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  location text NOT NULL DEFAULT '',
  attendees text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  CONSTRAINT calendar_event_positive_duration CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX calendar_events_business_starts_idx ON calendar_events (business_id, starts_at);
