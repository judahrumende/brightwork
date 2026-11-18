CREATE TABLE meta_page_connections (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  page_id text NOT NULL UNIQUE,
  name text NOT NULL,
  token text
);
--> statement-breakpoint
CREATE TABLE meta_page_comments (
  business_id uuid NOT NULL REFERENCES meta_page_connections(business_id) ON DELETE CASCADE,
  id text NOT NULL,
  post_id text NOT NULL,
  parent_id text NOT NULL,
  body text,
  own_page boolean NOT NULL,
  hidden boolean NOT NULL,
  removed boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (business_id, id)
);
--> statement-breakpoint
CREATE INDEX meta_page_comments_recent ON meta_page_comments(business_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE meta_page_replies (
  business_id uuid NOT NULL REFERENCES meta_page_connections(business_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  comment_id text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'sending',
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, id)
);
