CREATE TABLE generated_app_users (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, id),
  UNIQUE (site_id, email)
);

CREATE INDEX generated_app_users_site_created
  ON generated_app_users (site_id, created_at DESC);

CREATE TABLE generated_app_signins (
  site_id uuid NOT NULL REFERENCES workspace_artifacts(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_digest text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, id)
);

CREATE INDEX generated_app_signins_expiry
  ON generated_app_signins (expires_at);

CREATE TABLE generated_app_sessions (
  site_id uuid NOT NULL,
  email text NOT NULL,
  token_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, token_digest),
  FOREIGN KEY (site_id, email)
    REFERENCES generated_app_users(site_id, email) ON DELETE CASCADE
);

CREATE INDEX generated_app_sessions_expiry
  ON generated_app_sessions (expires_at);
