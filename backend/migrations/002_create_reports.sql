-- Migration: Create reports table
-- Description: Creates the reports table for report metadata storage

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT DEFAULT 0,
    department VARCHAR(100),
    type VARCHAR(50),
    date DATE,
    views INTEGER DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reports_department ON reports(department);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);
CREATE INDEX IF NOT EXISTS idx_reports_is_active ON reports(is_active);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_uploaded_by ON reports(uploaded_by);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_reports_dept_type ON reports(department, type);
CREATE INDEX IF NOT EXISTS idx_reports_dept_date ON reports(department, date DESC);
CREATE INDEX IF NOT EXISTS idx_reports_active_created ON reports(is_active, created_at DESC);

-- Full text search index for report search
CREATE INDEX IF NOT EXISTS idx_reports_search ON reports 
USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(file_name, '')));

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_reports_updated_at ON reports;
CREATE TRIGGER update_reports_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
-- GRANT ALL PRIVILEGES ON TABLE reports TO pcl_user;
