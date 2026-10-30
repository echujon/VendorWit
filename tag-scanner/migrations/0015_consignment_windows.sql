-- Each public consignment form (online/email-verified, and in-person/
-- unverified) is only open for a staff-chosen window, opened from
-- Settings. Epoch-ms INTEGER like login_codes.expires_at, since the
-- comparison happens in JS. NULL means closed.
--
-- The in-person link also carries a random key so it can't be reached by
-- just editing the online link - otherwise anyone could skip email
-- verification from home.
ALTER TABLE locations ADD COLUMN consignment_online_expires_at INTEGER;
ALTER TABLE locations ADD COLUMN consignment_inperson_expires_at INTEGER;
ALTER TABLE locations ADD COLUMN consignment_inperson_key TEXT;

-- Links already shared before this migration would otherwise close
-- instantly on deploy - give them the default 2-day window instead.
UPDATE locations
SET consignment_online_expires_at = (CAST(strftime('%s', 'now') AS INTEGER) + 2 * 24 * 60 * 60) * 1000
WHERE consignment_slug IS NOT NULL;
