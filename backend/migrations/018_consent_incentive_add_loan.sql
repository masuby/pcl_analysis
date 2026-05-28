-- Migration 018: Allow LOAN kind in consent_incentive_files
-- The original migration constrained the kind to LEAD only. We now also accept LOAN
-- so the Consent Incentive Report can store the uploaded Loan Accounts file.

ALTER TABLE consent_incentive_files
    DROP CONSTRAINT IF EXISTS consent_incentive_files_kind_check;

ALTER TABLE consent_incentive_files
    ADD CONSTRAINT consent_incentive_files_kind_check
    CHECK (kind IN ('LEAD','LOAN'));
