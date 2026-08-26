-- MAMBU source files — the Loan and Client exports the refinance /
-- reactivation runs are built from.
--
-- These two files are uploaded once and then STAY. A run does not ask for a
-- file; it uses whatever is currently active. That is the point: the same pair
-- of files feeds LBF, SME and Agrifinance, so uploading in one product's
-- section makes the others current too. A file is only ever superseded by an
-- explicit replace, never by running a report.
--
-- The third file the old scripts read from disk — Zone and Clusters.xlsx — is
-- deliberately NOT stored here. It now comes from the live Google Sheet, so the
-- roster cannot drift out of date against a stale local copy.
--
-- History is kept: superseded rows stay with is_active = FALSE so a wrong file
-- can be traced, and so "what did last month's run actually read" is answerable.

CREATE TABLE IF NOT EXISTS mambu_source_files (
    id            UUID PRIMARY KEY,
    kind          TEXT NOT NULL,              -- LOAN | CLIENTS
    file_name     TEXT NOT NULL,              -- as uploaded, for recognisability
    file_path     TEXT NOT NULL,              -- relative to the upload root
    file_size     BIGINT NOT NULL DEFAULT 0,
    sha256        TEXT,                       -- so re-uploading the same file is visible
    row_count     INTEGER,                    -- data rows, excluding the header
    column_count  INTEGER,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by   UUID,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    replaced_at   TIMESTAMPTZ
);

-- Exactly one active file per kind. A partial unique index enforces it, so a
-- replace that half-failed cannot leave two files both claiming to be current.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mambu_source_active
    ON mambu_source_files(kind) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_mambu_source_kind
    ON mambu_source_files(kind, uploaded_at DESC);


-- Every refinance / reactivation run, so a distributed workbook can be traced
-- back to the files and the roster snapshot it came from.
CREATE TABLE IF NOT EXISTS mambu_rr_runs (
    id             UUID PRIMARY KEY,
    mode           TEXT NOT NULL,             -- REFINANCE | REACTIVATION
    products       TEXT NOT NULL,             -- comma-separated: LBF,SME,AGRI,CS
    date_from      DATE,                      -- reactivation only
    date_to        DATE,
    source_loan    UUID REFERENCES mambu_source_files(id),
    source_clients UUID REFERENCES mambu_source_files(id),

    rows_in        INTEGER NOT NULL DEFAULT 0,
    rows_out       INTEGER NOT NULL DEFAULT 0,
    dnc_removed    INTEGER NOT NULL DEFAULT 0,
    stats          JSONB,                     -- per-product counts and funnel
    warnings       TEXT,                      -- gaps worth telling the operator about

    zip_path       TEXT,                      -- relative to the upload root
    zip_size       BIGINT,
    status         TEXT NOT NULL DEFAULT 'RUNNING',   -- RUNNING | DONE | FAILED
    error          TEXT,
    run_by         UUID,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mambu_rr_runs_started
    ON mambu_rr_runs(started_at DESC);
