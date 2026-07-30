ALTER TABLE users ADD COLUMN password_hash text;

CREATE TABLE sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL,
  token_hash text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6), last_seen_at timestamptz(6) NOT NULL DEFAULT now(), ip_address text, user_agent text,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at), CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sessions_user_active_idx ON sessions (organization_id, user_id, revoked_at, expires_at);
CREATE INDEX sessions_token_active_idx ON sessions (organization_id, token_hash, revoked_at, expires_at);

CREATE TABLE password_reset_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL,
  token_hash text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), expires_at timestamptz(6) NOT NULL,
  used_at timestamptz(6), ip_address text, user_agent text,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at), CHECK (used_at IS NULL OR used_at >= created_at)
);
CREATE INDEX password_reset_tokens_user_lookup_idx ON password_reset_tokens (organization_id, user_id, used_at, expires_at);

CREATE TABLE failed_login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, normalized_email text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0, window_started_at timestamptz(6) NOT NULL,
  locked_until timestamptz(6), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, normalized_email),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CHECK (failed_count >= 0)
);
CREATE INDEX failed_login_attempts_locked_idx ON failed_login_attempts (organization_id, locked_until);
