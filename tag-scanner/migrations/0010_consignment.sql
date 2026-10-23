-- Public per-location consignor registration (view 1 of 3 planned public
-- views). consignment_slug is a non-secret, shareable identifier -
-- distinct from join_code, which stays a secret staff credential. Anyone
-- with the slug can view the public registration page and register as a
-- consignor for that location/event.
ALTER TABLE locations ADD COLUMN consignment_slug TEXT;
ALTER TABLE locations ADD COLUMN consignment_terms TEXT;

-- SQLite can't ALTER TABLE ADD a UNIQUE constraint directly, but a UNIQUE
-- index is equivalent and can be added this way. NULLs don't collide in a
-- SQLite unique index, so this is safe before any location sets a slug.
CREATE UNIQUE INDEX idx_locations_consignment_slug ON locations(consignment_slug);

-- One row per location+email - a consignor's registration for one event.
-- Created at "request a code" time, before anything else is filled in,
-- hence the nullable columns.
CREATE TABLE consignors (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  email TEXT NOT NULL,              -- always stored lowercased/trimmed
  phone TEXT,
  address TEXT,
  signed_name TEXT,                  -- typed-name signature
  signed_terms_snapshot TEXT,        -- copy of locations.consignment_terms AT
                                      -- signing time - terms can change later
                                      -- without altering what this consignor
                                      -- actually agreed to
  signed_ip TEXT,                     -- CF-Connecting-IP at signing time
  signed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location_id, email)
);

CREATE INDEX idx_consignors_location_id ON consignors(location_id);

-- Short-lived, single-use 6-digit email login code - same spirit as
-- square_oauth_states (migrations/0002_square_oauth.sql), but kept (not
-- deleted) with expires_at/used_at so request-code can cooldown-check
-- recent codes. `attempts` caps brute-force guessing - 1,000,000 possible
-- 6-digit codes is not safe against unlimited guesses within a 5 min
-- window without this. expires_at/used_at are epoch-ms INTEGER (not this
-- schema's usual TEXT datetime('now')) since expiry math happens in JS
-- via Date.now(), not SQL.
CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  consignor_id TEXT NOT NULL REFERENCES consignors(id),
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_login_codes_consignor_id ON login_codes(consignor_id);

-- Established after a code is verified. Longer-lived (7 days fixed) than
-- the code itself since an event spans hours/days.
CREATE TABLE consignor_sessions (
  token TEXT PRIMARY KEY,
  consignor_id TEXT NOT NULL REFERENCES consignors(id),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_consignor_sessions_consignor_id ON consignor_sessions(consignor_id);
