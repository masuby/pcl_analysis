//go:build ignore
// +build ignore

package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/pcl/pcl-api/internal/services"
)

func main() {
	// Load .env file
	_ = godotenv.Load("../.env")

	// Database config
	dbConfig := &config.DatabaseConfig{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     getEnv("DB_PORT", "5432"),
		User:     getEnv("DB_USER", "pcl_user"),
		Password: getEnv("DB_PASSWORD", "Masubi98%"),
		DBName:   getEnv("DB_NAME", "pcl_analysis"),
		SSLMode:  getEnv("DB_SSLMODE", "disable"),
	}

	// Connect to database
	if err := database.InitPostgres(dbConfig); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	// Resolve upload path: relative paths are resolved from backend dir (same as sync_readable_to_db)
	cwd, _ := os.Getwd()
	backendDir := cwd
	if strings.HasSuffix(cwd, "scripts") || strings.Contains(filepath.ToSlash(cwd), "/scripts") {
		backendDir = filepath.Dir(cwd)
	}
	uploadPath := getEnv("UPLOAD_PATH", filepath.Join(backendDir, "uploads"))
	if !filepath.IsAbs(uploadPath) {
		uploadPath = filepath.Join(backendDir, strings.TrimPrefix(uploadPath, "./"))
	}
	uploadPath, _ = filepath.Abs(uploadPath)
	log.Printf("Upload path: %s", uploadPath)

	// Get all reports
	reports, _, err := models.GetAllReports("", "", 1000, 0)
	if err != nil {
		log.Fatalf("Failed to get reports: %v", err)
	}

	log.Printf("Found %d reports to parse", len(reports))

	parsed := 0
	failed := 0

	for _, report := range reports {
		// Check if file exists
		fullPath := filepath.Join(uploadPath, report.FilePath)
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			log.Printf("File not found: %s (path: %s)", report.FileName, fullPath)
			failed++
			continue
		}

		// Delete old parsed data before re-inserting
		if err := models.DeleteReportData(report.ID); err != nil {
			log.Printf("Warning: DeleteReportData failed for %s: %v", report.FileName, err)
		}

		// Parse and store data
		if err := services.ParseAndStoreExcelData(report.ID, fullPath, report.Date); err != nil {
			log.Printf("Failed to parse %s: %v", report.FileName, err)
			failed++
			continue
		}

		parsed++
		log.Printf("[%d/%d] Parsed: %s", parsed, len(reports), report.FileName)
	}

	log.Printf("Done! Parsed: %d, Failed: %d", parsed, failed)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
