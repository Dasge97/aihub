CREATE TABLE IF NOT EXISTS capabilities (
    id            text PRIMARY KEY,
    title         text NOT NULL DEFAULT '',
    mode          text NOT NULL DEFAULT 'sync',      -- sync | async | mixed
    service_url   text NOT NULL,
    container     text NOT NULL DEFAULT '',
    routes        jsonb NOT NULL DEFAULT '[]',
    default_model text NOT NULL DEFAULT '',          -- alias en models
    enabled       boolean NOT NULL DEFAULT true,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
    id            serial PRIMARY KEY,
    capability    text NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    alias         text NOT NULL,
    model_id      text NOT NULL,
    adapter       text NOT NULL,                     -- "adapters.mod:Clase"
    version       text NOT NULL DEFAULT '',
    framework     text NOT NULL DEFAULT '',
    est_ram_mb    int  NOT NULL DEFAULT 512,
    params        jsonb NOT NULL DEFAULT '{}',
    idle_unload_s int  NOT NULL DEFAULT 600,
    keep_warm     boolean NOT NULL DEFAULT false,
    enabled       boolean NOT NULL DEFAULT true,
    installed     boolean NOT NULL DEFAULT false,
    notes         text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (capability, alias)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id                 serial PRIMARY KEY,
    name               text NOT NULL,
    prefix             text NOT NULL,
    key_hash           text NOT NULL UNIQUE,
    scopes             text[] NOT NULL DEFAULT '{}',  -- ids de capacidad o {*}
    rate_limit_per_min int NOT NULL DEFAULT 120,
    enabled            boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_used_at       timestamptz
);

CREATE TABLE IF NOT EXISTS request_logs (
    id          bigserial PRIMARY KEY,
    ts          timestamptz NOT NULL DEFAULT now(),
    request_id  text NOT NULL DEFAULT '',
    api_key_id  int,
    source      text NOT NULL DEFAULT 'app',          -- app | playground
    capability  text NOT NULL,
    op          text NOT NULL DEFAULT '',
    model_alias text NOT NULL DEFAULT '',
    status      int NOT NULL,
    latency_ms  int NOT NULL DEFAULT 0,
    error_code  text
);
CREATE INDEX IF NOT EXISTS request_logs_ts_idx ON request_logs (ts);
CREATE INDEX IF NOT EXISTS request_logs_cap_ts_idx ON request_logs (capability, ts);

CREATE TABLE IF NOT EXISTS jobs (
    id          uuid PRIMARY KEY,
    capability  text NOT NULL,
    op          text NOT NULL DEFAULT '',
    api_key_id  int,
    source      text NOT NULL DEFAULT 'app',
    model_alias text NOT NULL DEFAULT 'default',
    status      text NOT NULL DEFAULT 'queued',       -- queued|running|succeeded|failed
    payload     jsonb NOT NULL DEFAULT '{}',
    result      jsonb,
    error       jsonb,
    webhook_url text,
    attempts    int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz,
    latency_ms  int
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (capability, status, created_at);
CREATE INDEX IF NOT EXISTS jobs_key_idx ON jobs (api_key_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
);
