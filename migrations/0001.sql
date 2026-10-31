PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','suspended','revoked')),
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1)), session_version INTEGER NOT NULL DEFAULT 0,
  revoke_before INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL UNIQUE,
  access_app_id TEXT, audience TEXT, access_mode TEXT NOT NULL CHECK(access_mode IN ('native','gate','owner_only','external')),
  description TEXT NOT NULL DEFAULT '', limitation TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  managed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
  user_id TEXT NOT NULL REFERENCES users(id), app_id TEXT NOT NULL REFERENCES apps(id),
  role TEXT NOT NULL CHECK(role IN ('administrator','operator','editor','viewer','guild_member','access','denied')),
  updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,app_id)
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS group_grants (
  group_id TEXT NOT NULL REFERENCES groups(id), app_id TEXT NOT NULL REFERENCES apps(id), role TEXT NOT NULL,
  updated_at INTEGER NOT NULL, PRIMARY KEY(group_id,app_id)
);
CREATE TABLE IF NOT EXISTS default_grants (
  app_id TEXT PRIMARY KEY REFERENCES apps(id), role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('google','owner','guild')),
  user_id TEXT REFERENCES users(id), version INTEGER NOT NULL, guild_version INTEGER,
  csrf_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS guild_access (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0, password_hash TEXT, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
INSERT OR IGNORE INTO guild_access(id,enabled,version,updated_at) VALUES(1,0,0,0);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT, app_id TEXT, outcome TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor,at DESC);
CREATE TABLE IF NOT EXISTS app_activity (user_id TEXT NOT NULL, app_id TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY(user_id,app_id));
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_expiry ON rate_limits(reset_at);
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY COLLATE NOCASE, rewards TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  historical INTEGER NOT NULL DEFAULT 0, baseline INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unverified', source_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT, restrictions TEXT, announced_at TEXT, last_changed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_status ON codes(status,first_seen DESC);
CREATE TABLE IF NOT EXISTS code_evidence (
  code TEXT NOT NULL REFERENCES codes(code), source_id TEXT NOT NULL, source_url TEXT NOT NULL, source_domain TEXT NOT NULL,
  source_status TEXT NOT NULL, rewards TEXT, observed_at INTEGER NOT NULL, expires_at TEXT, announced_at TEXT, restrictions TEXT,
  snapshot_generation INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(code,source_id)
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  last_checked INTEGER, last_success INTEGER, last_error TEXT, last_status INTEGER, last_count INTEGER NOT NULL DEFAULT 0, backoff_until INTEGER NOT NULL DEFAULT 0,
  snapshot_hash TEXT, current_generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  next_allowed INTEGER NOT NULL DEFAULT 0, last_started INTEGER, last_finished INTEGER, last_success INTEGER,
  baseline_completed INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_trigger TEXT
);
INSERT OR IGNORE INTO scan_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS scan_runs (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, finished_at INTEGER, trigger TEXT NOT NULL, status TEXT NOT NULL, source_ok INTEGER NOT NULL DEFAULT 0, source_failed INTEGER NOT NULL DEFAULT 0, discovered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS redemptions (subject TEXT NOT NULL, code TEXT NOT NULL REFERENCES codes(code), redeemed_at INTEGER NOT NULL, PRIMARY KEY(subject,code));
CREATE TABLE IF NOT EXISTS reports (
  user_id TEXT NOT NULL REFERENCES users(id), code TEXT NOT NULL REFERENCES codes(code), outcome TEXT NOT NULL CHECK(outcome IN ('working','failed')),
  note TEXT NOT NULL DEFAULT '', reported_at INTEGER NOT NULL, PRIMARY KEY(user_id,code)
);
CREATE TABLE IF NOT EXISTS notifications (code TEXT PRIMARY KEY REFERENCES codes(code), state TEXT NOT NULL CHECK(state IN ('suppressed','pending','sent','failed')), created_at INTEGER NOT NULL, sent_at INTEGER, error TEXT);
