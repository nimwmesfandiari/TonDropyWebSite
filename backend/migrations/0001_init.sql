-- TonDropy exchange: initial schema.
-- Money is stored as INTEGER minor units: TON = 9 decimals, USDT = 6, IRT (toman) = 0.
-- The application caps single amounts well below 2^53 (see backend/src/lib/money.js).

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   INTEGER NOT NULL UNIQUE,
  username      TEXT,
  first_name    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','system')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  kyc_level     INTEGER NOT NULL DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 2),
  referral_code TEXT NOT NULL UNIQUE,
  referred_by   INTEGER REFERENCES users(id),
  deposit_tag   TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX idx_users_referred_by ON users(referred_by);

-- user_id = 1 is the house (system) account. It may go negative; users may not.
CREATE TABLE balances (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  asset     TEXT NOT NULL CHECK (asset IN ('TON','USDT','IRT')),
  available INTEGER NOT NULL DEFAULT 0,
  locked    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, asset),
  CHECK (user_id = 1 OR (available >= 0 AND locked >= 0))
);

-- Append-only journal. Every balance change writes exactly one row here.
CREATE TABLE ledger_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  asset         TEXT NOT NULL,
  delta         INTEGER NOT NULL DEFAULT 0,        -- change of balances.available
  locked_delta  INTEGER NOT NULL DEFAULT 0,        -- change of balances.locked
  kind          TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ledger_user ON ledger_entries(user_id, id DESC);
CREATE INDEX idx_ledger_ref ON ledger_entries(ref_type, ref_id);
-- Exactly-once guards. A second attempt violates the index, which aborts and
-- rolls back the whole D1 batch (balance update included).
CREATE UNIQUE INDEX ux_ledger_deposit_credit ON ledger_entries(ref_id)
  WHERE kind = 'deposit_credit';
CREATE UNIQUE INDEX ux_ledger_withdraw_lock ON ledger_entries(ref_id)
  WHERE kind = 'withdraw_lock';
CREATE UNIQUE INDEX ux_ledger_withdraw_final ON ledger_entries(ref_id)
  WHERE kind IN ('withdraw_unlock', 'withdraw_settle');

CREATE TABLE quotes (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  pair          TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy','sell')),
  base_asset    TEXT NOT NULL,
  quote_asset   TEXT NOT NULL,
  base_amount   INTEGER NOT NULL CHECK (base_amount > 0),
  quote_amount  INTEGER NOT NULL CHECK (quote_amount > 0),
  fee           INTEGER NOT NULL CHECK (fee >= 0),
  price_e8      INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_quotes_expires ON quotes(expires_at);

CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  quote_id      TEXT NOT NULL UNIQUE REFERENCES quotes(id),
  pair          TEXT NOT NULL,
  side          TEXT NOT NULL,
  base_asset    TEXT NOT NULL,
  quote_asset   TEXT NOT NULL,
  base_amount   INTEGER NOT NULL,
  quote_amount  INTEGER NOT NULL,
  fee           INTEGER NOT NULL,
  price_e8      INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'filled' CHECK (status IN ('filled','failed')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE deposits (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  asset         TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL CHECK (method IN ('chain','fiat_receipt')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','rejected')),
  reference     TEXT,
  tx_hash       TEXT UNIQUE,
  note          TEXT,
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_deposits_user ON deposits(user_id, created_at DESC);
CREATE INDEX idx_deposits_status ON deposits(status, created_at);

CREATE TABLE withdrawals (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  asset         TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  fee           INTEGER NOT NULL CHECK (fee >= 0),
  destination   TEXT NOT NULL,
  memo          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','completed','rejected')),
  tx_hash       TEXT,
  reject_reason TEXT,
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
CREATE INDEX idx_withdrawals_status ON withdrawals(status, created_at);

CREATE TABLE kyc_submissions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  full_name     TEXT NOT NULL,          -- AES-GCM encrypted (see lib/fieldcrypto.js)
  national_id   TEXT NOT NULL,          -- AES-GCM encrypted
  national_id_hash TEXT NOT NULL,       -- HMAC blind index for duplicate detection
  birth_date    TEXT NOT NULL,          -- AES-GCM encrypted
  doc_front_key TEXT NOT NULL,
  doc_selfie_key TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_kyc_user ON kyc_submissions(user_id, created_at DESC);
CREATE INDEX idx_kyc_status ON kyc_submissions(status, created_at);
CREATE INDEX idx_kyc_nid ON kyc_submissions(national_id_hash, status);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, id DESC);

CREATE TABLE referral_rewards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL REFERENCES users(id),
  referee_id  INTEGER NOT NULL REFERENCES users(id),
  order_id    TEXT NOT NULL REFERENCES orders(id),
  asset       TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_referral_rewards_referrer ON referral_rewards(referrer_id);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER,
  action     TEXT NOT NULL,
  target     TEXT,
  meta       TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE kv_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- House account (id 1) with zero balances for each asset.
INSERT INTO users (id, telegram_id, username, first_name, role, kyc_level, referral_code, deposit_tag, created_at)
VALUES (1, -1, 'house', 'House', 'system', 2, 'HOUSE000', 'HOUSE000', 0);
INSERT INTO balances (user_id, asset) VALUES (1,'TON'),(1,'USDT'),(1,'IRT');
