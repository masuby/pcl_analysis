-- MAMBU data — the employee register.
--
-- This is the reference list of Tanzanian public-service employees that the CS
-- affordability run is built on: roughly 650,000 people, refreshed by uploading
-- a new extract. check_number identifies a person, so an upload UPDATES the rows
-- it recognises and APPENDS the ones it does not. Nothing is deleted by an
-- upload — a person missing from a later extract stays on file, because absence
-- from one export is not evidence they left the payroll.
--
-- The extract has gained columns before and will again, so unknown headers are
-- added to this table as TEXT columns at upload time rather than being dropped.
-- The columns below are the ones the affordability formula actually reads; they
-- are typed properly so the maths does not depend on string parsing.
--
-- This table holds personal data (names, birth dates, phone numbers, salaries).
-- It must stay behind authentication and must never be exposed unfiltered.

CREATE TABLE IF NOT EXISTS mambu_employees (
    check_number   TEXT PRIMARY KEY,

    votecode       TEXT,
    votename       TEXT,
    deptname       TEXT,
    first_name     TEXT,
    middle_name    TEXT,
    last_name      TEXT,
    gender         TEXT,
    birth_date     DATE,
    phone          TEXT,
    hiredate       DATE,
    confirdate     DATE,
    seniordate     DATE,
    contract_end   DATE,
    jobtittle      TEXT,
    grosspay       NUMERIC(18,2),
    basicpay       NUMERIC(18,2),
    netpay         NUMERIC(18,2),

    -- provenance: which upload last touched this row
    source_file    TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The affordability run filters and groups on these.
CREATE INDEX IF NOT EXISTS idx_mambu_emp_votename ON mambu_employees(votename);
CREATE INDEX IF NOT EXISTS idx_mambu_emp_updated  ON mambu_employees(updated_at DESC);

-- Every upload is recorded, so a wrong file can be traced and explained.
CREATE TABLE IF NOT EXISTS mambu_uploads (
    id             UUID PRIMARY KEY,
    kind           TEXT NOT NULL,          -- EMPLOYEES | INSTALLMENTS | LOANS
    file_name      TEXT NOT NULL,
    file_size      BIGINT,
    rows_read      INTEGER NOT NULL DEFAULT 0,
    rows_inserted  INTEGER NOT NULL DEFAULT 0,
    rows_updated   INTEGER NOT NULL DEFAULT 0,
    columns_added  TEXT,                   -- comma-separated, when the extract grew
    status         TEXT NOT NULL DEFAULT 'RUNNING',  -- RUNNING | DONE | FAILED
    error          TEXT,
    uploaded_by    UUID,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mambu_uploads_kind ON mambu_uploads(kind, started_at DESC);

-- Tolerant casts. The extract is produced by hand from several sources, so a
-- single unparseable date or a "N/A" in a salary column must not abort an
-- upload of 650,000 rows — that value becomes NULL and everything else lands.
CREATE OR REPLACE FUNCTION mambu_num(t TEXT) RETURNS NUMERIC AS $$
BEGIN
    RETURN NULLIF(btrim(COALESCE(t, '')), '')::NUMERIC;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION mambu_date(t TEXT) RETURNS DATE AS $$
BEGIN
    RETURN NULLIF(btrim(COALESCE(t, '')), '')::DATE;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
