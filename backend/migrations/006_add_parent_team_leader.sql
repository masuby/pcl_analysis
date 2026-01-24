-- Migration: Add parent_team_leader column to track Sales Rep -> Team Leader relationship
-- This enables filtering Sales Reps by their Team Leader

-- Add the parent_team_leader column
ALTER TABLE report_data ADD COLUMN IF NOT EXISTS parent_team_leader VARCHAR(255) DEFAULT '';

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_report_data_parent_team_leader ON report_data(parent_team_leader);

-- Create composite index for regional analysis queries
CREATE INDEX IF NOT EXISTS idx_report_data_regional_hierarchy ON report_data(sheet_name, row_type, parent_team_leader);

-- Verify the column was added
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'report_data' AND column_name = 'parent_team_leader'
    ) THEN
        RAISE NOTICE 'Migration successful: parent_team_leader column added';
    ELSE
        RAISE EXCEPTION 'Migration failed: parent_team_leader column was not created';
    END IF;
END $$;
