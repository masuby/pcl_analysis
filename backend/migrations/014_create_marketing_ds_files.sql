-- Migration 014: Marketing Digital Sales file storage
-- One active record per year; parsed JSON stored alongside the raw file path.

CREATE TABLE IF NOT EXISTS marketing_digital_sales_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year        INTEGER NOT NULL,
    file_name   VARCHAR(255) NOT NULL,
    file_path   VARCHAR(500) NOT NULL,
    file_size   BIGINT DEFAULT 0,
    parsed_data JSONB,                          -- full parsed YearData JSON
    is_active   BOOLEAN DEFAULT true,
    is_deleted  BOOLEAN DEFAULT false,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one active file per year
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'ux_mds_active_year'
    ) THEN
        CREATE UNIQUE INDEX ux_mds_active_year
            ON marketing_digital_sales_files(year)
            WHERE is_active = true AND is_deleted = false;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mds_year_created
    ON marketing_digital_sales_files(year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mds_uploaded_by
    ON marketing_digital_sales_files(uploaded_by);

DROP TRIGGER IF EXISTS update_marketing_ds_files_updated_at ON marketing_digital_sales_files;
CREATE TRIGGER update_marketing_ds_files_updated_at
    BEFORE UPDATE ON marketing_digital_sales_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
