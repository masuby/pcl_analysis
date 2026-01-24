-- Migration: Add sheet_name and row_type columns to report_data
-- Description: Enables regional/branch analysis by tracking which sheet data comes from
--              and what type of row it represents (Total, Team Leader, Sales Rep, etc.)

-- Add sheet_name column (default 'Country' for backward compatibility)
ALTER TABLE report_data 
ADD COLUMN IF NOT EXISTS sheet_name VARCHAR(100) DEFAULT 'Country';

-- Add row_type column (default 'Branch' for backward compatibility)
ALTER TABLE report_data 
ADD COLUMN IF NOT EXISTS row_type VARCHAR(50) DEFAULT 'Branch';

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_report_data_sheet_name ON report_data(sheet_name);
CREATE INDEX IF NOT EXISTS idx_report_data_row_type ON report_data(row_type);

-- Composite indexes for regional analysis queries
CREATE INDEX IF NOT EXISTS idx_report_data_sheet_branch ON report_data(sheet_name, branch);
CREATE INDEX IF NOT EXISTS idx_report_data_sheet_rowtype ON report_data(sheet_name, row_type);
CREATE INDEX IF NOT EXISTS idx_report_data_sheet_date ON report_data(sheet_name, report_date);

-- Update existing data to have proper sheet_name (Country) if NULL
UPDATE report_data SET sheet_name = 'Country' WHERE sheet_name IS NULL;
UPDATE report_data SET row_type = 'Branch' WHERE row_type IS NULL;

-- Recreate materialized view with new columns
DROP MATERIALIZED VIEW IF EXISTS dashboard_summary;

CREATE MATERIALIZED VIEW dashboard_summary AS
SELECT 
    r.department,
    COALESCE(rd.sheet_name, 'Country') as sheet_name,
    rd.branch,
    COALESCE(rd.row_type, 'Branch') as row_type,
    rd.metric_name,
    rd.report_date,
    SUM(rd.metric_value) as total_value,
    AVG(rd.metric_value) as avg_value,
    COUNT(*) as data_points
FROM report_data rd
JOIN reports r ON rd.report_id = r.id
WHERE r.is_active = true
GROUP BY r.department, rd.sheet_name, rd.branch, rd.row_type, rd.metric_name, rd.report_date;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_dashboard_summary_unique 
ON dashboard_summary(department, sheet_name, branch, row_type, metric_name, report_date);

-- Create additional indexes on materialized view
CREATE INDEX idx_dashboard_summary_dept ON dashboard_summary(department);
CREATE INDEX idx_dashboard_summary_sheet ON dashboard_summary(sheet_name);
CREATE INDEX idx_dashboard_summary_branch ON dashboard_summary(branch);
CREATE INDEX idx_dashboard_summary_rowtype ON dashboard_summary(row_type);
CREATE INDEX idx_dashboard_summary_date ON dashboard_summary(report_date DESC);

-- Grant permissions (adjust user name as needed)
-- GRANT ALL PRIVILEGES ON TABLE dashboard_summary TO pcl_user;
