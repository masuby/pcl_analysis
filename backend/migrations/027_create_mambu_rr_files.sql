-- Every workbook a run produced, and who it is addressed to.
--
-- Recipients are resolved when the report is BUILT and stored here, not
-- recomputed when somebody presses Distribute. The roster is a live Google
-- Sheet and can change between building a report and sending it — the file
-- that goes out must be the file that was reviewed, addressed to the people it
-- said it was addressed to.
--
-- The workbook bytes themselves stay in the run's zip; this table records where
-- inside it each one sits, so a send extracts exactly what was downloaded.

CREATE TABLE IF NOT EXISTS mambu_rr_files (
    id         UUID PRIMARY KEY,
    run_id     UUID NOT NULL REFERENCES mambu_rr_runs(id) ON DELETE CASCADE,
    product    TEXT NOT NULL,
    scope      TEXT NOT NULL,   -- FULL | UNALLOCATED | UNALLOC_BRANCH | BRANCH | CLUSTER | ZONE
    name       TEXT NOT NULL,   -- branch / cluster / zone this file is for
    cluster    TEXT,            -- BRANCH files: the cluster they roll up into
    rel_path   TEXT NOT NULL,   -- path inside the run's zip
    rows       INTEGER NOT NULL DEFAULT 0,
    emails     TEXT,            -- comma-separated, as resolved at build time
    names      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mambu_rr_files_run
    ON mambu_rr_files(run_id, scope);


-- One row per email actually sent. This is the record that answers "did the
-- Kigoma branch ever get their list", so it is written whether the send
-- succeeded or failed, with the reason.
CREATE TABLE IF NOT EXISTS mambu_rr_sends (
    id          UUID PRIMARY KEY,
    run_id      UUID NOT NULL REFERENCES mambu_rr_runs(id) ON DELETE CASCADE,
    file_id     UUID REFERENCES mambu_rr_files(id) ON DELETE SET NULL,
    mode        TEXT NOT NULL,   -- BRANCH | CLUSTER | UNALLOCATED
    product     TEXT NOT NULL,
    target      TEXT NOT NULL,   -- the branch / cluster the email was for
    recipients  TEXT NOT NULL,   -- who it actually went to
    rows        INTEGER NOT NULL DEFAULT 0,
    attachment  TEXT,            -- the file name attached
    status      TEXT NOT NULL,   -- SENT | FAILED | SKIPPED
    error       TEXT,
    test_mode   BOOLEAN NOT NULL DEFAULT FALSE,  -- redirected to the operator
    sent_by     UUID,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mambu_rr_sends_run
    ON mambu_rr_sends(run_id, sent_at DESC);
