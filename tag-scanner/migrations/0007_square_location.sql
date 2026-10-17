-- Which of the connected Square account's own Locations this app location
-- corresponds to (Square's Locations are a separate concept from ours -
-- see Settings; one Square account can have many Locations, each with its
-- own regional tax(es) scoped via Square's own present_at_location_ids).
-- Needed so terminal checkouts apply only the tax for the event actually
-- running here, instead of every tax in the whole Square account.
ALTER TABLE locations ADD COLUMN square_location_id TEXT;
