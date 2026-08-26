-- CS affordability inputs: the deduction (Inst) files and the CS loan files.
--
-- WHY THESE REPLACE RATHER THAN MERGE
--
-- The employee register accumulates: somebody missing from a later extract has
-- not left the payroll, so their row stays. Deductions are the opposite. A loan
-- that has been settled simply disappears from the next Inst extract, and if we
-- kept it the person would look permanently poorer than they are and would stop
-- qualifying. So an upload here is a BATCH that supersedes the previous batch —
-- the current picture, not a running total.
--
-- A batch can hold several files (the extract is split because it exceeds
-- Excel's row limit — May was 1,050,458 rows across two files). They are
-- uploaded one at a time into the same open batch and combined.
--
-- Inst rows are NOT keyed on application_number: 68,728 of May's rows have none
-- at all. Within a batch every row is simply kept, which is correct — they are
-- distinct deductions, not duplicates.

CREATE TABLE IF NOT EXISTS mambu_cs_batches (
    id          UUID PRIMARY KEY,
    kind        TEXT NOT NULL,              -- INST | CS_LOAN
    status      TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | ACTIVE | SUPERSEDED
    file_names  TEXT,                       -- every file folded into this batch
    file_count  INTEGER NOT NULL DEFAULT 0,
    row_count   INTEGER NOT NULL DEFAULT 0,
    uploaded_by UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ
);

-- At most one ACTIVE batch per kind: the affordability run must never have to
-- guess which extract it is reading.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mambu_cs_batch_active
    ON mambu_cs_batches(kind) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_mambu_cs_batches_kind
    ON mambu_cs_batches(kind, created_at DESC);


-- Deductions already coming off a person's salary. Several rows per person,
-- one per deduction; affordability sums them.
CREATE TABLE IF NOT EXISTS mambu_installments (
    batch_id           UUID NOT NULL REFERENCES mambu_cs_batches(id) ON DELETE CASCADE,
    check_number       TEXT NOT NULL,
    installment        NUMERIC(18,2),
    balance            NUMERIC(18,2),
    application_number TEXT,
    dedcode            TEXT,
    dedname            TEXT
);

-- The run aggregates per person within the active batch, so this is the index
-- that matters.
CREATE INDEX IF NOT EXISTS idx_mambu_inst_batch_check
    ON mambu_installments(batch_id, check_number);


-- CS loan accounts. Used for two things only: whether a person currently has a
-- live loan (Total Balance > 0 = ACTIVE, = 0 = INACTIVE, absent = NEW), and
-- which branch they belong to.
--
-- NOTE this is a DIFFERENT export from the Loan_Accounts file the LBF/SME/
-- Agrifinance refinance report reads. That one is keyed on Account Holder Name
-- and carries no check number, so it cannot be joined to the payroll register.
-- The CS export must carry Check Number (Client), Total Balance and Branch.
CREATE TABLE IF NOT EXISTS mambu_cs_loans (
    batch_id     UUID NOT NULL REFERENCES mambu_cs_batches(id) ON DELETE CASCADE,
    check_number TEXT NOT NULL,
    total_balance NUMERIC(18,2),
    branch       TEXT,
    account_state TEXT
);

CREATE INDEX IF NOT EXISTS idx_mambu_cs_loans_batch_check
    ON mambu_cs_loans(batch_id, check_number);
