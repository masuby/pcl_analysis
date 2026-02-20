-- Migration: Create gap_actual_reps table for Team Leader Actual Sales Rep submissions
-- Used by Gap Analysis: TL submits value via link; HOD fetches and sees in table

CREATE TABLE IF NOT EXISTS gap_actual_reps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    team_leader_key VARCHAR(500) NOT NULL,
    product VARCHAR(50) NOT NULL DEFAULT 'CS',
    value NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(report_id, team_leader_key)
);

CREATE INDEX IF NOT EXISTS idx_gap_actual_reps_report_id ON gap_actual_reps(report_id);

DROP TRIGGER IF EXISTS update_gap_actual_reps_updated_at ON gap_actual_reps;
CREATE TRIGGER update_gap_actual_reps_updated_at
    BEFORE UPDATE ON gap_actual_reps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
