-- Migration: Create procedures table
-- Description: Creates the procedures table for storing report procedure documentation

-- Create procedures table
CREATE TABLE IF NOT EXISTS procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type VARCHAR(50) NOT NULL,
    department VARCHAR(100),
    content JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(report_type, department)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_procedures_report_type ON procedures(report_type);
CREATE INDEX IF NOT EXISTS idx_procedures_department ON procedures(department);
CREATE INDEX IF NOT EXISTS idx_procedures_created_at ON procedures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_procedures_created_by ON procedures(created_by);

-- Composite index for unique lookups
CREATE INDEX IF NOT EXISTS idx_procedures_type_dept ON procedures(report_type, department);

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_procedures_updated_at ON procedures;
CREATE TRIGGER update_procedures_updated_at
    BEFORE UPDATE ON procedures
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
-- GRANT ALL PRIVILEGES ON TABLE procedures TO pcl_user;
