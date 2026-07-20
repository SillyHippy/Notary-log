-- Notary-log Cal multi-tenant schema for Cloudflare D1
-- Apply: wrangler d1 execute notary-log-cal --file=cloudflare/d1-schema.sql
-- Mirrors server/cal-routes.ts migrateCalSchema + bookings table on Zo cal host.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  slug TEXT,
  cal_booking_url TEXT,
  cal_username TEXT UNIQUE,
  cal_event_slug TEXT,
  cal_webhook_secret TEXT,
  display_name TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_cal_username ON users(cal_username);
CREATE INDEX IF NOT EXISTS idx_users_slug ON users(slug);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_token TEXT NOT NULL,
  cal_uid TEXT NOT NULL,
  cal_booking_id INTEGER,
  status TEXT NOT NULL,
  title TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  attendee_name TEXT,
  attendee_email TEXT,
  attendee_phone TEXT,
  location TEXT,
  price_cents INTEGER,
  currency TEXT,
  payload_json TEXT NOT NULL,
  journal_linked_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(user_token, cal_uid),
  FOREIGN KEY (user_token) REFERENCES users(token)
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_start ON bookings(user_token, start_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users(slug) WHERE slug IS NOT NULL AND slug != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cal_username ON users(cal_username) WHERE cal_username IS NOT NULL AND cal_username != '';

-- OAuth columns (Phase 1+ — optional until Connect Cal ships)
-- ALTER TABLE users ADD COLUMN cal_oauth_access_token_enc TEXT;
-- ALTER TABLE users ADD COLUMN cal_oauth_refresh_token_enc TEXT;
-- ALTER TABLE users ADD COLUMN cal_oauth_expires_at TEXT;
-- ALTER TABLE users ADD COLUMN cal_oauth_webhook_id TEXT;
