-- Migration 021: track when a distribution was actually emailed to its owner.
--
-- Distribution was previously a database record only — assigning a lead told
-- nobody. These columns record the hand-off so the UI can show what has and has
-- not reached the agent, and so re-sending is a deliberate act.

ALTER TABLE digital_distributions
    ADD COLUMN IF NOT EXISTS sent_at    TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS sent_to    TEXT,
    ADD COLUMN IF NOT EXISTS send_error TEXT;

CREATE INDEX IF NOT EXISTS idx_dds_sent ON digital_distributions(sent_at);

-- Per-send audit: one row per assignee per send action.
CREATE TABLE IF NOT EXISTS digital_send_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       UUID REFERENCES digital_distribution_batches(id) ON DELETE SET NULL,
    assignee_name  TEXT NOT NULL,
    assignee_email TEXT NOT NULL,
    lead_count     INT  NOT NULL DEFAULT 0,
    status         VARCHAR(16) NOT NULL DEFAULT 'SENT'
                       CHECK (status IN ('SENT','FAILED')),
    error          TEXT,
    sent_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsl_sent_at ON digital_send_log(sent_at DESC);
