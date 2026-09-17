-- Where a do-not-contact number came from.
--
-- The sheet is a full mirror of this table, so "was it on the tab?" cannot
-- answer it: after the first sync every number is on the tab, and the column
-- read "Sheet" for all of them including the eight carried over from
-- process_refinance.py. Recorded once, on the way in, instead of inferred.
ALTER TABLE mambu_do_not_contact
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'Web';

COMMENT ON COLUMN mambu_do_not_contact.source IS
    'Web = added in the app, Sheet = typed into the DO_NOT_CONTACT tab';
