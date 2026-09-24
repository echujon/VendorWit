CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_locations_organization_id ON locations(organization_id);
CREATE INDEX idx_locations_join_code ON locations(join_code);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  unique_id TEXT,
  name TEXT,
  item TEXT,
  brand TEXT,
  size TEXT,
  color TEXT,
  price TEXT,
  quantity TEXT,
  bin_location TEXT,
  stripe_id TEXT,
  price_id TEXT,
  sent_to_stripe INTEGER NOT NULL DEFAULT 0,
  photo_data_url TEXT,
  embedding_gemini TEXT,
  embedding_clip TEXT,
  other_fields_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_items_location_id ON items(location_id);
CREATE INDEX idx_items_unique_id ON items(unique_id);

-- Square's webhook calls this server directly with no way to send our
-- X-Location-Code header, so webhooks/square.js needs another way to know
-- which location's queue a given device belongs to. Kept in sync whenever
-- a terminal is registered (see functions/api/queue/terminals.js).
CREATE TABLE device_locations (
  device_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id)
);
