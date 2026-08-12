-- Migration 023: route CRM leads via Created_By, not just the branch string.
--
-- The Zone & Clusters workbook gained a CRM tab: 936 CRM users with
-- Name | Email_Address | Role | Zone | Tenant | Product | Mobile.
-- `Tenant` is that user's branch and `Name` matches Lead_Report.Created_By.
--
-- Measured on the 12,372-row export:
--   branch string      -> a Team Leader for 65% of rows
--   Created_By (exact) -> a CRM user for 74%
--   Created_By (with whitespace collapsed) -> 82%
--
-- The whitespace step matters because the export contains double-spaced names
-- ("ESTER  KILONGO", "EMMANUEL  LUCAS") that the workbook writes with one
-- space; collapsing runs of space recovered 902 rows on its own.

-- Names must compare with runs of whitespace collapsed and case ignored.
CREATE OR REPLACE FUNCTION crm_name_key(src TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(src, ''), '\s+', ' ', 'g')));
$$;

ALTER TABLE crm_leads
    ADD COLUMN IF NOT EXISTS created_by_key TEXT;

-- Backfill for rows already in the store.
UPDATE crm_leads
   SET created_by_key = crm_name_key(created_by)
 WHERE created_by_key IS DISTINCT FROM crm_name_key(created_by);

CREATE INDEX IF NOT EXISTS idx_crm_created_by_key ON crm_leads(created_by_key);

-- The directory gains the same key so the join is index-friendly on both sides.
CREATE INDEX IF NOT EXISTS idx_dd_name_key
    ON digital_directory (crm_name_key(full_name));

-- CRM-tab people are directory rows with channel = 'CRM'. They are the lookup
-- for "which branch does this CRM user belong to", and must NOT appear as
-- DIGITAL DATA distribution targets (that rule selects channel = 'CC' and SME
-- branch managers), which is why they carry their own channel value.
CREATE INDEX IF NOT EXISTS idx_dd_channel_branchkey
    ON digital_directory (channel, crm_branch_key(branch));
