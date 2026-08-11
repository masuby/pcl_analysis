-- Digital Agent — generalise the pipeline from "cars on one site" to
-- "LBF (car owners) and SME (business owners) across several sources".
--
-- The original schema hardcoded a car listing from cartanzania. Two things
-- change here:
--   * every row now records WHICH product it serves and WHICH source it came
--     from, so sources can be added without another migration;
--   * clean leads gain the business-side fields SME needs, alongside the
--     existing car fields. A row uses one set or the other.

ALTER TABLE aism_raw_listings
    ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'LBF',
    ADD COLUMN IF NOT EXISTS source  TEXT NOT NULL DEFAULT 'cartanzania';

ALTER TABLE aism_clean_leads
    ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'LBF',
    ADD COLUMN IF NOT EXISTS source  TEXT NOT NULL DEFAULT 'cartanzania',
    -- SME / business-owner side
    ADD COLUMN IF NOT EXISTS business_name           TEXT,
    ADD COLUMN IF NOT EXISTS business_type           TEXT,
    ADD COLUMN IF NOT EXISTS sector                  TEXT,
    ADD COLUMN IF NOT EXISTS offering                TEXT,
    ADD COLUMN IF NOT EXISTS est_monthly_revenue_tzs TEXT,
    ADD COLUMN IF NOT EXISTS has_shopfront           TEXT;

CREATE INDEX IF NOT EXISTS idx_aism_raw_product   ON aism_raw_listings(product, source);
CREATE INDEX IF NOT EXISTS idx_aism_raw_pending   ON aism_raw_listings(product, source)
    WHERE raw_data IS NULL OR raw_data = '';
CREATE INDEX IF NOT EXISTS idx_aism_clean_product ON aism_clean_leads(product, source);
