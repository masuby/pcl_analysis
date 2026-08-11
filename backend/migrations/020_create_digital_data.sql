-- Migration 020: DIGITAL DATA — cleaned lead warehouse + distribution
--
-- The three operational workbooks (LBF / CS / SME "social media" books) hold
-- ~93k rows across 40 tabs with drifting headers, mixed schemas and 11-23%
-- duplicate phone numbers. This schema is the cleaned landing zone:
--
--   digital_ingest_runs          one row per "Clean & Ingest" execution (audit)
--   digital_leads                the canonical cleaned lead/touch records
--   digital_directory            Zone & Clusters people (distribution targets)
--   digital_distribution_batches one row per distribution action
--   digital_distributions        lead -> assignee links
--
-- Nothing is ever discarded: rows that fail validation are still inserted and
-- carry their problems in `issues` (jsonb array of codes), so the Data Quality
-- view can show exactly what the source data got wrong.

-- ---------------------------------------------------------------- ingest runs
CREATE TABLE IF NOT EXISTS digital_ingest_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at   TIMESTAMP WITH TIME ZONE,
    status        VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
                      CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
    books_scanned INT DEFAULT 0,
    tabs_scanned  INT DEFAULT 0,
    tabs_ingested INT DEFAULT 0,
    rows_read     INT DEFAULT 0,
    rows_inserted INT DEFAULT 0,
    rows_skipped  INT DEFAULT 0,
    error         TEXT,
    -- per-tab outcome: [{book,tab,kind,headerRow,rows,inserted,skipped,note}]
    tab_report    JSONB DEFAULT '[]'::jsonb,
    triggered_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dir_started ON digital_ingest_runs(started_at DESC);

-- ---------------------------------------------------------------------- leads
CREATE TABLE IF NOT EXISTS digital_leads (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- classification
    product          VARCHAR(16)  NOT NULL DEFAULT 'UNKNOWN',   -- LBF|CS|SME|MIF|UNKNOWN
    platform         VARCHAR(32)  NOT NULL DEFAULT 'unknown',   -- facebook|instagram|tiktok|whatsapp|website|ussd|other
    tab_kind         VARCHAR(24)  NOT NULL DEFAULT 'social_lead',

    -- the lead itself
    lead_name        TEXT,
    check_no         TEXT,
    lead_date        DATE,
    lead_month       VARCHAR(7),                                -- YYYY-MM, denormalised for filtering
    assigned_to      TEXT,                                      -- agent named in the source sheet
    -- 255XXXXXXXXX when valid. Invalid numbers keep their digits so they can
    -- be corrected at source, and the source has values up to 19 digits long.
    phone_e164       VARCHAR(32),
    phone_raw        TEXT,
    phone_valid      BOOLEAN NOT NULL DEFAULT false,
    status_raw       TEXT,
    status_canonical VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
    comment          TEXT,
    is_converted     BOOLEAN NOT NULL DEFAULT false,
    loan_amount      NUMERIC(14,2),
    client_type      TEXT,
    region           TEXT,

    -- provenance: every value traces back to one source cell
    source_book      VARCHAR(8)  NOT NULL,                      -- LBF|CS|SME
    source_tab       TEXT        NOT NULL,
    source_row       INT         NOT NULL,                      -- 1-based row in the tab
    row_hash         CHAR(64)    NOT NULL,                      -- sha256 of book|tab|row|payload

    issues           JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- false when an earlier record already exists for the same phone_e164
    is_primary       BOOLEAN NOT NULL DEFAULT true,

    ingest_run_id    UUID REFERENCES digital_ingest_runs(id) ON DELETE SET NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Re-running an ingest must not duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_digital_leads_hash ON digital_leads(row_hash);

CREATE INDEX IF NOT EXISTS idx_dl_phone    ON digital_leads(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_product  ON digital_leads(product);
CREATE INDEX IF NOT EXISTS idx_dl_month    ON digital_leads(lead_month);
CREATE INDEX IF NOT EXISTS idx_dl_status   ON digital_leads(status_canonical);
CREATE INDEX IF NOT EXISTS idx_dl_platform ON digital_leads(platform);
CREATE INDEX IF NOT EXISTS idx_dl_kind     ON digital_leads(tab_kind);
CREATE INDEX IF NOT EXISTS idx_dl_primary  ON digital_leads(is_primary) WHERE is_primary = true;

-- ------------------------------------------------------------------ directory
-- Synced from the Zone and Clusters workbook (one row per person per tab).
CREATE TABLE IF NOT EXISTS digital_directory (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone       TEXT,
    branch     TEXT,
    full_name  TEXT NOT NULL,
    role       TEXT,
    phone      TEXT,
    email      TEXT,
    cluster    TEXT,
    product    VARCHAR(16),                                     -- LBF|CS|SME
    channel    VARCHAR(16),                                     -- CC|BRANCH  (call centre vs branch)
    source_tab TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    synced_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dd_person
    ON digital_directory(source_tab, lower(full_name), COALESCE(lower(email),''), COALESCE(lower(branch),''));

CREATE INDEX IF NOT EXISTS idx_dd_product ON digital_directory(product) WHERE is_active = true;

-- --------------------------------------------------------------- distribution
CREATE TABLE IF NOT EXISTS digital_distribution_batches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    product        VARCHAR(16),
    method         VARCHAR(16) NOT NULL DEFAULT 'ROUND_ROBIN'   -- ROUND_ROBIN|MANUAL
                       CHECK (method IN ('ROUND_ROBIN','MANUAL')),
    note           TEXT,
    lead_count     INT DEFAULT 0,
    assignee_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ddb_created ON digital_distribution_batches(created_at DESC);

CREATE TABLE IF NOT EXISTS digital_distributions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       UUID REFERENCES digital_distribution_batches(id) ON DELETE CASCADE,
    lead_id        UUID NOT NULL REFERENCES digital_leads(id) ON DELETE CASCADE,
    directory_id   UUID REFERENCES digital_directory(id) ON DELETE SET NULL,
    assignee_name  TEXT NOT NULL,
    assignee_email TEXT,
    assignee_phone TEXT,
    assignee_role  TEXT,
    branch         TEXT,
    cluster        TEXT,
    zone           TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED'
                       CHECK (status IN ('ASSIGNED','SENT','WORKED','RETURNED')),
    assigned_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- A lead has exactly one current owner; re-distributing replaces the old link.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dds_lead ON digital_distributions(lead_id);

CREATE INDEX IF NOT EXISTS idx_dds_batch    ON digital_distributions(batch_id);
CREATE INDEX IF NOT EXISTS idx_dds_assignee ON digital_distributions(lower(assignee_name));
