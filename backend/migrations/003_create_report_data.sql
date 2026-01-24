-- Migration: Create report_data table
-- Description: Creates the report_data table for pre-parsed Excel data (THE KEY TO PERFORMANCE!)

-- Create report_data table for storing parsed Excel data
CREATE TABLE IF NOT EXISTS report_data (
    id BIGSERIAL PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    branch VARCHAR(100) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,2),
    report_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_report_data_report_id ON report_data(report_id);
CREATE INDEX IF NOT EXISTS idx_report_data_branch ON report_data(branch);
CREATE INDEX IF NOT EXISTS idx_report_data_metric ON report_data(metric_name);
CREATE INDEX IF NOT EXISTS idx_report_data_date ON report_data(report_date);

-- Composite indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_report_data_branch_metric ON report_data(branch, metric_name);
CREATE INDEX IF NOT EXISTS idx_report_data_date_branch ON report_data(report_date, branch);
CREATE INDEX IF NOT EXISTS idx_report_data_report_branch ON report_data(report_id, branch);

-- Create materialized view for dashboard summary (instant loading!)
CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_summary AS
SELECT 
    r.department,
    rd.branch,
    rd.metric_name,
    rd.report_date,
    SUM(rd.metric_value) as total_value,
    AVG(rd.metric_value) as avg_value,
    COUNT(*) as data_points
FROM report_data rd
JOIN reports r ON rd.report_id = r.id
WHERE r.is_active = true
GROUP BY r.department, rd.branch, rd.metric_name, rd.report_date;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_summary_unique 
ON dashboard_summary(department, branch, metric_name, report_date);

-- Create additional indexes on materialized view
CREATE INDEX IF NOT EXISTS idx_dashboard_summary_dept ON dashboard_summary(department);
CREATE INDEX IF NOT EXISTS idx_dashboard_summary_branch ON dashboard_summary(branch);
CREATE INDEX IF NOT EXISTS idx_dashboard_summary_date ON dashboard_summary(report_date DESC);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_dashboard_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_summary;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to refresh the view periodically
-- This requires pg_cron extension, uncomment if available:
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('refresh-dashboard', '*/15 * * * *', 'SELECT refresh_dashboard_summary()');

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE report_data TO pcl_user;
GRANT ALL PRIVILEGES ON TABLE dashboard_summary TO pcl_user;
GRANT USAGE, SELECT ON SEQUENCE report_data_id_seq TO pcl_user;
