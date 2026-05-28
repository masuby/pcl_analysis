-- Migration 017: Consent Incentive file storage
-- Stores the Lead file uploaded for Consent Incentive Report processing.
-- Only LEAD kind is supported. One active record maintained per kind.

CREATE TABLE IF NOT EXISTS consent_incentive_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        VARCHAR(20) NOT NULL CHECK (kind IN ('LEAD')),
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
        WHERE indexname = 'ux_cif_active_kind'
    ) THEN
        CREATE UNIQUE INDEX ux_cif_active_kind
            ON consent_incentive_files(kind)
            WHERE is_active = true AND is_deleted = false;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cif_kind_created
    ON consent_incentive_files(kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cif_uploaded_by
    ON consent_incentive_files(uploaded_by);

DROP TRIGGER IF EXISTS update_consent_incentive_files_updated_at ON consent_incentive_files;
CREATE TRIGGER update_consent_incentive_files_updated_at
    BEFORE UPDATE ON consent_incentive_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
