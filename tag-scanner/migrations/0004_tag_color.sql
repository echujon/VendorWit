-- The color of the physical tag/label itself (e.g. "pink"), not the item's
-- own color (that's the existing `color` column) - consignment-style setups
-- use tag color to identify which vendor a sale belongs to.
ALTER TABLE items ADD COLUMN tag_color TEXT;
