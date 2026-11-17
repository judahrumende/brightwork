ALTER TABLE workspace_artifacts
  ADD COLUMN recurrence text NOT NULL DEFAULT 'once'
    CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly')),
  ADD COLUMN schedule_timezone text NOT NULL DEFAULT 'UTC';
