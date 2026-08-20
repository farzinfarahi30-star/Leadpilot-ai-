PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 business_name TEXT DEFAULT '',
 plan TEXT DEFAULT 'trial',
 status TEXT DEFAULT 'active',
 stripe_customer_id TEXT,
 stripe_subscription_id TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS onboarding (
 account_id TEXT PRIMARY KEY,
 website TEXT DEFAULT '', service TEXT DEFAULT '', audience TEXT DEFAULT '', phone TEXT DEFAULT '',
 booking_url TEXT DEFAULT '', tone TEXT DEFAULT 'friendly', hours TEXT DEFAULT '',
 public_token TEXT UNIQUE, updated_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS leads (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT DEFAULT '', phone TEXT DEFAULT '', message TEXT DEFAULT '',
 status TEXT DEFAULT 'new', next_followup_at TEXT, followup_count INTEGER DEFAULT 0, created_at TEXT NOT NULL,
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(next_followup_at, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
