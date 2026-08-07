-- Migration 019: Add ZONE_CLUSTERS kind to local_trip_files
--
-- The Team Building report accepts an optional "Zone and Clusters" workbook
-- (Branch -> Cluster mapping) used to add the Cluster column and the
-- Qualified / Not Qualified Cluster tables.
--
-- Drop the existing check constraint and recreate it with ZONE_CLUSTERS included.

DO $$
DECLARE
    v_constraint_name text;
BEGIN
    SELECT constraint_name INTO v_constraint_name
    FROM information_schema.table_constraints
    WHERE table_name      = 'local_trip_files'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%kind%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE local_trip_files DROP CONSTRAINT ' || quote_ident(v_constraint_name);
    END IF;
END $$;

ALTER TABLE local_trip_files
    ADD CONSTRAINT local_trip_files_kind_check
    CHECK (kind IN ('LOCAL_TRIP','SALES','USERS','ACTIVITIES','LOAN','ZONE_CLUSTERS'));
