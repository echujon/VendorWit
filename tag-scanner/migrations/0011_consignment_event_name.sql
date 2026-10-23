-- Lets the public consignor-facing event name differ from the location's
-- own internal/staff-facing name (e.g. the staff location might be named
-- "Fort Collins" while a given consignment_slug is actually for a
-- differently-branded event like "Denver 2026 Ski Swap"). Falls back to
-- locations.name when unset, so nothing breaks for existing slugs.
ALTER TABLE locations ADD COLUMN consignment_event_name TEXT;
