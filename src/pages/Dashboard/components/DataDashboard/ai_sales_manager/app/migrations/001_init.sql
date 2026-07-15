-- AI Sales Manager - initial schema (PostgreSQL).
-- Tables are prefixed aism_ so they coexist with the main app in pcl_analysis.
-- The scraped listing LINK is the dedup key: source_url is UNIQUE, so a link we
-- already have is dropped completely (INSERT ... ON CONFLICT DO NOTHING).
-- raw_data is nullable: links are saved on discovery, details filled in after.

CREATE TABLE IF NOT EXISTS aism_raw_listings (
    id            BIGSERIAL PRIMARY KEY,
    source_url    TEXT UNIQUE NOT NULL,        -- listing link (dedup key)
    raw_data      TEXT,                        -- NULL until the detail page is scraped
    date_obtained TEXT,                        -- YYYY-MM-DD the link was found
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aism_raw_url ON aism_raw_listings(source_url);

CREATE TABLE IF NOT EXISTS aism_clean_leads (
    id            BIGSERIAL PRIMARY KEY,
    source_url    TEXT UNIQUE NOT NULL,        -- 1:1 with an aism_raw_listings row
    seller_name   TEXT,
    phone         TEXT,
    phone_norm    TEXT,                        -- last 9 digits, for unique-person dedup
    car_make      TEXT,
    car_model     TEXT,
    car_year      TEXT,
    mileage       TEXT,
    body_type     TEXT,
    fuel_type     TEXT,
    condition     TEXT,
    location      TEXT,
    price_text    TEXT,
    est_value_tzs TEXT,
    est_loan_tzs  TEXT,
    score         TEXT,
    reason        TEXT,
    date_obtained TEXT,
    flag          TEXT,                        -- NEW DATA | EXISTING DATA
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aism_clean_phone ON aism_clean_leads(phone_norm);
CREATE INDEX IF NOT EXISTS idx_aism_clean_url ON aism_clean_leads(source_url);
