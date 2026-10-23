-- Items a consignor submits online before physically dropping them off -
-- a pending declaration of intent, not live sellable inventory. The
-- consignment agreement text (locations.consignment_terms) explicitly
-- reserves the right to deny any item, so these need staff review
-- (status: 'pending' | 'approved' | 'rejected') before becoming a real
-- `items` row - that conversion happens through the existing staff
-- scan-and-tag workflow at physical drop-off (unique_id isn't known at
-- submission time), not automatically from this table.
CREATE TABLE consignor_items (
  id TEXT PRIMARY KEY,
  consignor_id TEXT NOT NULL REFERENCES consignors(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  description TEXT,
  price TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '1',
  photo_data_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_consignor_items_consignor_id ON consignor_items(consignor_id);
CREATE INDEX idx_consignor_items_location_id ON consignor_items(location_id);

-- Optional per-event cap on how many items a consignor may submit online
-- (staff's consignment_terms prose may already state a number, e.g. "up
-- to 26 items" - this is a structured, enforced version of that same
-- rule; NULL means no cap). Only pending/approved submissions count
-- against it - a rejected one frees up the slot.
ALTER TABLE locations ADD COLUMN consignment_max_items INTEGER;
