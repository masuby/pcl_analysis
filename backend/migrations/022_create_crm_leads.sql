-- Migration 022: CRM lead store + distribution to Team Leaders
--
-- Unlike DIGITAL DATA (which re-reads Google Sheets and is rebuilt by ingest),
-- this is an ACCUMULATING store. Each uploaded Lead_Report is merged into it:
--   * a phone number not seen before is appended
--   * a phone number already present has its row updated in place
-- so the server always holds one current row per client, and history of how
-- many times that client has been re-uploaded.
--
-- The upsert key is the NORMALISED phone (255XXXXXXXXX). The raw column cannot
-- be trusted for this: the sample file has 1,203 of 12,372 numbers in other
-- shapes (0757920258, 27783494362, a 24-digit value), which would create
-- duplicate clients if matched literally.

-- Branch names must be comparable across two sources that spell them
-- differently: the CRM export says "CS Mbeya Branch", the Zone & Clusters
-- directory says "Mbeya". This strips the product prefix and the words
-- Branch/Centre/Center, then reduces to lowercase alphanumerics.
--
-- It MUST stay in step with BranchKey() in services/crmdata/parse.go, which
-- computes the same key when a lead is stored. The Go side fills
-- crm_leads.branch_key; this function normalises the directory side at query
-- time (the directory is shared with DIGITAL DATA, so it is not re-shaped).
-- NOTE the word "centre/center" is normalised, NOT removed. Removing it made
-- "CS - Call Centre" and "LBF - Call Centre" both collapse to "call", which
-- would have routed CS leads to LBF team leaders. Only "Branch" is dropped.
CREATE OR REPLACE FUNCTION crm_branch_key(src TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(COALESCE(src, ''), '^[[:space:]]*(cs|lbf|sme)\y', '', 'i'),
               'centre', 'center', 'gi'),
             '\ybranch\y', '', 'gi'),
           '[^a-zA-Z0-9]+', '', 'g'));
$$;

-- The product a branch string names, when it carries one ("CS Mbeya Branch",
-- "LBF - Call Centre"). Call centres share a branch key across products, so the
-- product is what keeps them apart.
CREATE OR REPLACE FUNCTION crm_product_hint(src TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(
    (regexp_match(COALESCE(src, ''), '^[[:space:]]*(cs|lbf|sme)\y', 'i'))[1], ''));
$$;

CREATE TABLE IF NOT EXISTS crm_uploads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name     VARCHAR(255) NOT NULL,
    file_size     BIGINT DEFAULT 0,
    rows_read     INT DEFAULT 0,
    rows_inserted INT DEFAULT 0,   -- new clients appended
    rows_updated  INT DEFAULT 0,   -- existing clients refreshed
    rows_skipped  INT DEFAULT 0,   -- unusable (no phone at all)
    bad_phones    INT DEFAULT 0,   -- kept, but the number is not a valid TZ mobile
    status        VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
                      CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
    error         TEXT,
    uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_crmu_created ON crm_uploads(created_at DESC);

CREATE TABLE IF NOT EXISTS crm_leads (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- identity: one row per client
    phone_norm                VARCHAR(32) NOT NULL,   -- 255XXXXXXXXX when valid
    phone_raw                 TEXT,
    phone_valid               BOOLEAN NOT NULL DEFAULT false,

    -- columns as they arrive in Lead_Report
    lead_name                 TEXT,
    created_by                TEXT,
    email_address             TEXT,
    id_number                 TEXT,
    emp_number                TEXT,
    team_name                 TEXT,
    assigned_to               TEXT,
    consent_type              TEXT,
    consent_status            TEXT,
    consent_date              TIMESTAMP WITH TIME ZONE,
    consent_request_date      TIMESTAMP WITH TIME ZONE,
    status                    TEXT,
    branch                    TEXT,
    region                    TEXT,
    location                  TEXT,
    source                    TEXT,
    affordability_outcome     TEXT,
    total_affordability       NUMERIC(16,2),
    installment_amount        NUMERIC(16,2),
    affordability_date_text   TEXT,       -- often the literal "NOT SET"
    assignment_type           TEXT,
    created_date              TIMESTAMP WITH TIME ZONE,
    comment                   TEXT,

    -- derived for routing: branch stripped of its product prefix and the word
    -- "Branch", so "CS Mbeya Branch" matches the directory's "Mbeya".
    branch_key                TEXT,
    -- CS / LBF / SME when the branch string names one. Required to tell the CS
    -- and LBF call centres apart, since they share a branch key.
    product_hint              VARCHAR(8) NOT NULL DEFAULT '',

    -- provenance
    first_upload_id           UUID REFERENCES crm_uploads(id) ON DELETE SET NULL,
    last_upload_id            UUID REFERENCES crm_uploads(id) ON DELETE SET NULL,
    update_count              INT NOT NULL DEFAULT 0,
    first_seen_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- The upsert target. One row per client number.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_leads_phone ON crm_leads(phone_norm);

CREATE INDEX IF NOT EXISTS idx_crm_branch   ON crm_leads(branch_key);
CREATE INDEX IF NOT EXISTS idx_crm_status   ON crm_leads(status);
CREATE INDEX IF NOT EXISTS idx_crm_region   ON crm_leads(region);
CREATE INDEX IF NOT EXISTS idx_crm_team     ON crm_leads(team_name);
CREATE INDEX IF NOT EXISTS idx_crm_assigned ON crm_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_created  ON crm_leads(created_date DESC);

-- ------------------------------------------------------------- distribution
CREATE TABLE IF NOT EXISTS crm_distribution_batches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    method         VARCHAR(16) NOT NULL DEFAULT 'BY_BRANCH'
                       CHECK (method IN ('BY_BRANCH','ROUND_ROBIN','MANUAL')),
    note           TEXT,
    lead_count     INT DEFAULT 0,
    assignee_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_crmb_created ON crm_distribution_batches(created_at DESC);

CREATE TABLE IF NOT EXISTS crm_distributions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       UUID REFERENCES crm_distribution_batches(id) ON DELETE CASCADE,
    lead_id        UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    -- the Team Leader, taken from digital_directory (synced from Zone & Clusters)
    directory_id   UUID REFERENCES digital_directory(id) ON DELETE SET NULL,
    assignee_name  TEXT NOT NULL,
    assignee_email TEXT,
    assignee_phone TEXT,
    assignee_role  TEXT,
    branch         TEXT,
    region         TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED'
                       CHECK (status IN ('ASSIGNED','SENT','WORKED','RETURNED')),
    assigned_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at        TIMESTAMP WITH TIME ZONE,
    sent_to        TEXT,
    send_error     TEXT
);

-- A lead has one current owner; re-distributing moves it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crmd_lead ON crm_distributions(lead_id);
CREATE INDEX IF NOT EXISTS idx_crmd_batch     ON crm_distributions(batch_id);
CREATE INDEX IF NOT EXISTS idx_crmd_assignee  ON crm_distributions(lower(assignee_name));
CREATE INDEX IF NOT EXISTS idx_crmd_sent      ON crm_distributions(sent_at);

CREATE TABLE IF NOT EXISTS crm_send_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       UUID REFERENCES crm_distribution_batches(id) ON DELETE SET NULL,
    assignee_name  TEXT NOT NULL,
    assignee_email TEXT NOT NULL,
    lead_count     INT NOT NULL DEFAULT 0,
    status         VARCHAR(16) NOT NULL DEFAULT 'SENT'
                       CHECK (status IN ('SENT','FAILED')),
    error          TEXT,
    sent_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crmsl_sent ON crm_send_log(sent_at DESC);
