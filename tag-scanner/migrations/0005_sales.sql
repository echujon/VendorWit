-- Completed sales, for reporting. Before this, finishing a sale (Cash,
-- Venmo, or a Square Terminal card payment) only ever decremented
-- inventory quantity - there was no durable record of what was sold,
-- for how much, when, or how it was paid. One row per completed sale;
-- items_json is a snapshot of the cart at the moment of completion
-- (not a live reference to `items`, since inventory rows can later be
-- edited/deleted independent of past sales).
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  total TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sales_location_id ON sales(location_id);
CREATE INDEX idx_sales_created_at ON sales(created_at);
