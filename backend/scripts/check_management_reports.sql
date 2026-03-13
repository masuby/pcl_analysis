-- Check MANAGEMENT reports for March 3 and March 7 (any year)
-- and whether they have report_data (Country sheet) so they appear in Management Summary / useManagementData.
--
-- Run with: docker exec -i pcl-postgres psql -U pcl_user -d pcl_analysis -f - < scripts/check_management_reports.sql
-- Or from host: psql -h localhost -U pcl_user -d pcl_analysis -f scripts/check_management_reports.sql

\echo '=== MANAGEMENT reports (is_active=true, type=MANAGEMENT) with date March 3 or March 7 ==='
SELECT id, title, file_name, date, created_at
FROM reports
WHERE is_active = true AND UPPER(TRIM(type)) = 'MANAGEMENT'
  AND EXTRACT(MONTH FROM date) = 3 AND EXTRACT(DAY FROM date) IN (3, 7)
ORDER BY date, created_at DESC;

\echo ''
\echo '=== report_data (Country sheet) count per report — only reports with rows here appear in parsedReports ==='
SELECT r.id, r.file_name, r.date,
       (SELECT COUNT(*) FROM report_data rd
        WHERE rd.report_id = r.id AND (rd.sheet_name = 'Country' OR rd.sheet_name IS NULL)) AS country_rows
FROM reports r
WHERE r.is_active = true AND UPPER(TRIM(r.type)) = 'MANAGEMENT'
  AND EXTRACT(MONTH FROM r.date) = 3 AND EXTRACT(DAY FROM r.date) IN (3, 7)
ORDER BY r.date;

\echo ''
\echo '=== Total MANAGEMENT reports (useManagementData fetches limit 500) ==='
SELECT COUNT(*) AS total_management_reports
FROM reports
WHERE is_active = true AND UPPER(TRIM(type)) = 'MANAGEMENT';
