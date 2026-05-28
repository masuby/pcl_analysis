-- Migration 015: Local Trip file storage
-- Stores the 4 uploaded file types for Local Trip Report processing.
-- One active record per kind is maintained; previous versions are retained for audit.

CREATE TABLE IF NOT EXISTS local_trip_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        VARCHAR(20) NOT NULL
                    CHECK (kind IN ('LOCAL_TRIP','SALES','USERS','ACTIVITIES')),
    file_name   VARCHAR(255) NOT NULL,
    file_path   VARCHAR(500) NOT NULL,
    file_size   BIGINT DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    is_deleted  BOOLEAN DEFAULT false,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one active file per kind at a time
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'ux_ltf_active_kind'
    ) THEN
        CREATE UNIQUE INDEX ux_ltf_active_kind
            ON local_trip_files(kind)
            WHERE is_active = true AND is_deleted = false;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ltf_kind_created
    ON local_trip_files(kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ltf_uploaded_by
    ON local_trip_files(uploaded_by);

DROP TRIGGER IF EXISTS update_local_trip_files_updated_at ON local_trip_files;
CREATE TRIGGER update_local_trip_files_updated_at
    BEFORE UPDATE ON local_trip_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
