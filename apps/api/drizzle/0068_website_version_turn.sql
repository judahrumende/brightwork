ALTER TABLE website_versions ADD COLUMN turn_id uuid REFERENCES agent_turns(id) ON DELETE SET NULL;
