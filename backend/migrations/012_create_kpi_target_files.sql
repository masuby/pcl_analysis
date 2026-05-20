-- Migration: Create KPI target file storage
-- Stores uploaded KPI target XLSX files (versions) and their parsed JSON.

CREATE TABLE IF NOT EXISTS kpi_target_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product VARCHAR(20) NOT NULL, -- CS / LBF / SME
    kind VARCHAR(20) NOT NULL,    -- TOTAL / CLUSTER
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for filtering by active product/kind and listing versions
CREATE INDEX IF NOT EXISTS idx_kpi_target_files_product_kind_created
    ON kpi_target_files(product, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_target_files_uploaded_by
    ON kpi_target_files(uploaded_by);

-- Ensure only one active version per product+kind (soft-delete friendly)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE indexname = 'ux_kpi_target_files_active_product_kind'
    ) THEN
        CREATE UNIQUE INDEX ux_kpi_target_files_active_product_kind
        ON kpi_target_files(product, kind)
        WHERE is_active = true AND is_deleted = false;
    END IF;
END $$;

-- Parsed representation for KPI target files
CREATE TABLE IF NOT EXISTS kpi_target_parsed (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL UNIQUE REFERENCES kpi_target_files(id) ON DELETE CASCADE,
    parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_target_parsed_created_at
    ON kpi_target_parsed(created_at DESC);

-- Update updated_at timestamps (uses the shared helper if already present)
-- If update_updated_at_column() doesn't exist, migrations will fail; this project already uses it.
DROP TRIGGER IF EXISTS update_kpi_target_files_updated_at ON kpi_target_files;
CREATE TRIGGER update_kpi_target_files_updated_at
    BEFORE UPDATE ON kpi_target_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_kpi_target_parsed_updated_at ON kpi_target_parsed;
CREATE TRIGGER update_kpi_target_parsed_updated_at
    BEFORE UPDATE ON kpi_target_parsed
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

