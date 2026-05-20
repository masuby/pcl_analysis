-- Migration: Create Settlement file storage
-- Stores uploaded Settlements XLSX files (Transactions / Zone & Cluster) and their metadata.
-- Parsing is performed client-side for flexibility; only the raw file is stored.

CREATE TABLE IF NOT EXISTS settlement_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(40) NOT NULL, -- TRANSACTIONS / ZONE_CLUSTER
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_files_kind_created
    ON settlement_files(kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_files_uploaded_by
    ON settlement_files(uploaded_by);

-- Ensure only one active version per kind (soft-delete friendly).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE indexname = 'ux_settlement_files_active_kind'
    ) THEN
        CREATE UNIQUE INDEX ux_settlement_files_active_kind
        ON settlement_files(kind)
        WHERE is_active = true AND is_deleted = false;
    END IF;
END $$;

DROP TRIGGER IF EXISTS update_settlement_files_updated_at ON settlement_files;
CREATE TRIGGER update_settlement_files_updated_at
    BEFORE UPDATE ON settlement_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
