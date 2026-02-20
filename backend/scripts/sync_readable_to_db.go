//go:build ignore
// +build ignore

package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/pcl/pcl-api/internal/services"
)

type MgmtReportMeta struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	FileName    string `json:"file_name"`
	FilePath    string `json:"file_path"`
	FileSize    string `json:"file_size"`
	Department  string `json:"department"`
	Type        string `json:"type"`
	Date        string `json:"date"`
	CreatedAt   string `json:"created_at"`
}

type ReadableEntry struct {
	ReportID        string `json:"report_id"`
	FilePath        string `json:"file_path"`
	Date            string `json:"date"`
	ReadableFilename string `json:"readable_filename"`
	RowsUpdated     int    `json:"rows_updated"`
}

type ReadableMetadata struct {
	Generated string          `json:"generated"`
	Reports   []ReadableEntry `json:"reports"`
}

func main() {
	quickMode := flag.Bool("quick", false, "Copy files + update DB only; skip re-parse (fast, ~seconds). Run reparse_all later for analysis data.")
	workers := flag.Int("workers", 4, "Number of parallel workers for full sync (parse). Default 4.")
	flag.Parse()

	_ = godotenv.Load("../.env")

	dbConfig := &config.DatabaseConfig{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     getEnv("DB_PORT", "5432"),
		User:     getEnv("DB_USER", "pcl_user"),
		Password: getEnv("DB_PASSWORD", "Masubi98%"),
		DBName:   getEnv("DB_NAME", "pcl_analysis"),
		SSLMode:  getEnv("DB_SSLMODE", "disable"),
	}

	if err := database.InitPostgres(dbConfig); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	// Resolve paths: run from backend/ or backend/scripts/
	cwd, _ := os.Getwd()
	backendDir := cwd
	if strings.HasSuffix(cwd, "scripts") || strings.Contains(filepath.ToSlash(cwd), "/scripts") {
		backendDir = filepath.Dir(cwd)
	}
	mgmtMetaPath := filepath.Join(backendDir, "ManagementCorrection", "management_reports_metadata.json")
	readableMetaPath := filepath.Join(backendDir, "ManagementCorrection", "readable", "readable_metadata.json")
	readableDir := filepath.Join(backendDir, "ManagementCorrection", "readable")
	uploadPath := getEnv("UPLOAD_PATH", filepath.Join(backendDir, "uploads"))
	if !filepath.IsAbs(uploadPath) {
		uploadPath = filepath.Join(backendDir, strings.TrimPrefix(uploadPath, "./"))
	}
	uploadPath, _ = filepath.Abs(uploadPath)
	uploadsMgmt := filepath.Join(uploadPath, "ALL", "MANAGEMENT")

	if _, err := os.Stat(mgmtMetaPath); os.IsNotExist(err) {
		log.Fatalf("Management metadata not found: %s", mgmtMetaPath)
	}
	if _, err := os.Stat(readableMetaPath); os.IsNotExist(err) {
		log.Fatalf("Readable metadata not found: %s", readableMetaPath)
	}

	// Load management_reports_metadata.json
	mgmtData, err := os.ReadFile(mgmtMetaPath)
	if err != nil {
		log.Fatalf("Failed to read management metadata: %v", err)
	}
	var mgmtReports []MgmtReportMeta
	if err := json.Unmarshal(mgmtData, &mgmtReports); err != nil {
		log.Fatalf("Failed to parse management metadata: %v", err)
	}

	// Load readable_metadata.json
	readableData, err := os.ReadFile(readableMetaPath)
	if err != nil {
		log.Fatalf("Failed to read readable metadata: %v", err)
	}
	var readableMeta ReadableMetadata
	if err := json.Unmarshal(readableData, &readableMeta); err != nil {
		log.Fatalf("Failed to parse readable metadata: %v", err)
	}

	// Map report_id -> readable entry
	readableByID := make(map[string]ReadableEntry)
	for _, e := range readableMeta.Reports {
		readableByID[e.ReportID] = e
	}

	// Build mgmt report by id for metadata
	mgmtByID := make(map[string]MgmtReportMeta)
	for _, r := range mgmtReports {
		mgmtByID[r.ID] = r
	}

	if err := os.MkdirAll(uploadsMgmt, 0755); err != nil {
		log.Fatalf("Failed to create uploads dir: %v", err)
	}

	log.Println("=" + strings.Repeat("=", 59))
	log.Println("  Sync Readable Management Reports to Database")
	log.Println("=" + strings.Repeat("=", 59))
	if *quickMode {
		log.Println("  MODE: QUICK (copy + DB update only, no re-parse)")
		log.Println("  Run: go run scripts/reparse_all.go  later to update analysis data.")
	} else {
		log.Printf("  MODE: FULL (copy + DB + re-parse, workers=%d)\n", *workers)
	}
	log.Printf("\nReadable dir: %s", readableDir)
	log.Printf("Uploads dest: %s", uploadsMgmt)
	log.Printf("Reports to sync: %d\n", len(readableMeta.Reports))

	var synced, failed int
	var mu sync.Mutex

	process := func(entry ReadableEntry) bool {
		reportID, err := uuid.Parse(entry.ReportID)
		if err != nil {
			log.Printf("  Skip invalid report_id: %s", entry.ReportID)
			return false
		}

		_, ok := mgmtByID[entry.ReportID]
		if !ok {
			log.Printf("  Skip (no mgmt meta): %s", entry.ReadableFilename)
			return false
		}

		srcPath := filepath.Join(readableDir, entry.ReadableFilename)
		if _, err := os.Stat(srcPath); os.IsNotExist(err) {
			log.Printf("  Skip (file not found): %s", entry.ReadableFilename)
			return false
		}

		// Destination: uploads/ALL/MANAGEMENT/{readable_filename}
		dstPath := filepath.Join(uploadsMgmt, entry.ReadableFilename)

		// Copy file
		if err := copyFile(srcPath, dstPath); err != nil {
			log.Printf("  Copy failed %s: %v", entry.ReadableFilename, err)
			return false
		}

		// Title from readable filename: "Management_Report_2026-02-11.xlsx" -> "Management Report 2026-02-11"
		title := readableToTitle(entry.ReadableFilename)

		// file_path for DB: ALL/MANAGEMENT/Management_Report_2026-02-11.xlsx
		dbFilePath := filepath.Join("ALL", "MANAGEMENT", entry.ReadableFilename)
		dbFilePath = filepath.ToSlash(dbFilePath)

		info, _ := os.Stat(dstPath)
		fileSize := int64(0)
		if info != nil {
			fileSize = info.Size()
		}

		// Update report in database (title from readable; rest from mgmt metadata except title)
		_, err = models.UpdateReportFile(reportID, &models.ReportFileUpdate{
			Title:    title,
			FileName: entry.ReadableFilename,
			FilePath: dbFilePath,
			FileSize: fileSize,
		})
		if err != nil {
			log.Printf("  DB update failed %s: %v", entry.ReadableFilename, err)
			return false
		}

		if !*quickMode {
			// Delete old report_data and re-parse
			if err := models.DeleteReportData(reportID); err != nil {
				log.Printf("  DeleteReportData failed %s: %v", entry.ReadableFilename, err)
			}

			report, err := models.GetReportByID(reportID)
			if err != nil {
				log.Printf("  GetReport failed %s: %v", entry.ReadableFilename, err)
				return false
			}

			if err := services.ParseAndStoreExcelData(report.ID, dstPath, report.Date); err != nil {
				log.Printf("  Parse failed %s: %v", entry.ReadableFilename, err)
			}
		}

		log.Printf("  OK %s -> %s (title: %s)", entry.ReadableFilename, dbFilePath, title)
		return true
	}

	if *quickMode {
		for _, entry := range readableMeta.Reports {
			if process(entry) {
				synced++
			} else {
				failed++
			}
		}
	} else {
		// Parallel: send work to workers
		jobs := make(chan ReadableEntry, len(readableMeta.Reports))
		var wg sync.WaitGroup
		for w := 0; w < *workers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for entry := range jobs {
					ok := process(entry)
					mu.Lock()
					if ok {
						synced++
					} else {
						failed++
					}
					mu.Unlock()
				}
			}()
		}
		for _, entry := range readableMeta.Reports {
			jobs <- entry
		}
		close(jobs)
		wg.Wait()
	}

	// Invalidate caches so website gets fresh data
	_ = database.CacheDeletePattern("reports:*")
	_ = database.CacheDeletePattern("batch_report_data:*")
	_ = database.CacheDeletePattern("dashboard:*")

	log.Println("\n" + strings.Repeat("=", 60))
	log.Printf("Done: Synced %d, Failed %d", synced, failed)
	log.Println(strings.Repeat("=", 60))
}

func readableToTitle(filename string) string {
	// "Management_Report_2026-02-11.xlsx" -> "Management Report 2026-02-11"
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	name = strings.ReplaceAll(name, "_", " ")
	return name
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
