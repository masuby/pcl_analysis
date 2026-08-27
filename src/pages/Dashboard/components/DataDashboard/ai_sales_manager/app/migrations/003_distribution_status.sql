-- Which leads have actually been handed to the call centre.
--
-- Until now the only record of a distribution lived in the Google Sheets, so
-- there was no way to look at the lead database and tell what had been sent out
-- and what was still sitting unused. That matters for the next acquisition run:
-- without it, freshly scraped leads and leads distributed weeks ago look the
-- same, and nobody can see the backlog.
--
-- The sheets stay the source of truth for what was actually distributed — a
-- lead counts as sent because its phone number is in a month's tab, not because
-- we think we sent it. `mark_distributed` reads the tabs back and sets these.

ALTER TABLE aism_clean_leads
    ADD COLUMN IF NOT EXISTS distribution_status TEXT NOT NULL DEFAULT 'NEVER DISTRIBUTED',
    ADD COLUMN IF NOT EXISTS distributed_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS distributed_to      TEXT;  -- which sheet tab it went to

-- The status is what the dashboard filters on, so it needs an index.
CREATE INDEX IF NOT EXISTS idx_aism_clean_dist
    ON aism_clean_leads(distribution_status);

-- Matching against a sheet is done on the normalised phone, which is also how
-- distribute.py decides whether a lead is already there.
CREATE INDEX IF NOT EXISTS idx_aism_clean_phone_norm
    ON aism_clean_leads(phone_norm);
