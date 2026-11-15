-- Links a locally-recorded sale back to the Square Order it came from -
-- either because this app created that Order itself (Terminal checkout,
-- see terminal-checkout.js) or because it was imported by a Square sync
-- (see functions/api/square/sync-sales.js). NULL for Cash/Venmo sales,
-- which never have a Square Order. The unique index is both the dedup
-- key for sync (ON CONFLICT DO NOTHING) and what stops a Terminal sale
-- recorded going forward from ever being double-imported by a later
-- sync covering the same date range.
ALTER TABLE sales ADD COLUMN square_order_id TEXT;
CREATE UNIQUE INDEX idx_sales_square_order_id ON sales(square_order_id);
