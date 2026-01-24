-- Add indexes for faster queries on report_data table
-- These indexes will significantly improve query performance for dashboard and regional analysis

-- Index for filtering by report_id (most common query)
CREATE INDEX IF NOT EXISTS idx_report_data_report_id ON report_data(report_id);

-- Index for filtering by sheet_name (for regional analysis)
CREATE INDEX IF NOT EXISTS idx_report_data_sheet_name ON report_data(sheet_name);

-- Index for filtering by branch (for cluster and regional analysis)
CREATE INDEX IF NOT EXISTS idx_report_data_branch ON report_data(branch);

-- Index for filtering by row_type (for regional analysis)
CREATE INDEX IF NOT EXISTS idx_report_data_row_type ON report_data(row_type);

-- Composite index for common query pattern: type + sheet_name + report_date
CREATE INDEX IF NOT EXISTS idx_report_data_type_sheet_date ON report_data(report_id, sheet_name, report_date DESC);

-- Composite index for regional analysis: sheet_name + branch + report_date
CREATE INDEX IF NOT EXISTS idx_report_data_sheet_branch_date ON report_data(sheet_name, branch, report_date DESC);

-- Index for filtering by report_date (for date range queries)
CREATE INDEX IF NOT EXISTS idx_report_data_report_date ON report_data(report_date DESC);

-- Composite index for management reports with active status
CREATE INDEX IF NOT EXISTS idx_reports_type_active ON reports(type, is_active) WHERE type = 'MANAGEMENT' AND is_active = true;

-- Index for report date filtering
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date DESC) WHERE date IS NOT NULL;
