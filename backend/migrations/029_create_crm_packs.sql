-- Migration 029: CRM distribution packs.
--
-- A pack is the CRM equivalent of a MAMBU run: the leads that have been
-- assigned to Team Leaders, split into one workbook per branch, per cluster
-- and per zone, zipped for download, and then emailed to the branch, the
-- cluster manager or the zone manager from the Zone and Clusters roster.
--
-- Same principle as mambu_rr_files: recipients are resolved when the pack is
-- BUILT and stored, so the file that goes out is the file that was reviewed,
-- addressed to the people it said it was addressed to.

CREATE TABLE IF NOT EXISTS crm_packs (
    id           UUID PRIMARY KEY,
    products     TEXT NOT NULL,              -- comma-separated: CS,LBF,SME
    filter       JSONB,                      -- the lead filter the pack was built from
    lead_count   INTEGER NOT NULL DEFAULT 0, -- rows that went into workbooks
    unrouted     INTEGER NOT NULL DEFAULT 0, -- rows with no branch on the roster
    stats        JSONB,                      -- per-product counts
    warnings     TEXT,
    zip_path     TEXT,                       -- relative to the upload root
    zip_size     BIGINT,
    status       TEXT NOT NULL DEFAULT 'RUNNING',   -- RUNNING | DONE | FAILED
    error        TEXT,
    built_by     UUID,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_packs_started ON crm_packs(started_at DESC);

CREATE TABLE IF NOT EXISTS crm_pack_files (
    id         UUID PRIMARY KEY,
    pack_id    UUID NOT NULL REFERENCES crm_packs(id) ON DELETE CASCADE,
    product    TEXT NOT NULL,
    scope      TEXT NOT NULL,   -- FULL | BRANCH | CLUSTER | ZONE
    name       TEXT NOT NULL,   -- branch / cluster / zone this file is for
    cluster    TEXT,            -- BRANCH files: the cluster they roll up into
    zone       TEXT,            -- BRANCH files: the zone they roll up into
    rel_path   TEXT NOT NULL,   -- path inside the pack's zip
    rows       INTEGER NOT NULL DEFAULT 0,
    emails     TEXT,            -- comma-separated, as resolved at build time
    names      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_pack_files_pack ON crm_pack_files(pack_id, scope);

-- One row per email actually attempted, success or failure, with the reason.
CREATE TABLE IF NOT EXISTS crm_pack_sends (
    id          UUID PRIMARY KEY,
    pack_id     UUID NOT NULL REFERENCES crm_packs(id) ON DELETE CASCADE,
    file_id     UUID REFERENCES crm_pack_files(id) ON DELETE SET NULL,
    mode        TEXT NOT NULL,   -- BRANCH | CLUSTER | ZONE
    product     TEXT NOT NULL,
    target      TEXT NOT NULL,
    recipients  TEXT NOT NULL,   -- To:
    cc          TEXT,            -- Cc: added by the operator for this send
    rows        INTEGER NOT NULL DEFAULT 0,
    attachment  TEXT,
    status      TEXT NOT NULL,   -- SENT | FAILED | SKIPPED
    error       TEXT,
    test_mode   BOOLEAN NOT NULL DEFAULT FALSE,
    sent_by     UUID,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_pack_sends_pack ON crm_pack_sends(pack_id, sent_at DESC);

-- The MAMBU send gains the same operator-added Cc.
ALTER TABLE mambu_rr_sends ADD COLUMN IF NOT EXISTS cc TEXT;
