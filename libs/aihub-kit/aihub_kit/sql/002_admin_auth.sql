CREATE TABLE IF NOT EXISTS admin_users (
    id            serial PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    password_salt text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash   text PRIMARY KEY,
    user_id      int NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions (user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);
