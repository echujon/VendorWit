-- Single authoritative lifecycle field per item: 'holding' (still in
-- inventory), 'returned' (unsold consignment item given back to whoever
-- brought it in), or 'sold'. Directly editable via a dropdown in the
-- Records table, and set automatically to 'sold' the moment a real sale
-- completes. Supersedes the `returned` boolean (migration 0008), which
-- only captured one of these three states.
ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'holding';
