-- Structured category, separate from the free-form `item`/`name` OCR
-- text (which is too inconsistent to group by directly - e.g. "SKIS",
-- "Ski", "skis", "SKI & B" are all literally skis but as different
-- strings). Also added to consignor_items so the consignment form's new
-- category dropdown (a controlled list, no free text) feeds the same
-- field once staff convert an approved submission into a real item.
ALTER TABLE items ADD COLUMN category TEXT;
ALTER TABLE consignor_items ADD COLUMN category TEXT;
