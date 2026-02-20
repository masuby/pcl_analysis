-- Migration: Store email per recipient (Branch TL or RSM) for Gap Analysis upload flow
-- Key = team_leader_key (Branch: "Name|Supervision", RSM: "RSM:Supervision")

CREATE TABLE IF NOT EXISTS gap_recipient_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    recipient_key VARCHAR(500) NOT NULL,
    product VARCHAR(50) NOT NULL DEFAULT 'CS',
    email VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(report_id, recipient_key)
);

CREATE INDEX IF NOT EXISTS idx_gap_recipient_emails_report_id ON gap_recipient_emails(report_id);

DROP TRIGGER IF EXISTS update_gap_recipient_emails_updated_at ON gap_recipient_emails;
CREATE TRIGGER update_gap_recipient_emails_updated_at
    BEFORE UPDATE ON gap_recipient_emails
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
