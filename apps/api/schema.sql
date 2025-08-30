-- Department of Mysteries minimal schema (D1 / SQLite dialect)

CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS profiles(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  membership TEXT NOT NULL DEFAULT 'NONE', -- 'ACTIVE'|'NONE'
  level INTEGER NOT NULL DEFAULT 1,
  current_xp INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS mp_wallets(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  free_balance INTEGER NOT NULL DEFAULT 0,
  paid_balance INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mp_ledger(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('grant','buy','spend','adjust')),
  mp_kind TEXT NULL CHECK (mp_kind IN ('free','paid')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at INTEGER,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS mp_orders(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pack TEXT DEFAULT 'ether',
  price_cents INTEGER NOT NULL DEFAULT 300,
  grant INTEGER NOT NULL DEFAULT 333,
  stripe_payment_intent TEXT UNIQUE,
  created_at INTEGER
);

-- Idempotency keys for grants/ops (e.g., invoice id or payment_intent)
CREATE TABLE IF NOT EXISTS idempotency_keys(
  key TEXT PRIMARY KEY,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS posts(
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT,
  date INTEGER,
  body_mdx TEXT,
  mp_cost INTEGER NOT NULL DEFAULT 15
);

CREATE TABLE IF NOT EXISTS post_unlocks(
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  unlocked_at INTEGER,
  method TEXT DEFAULT 'mp',
  PRIMARY KEY(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS products(
  id TEXT PRIMARY KEY,
  name TEXT,
  mp_cost INTEGER NOT NULL,
  asset_key TEXT,
  visible INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS purchases(
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS apps(
  id TEXT PRIMARY KEY,
  name TEXT,
  manifest_url TEXT,
  icon_key TEXT,
  visible INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_logs(
  user_id TEXT,
  action TEXT,
  meta TEXT,
  ts INTEGER
);

-- One-time download tokens for R2 assets
CREATE TABLE IF NOT EXISTS download_tokens(
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Magic link tokens (one-time, short TTL)
CREATE TABLE IF NOT EXISTS magic_links(
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  ip TEXT
);

-- Pending auto-top-up transactions, keyed by payment_intent
CREATE TABLE IF NOT EXISTS pending_tx(
  payment_intent TEXT PRIMARY KEY,
  session_id TEXT UNIQUE,
  user_id TEXT NOT NULL,
  cost INTEGER NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  xp_kind TEXT NOT NULL CHECK (xp_kind IN ('article','market')),
  created_at INTEGER
);
