-- Marks a consignment item ("blue tag" / sub-vendor item) as having been
-- physically returned to its sub-vendor, distinct from being sold - an
-- unsold item can be either still on the floor or already returned.
ALTER TABLE items ADD COLUMN returned INTEGER NOT NULL DEFAULT 0;
