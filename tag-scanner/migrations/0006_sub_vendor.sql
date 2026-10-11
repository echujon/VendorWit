-- Tracks a sub-vendor's actual name (e.g. "Jane's Crafts"), for the case
-- where a main vendor (the `organizations` row/Square business name) has
-- smaller sub-vendors also selling through the same shared POS. Distinct
-- from tag_color (an auto-detected physical attribute of the tag itself) -
-- this is the real identity used for payout reporting.
ALTER TABLE items ADD COLUMN sub_vendor TEXT;
