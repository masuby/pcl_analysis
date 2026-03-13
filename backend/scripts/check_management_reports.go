//go:build ignore
// +build ignore

// check_management_reports queries the database for MANAGEMENT reports dated March 3 and March 7,
// and verifies whether they have report_data (so they appear in Management Summary / useManagementData).
//
// Run from backend dir: go run ./scripts/check_management_reports.go
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/database"
)

func main() {
	// Load .env from backend directory
	cwd, _ := os.Getwd()
	backendDir := cwd
	if strings.HasSuffix(cwd, "scripts") || strings.Contains(filepath.ToSlash(cwd), "/scripts") {
		backendDir = filepath.Dir(cwd)
	}
	_ = godotenv.Load(filepath.Join(backendDir, ".env"))

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Config load: %v", err)
	}
	if err := database.InitPostgres(&cfg.Database); err != nil {
		log.Fatalf("Database connect: %v", err)
	}
	defer database.Close()

	// 1) MANAGEMENT reports in DB (same filters as GetAllReports with type=MANAGEMENT)
	fmt.Println("=== MANAGEMENT reports (is_active=true, type=MANAGEMENT) with date March 3 or March 7 (any year) ===")
	queryReports := `
		SELECT id, title, file_name, date, created_at
		FROM reports
		WHERE is_active = true AND UPPER(TRIM(type)) = 'MANAGEMENT'
		  AND EXTRACT(MONTH FROM date) = 3 AND EXTRACT(DAY FROM date) IN (3, 7)
		ORDER BY date, created_at DESC`
	rows, err := database.DB.Query(queryReports)
	if err != nil {
		log.Fatalf("Query reports: %v", err)
	}
	defer rows.Close()

	type reportRow struct {
		id        string
		title     string
		fileName  string
		date      interface{}
		createdAt interface{}
	}
	var reports []reportRow
	for rows.Next() {
		var r reportRow
		var date, createdAt interface{}
		if err := rows.Scan(&r.id, &r.title, &r.fileName, &date, &createdAt); err != nil {
			log.Printf("Scan report: %v", err)
			continue
		}
		r.date = date
		r.createdAt = createdAt
		reports = append(reports, r)
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("Rows: %v", err)
	}

	if len(reports) == 0 {
		fmt.Println("No MANAGEMENT reports found with date = March 3 or March 7.")
		fmt.Println("(GetAllReports returns reports with is_active=true, type=MANAGEMENT; useManagementData fetches limit 500.)")
		return
	}

	fmt.Printf("Found %d report(s):\n", len(reports))
	for _, r := range reports {
		fmt.Printf("  ID: %s  date: %v  file: %s  title: %s\n", r.id, r.date, r.fileName, r.title)
	}

	// 2) For each, count report_data rows (Country sheet) — same condition as GetAllManagementReportData
	fmt.Println("\n=== report_data (Country sheet) for these reports — used by batch endpoint and useManagementData ===")
	for _, r := range reports {
		var count int
		err := database.DB.QueryRow(`
			SELECT COUNT(*) FROM report_data rd
			WHERE rd.report_id = $1 AND (rd.sheet_name = 'Country' OR rd.sheet_name IS NULL)`,
			r.id).Scan(&count)
		if err != nil {
			log.Printf("Count for %s: %v", r.id, err)
			continue
		}
		used := "YES — will appear in Management Summary and useManagementData parsedReports"
		if count == 0 {
			used = "NO — report will NOT appear in parsedReports (no Country sheet data)"
		}
		fmt.Printf("  Report %s (%s): %d rows in report_data (Country) → %s\n", r.id, r.fileName, count, used)
	}

	// 3) Total MANAGEMENT reports count (to confirm limit 500 is enough)
	var total int
	_ = database.DB.QueryRow(`
		SELECT COUNT(*) FROM reports WHERE is_active = true AND UPPER(TRIM(type)) = 'MANAGEMENT'`).Scan(&total)
	fmt.Printf("\nTotal MANAGEMENT reports in DB: %d (useManagementData fetches limit 500)\n", total)
}
