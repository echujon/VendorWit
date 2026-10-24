-- A second, separate credential per location for the Vendor Aide role
-- (view 2 of 3 planned views) - distinct from join_code, which remains
-- the admin credential with full access to everything. resolveLocation()
-- (functions/_shared/location.js) derives role from which column the
-- submitted code actually matched, so it's enforced server-side on every
-- request - not a client-side flag anyone could flip back in devtools.
ALTER TABLE locations ADD COLUMN aide_code TEXT;
CREATE UNIQUE INDEX idx_locations_aide_code ON locations(aide_code);
