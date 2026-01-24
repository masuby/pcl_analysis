//go:build ignore
// +build ignore

package main

import (
	"log"
	"os"
	"path/filepath"

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
		User:     getEnv("DB_USER", "masubi"),
		Password: getEnv("DB_PASSWORD", "Masubi98%"),
		DBName:   getEnv("DB_NAME", "pcl_analysis"),
		SSLMode:  getEnv("DB_SSLMODE", "disable"),
	}

	// Connect to database
	if err := database.InitPostgres(dbConfig); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	// Get upload path - use absolute path or relative from backend directory
	uploadPath := getEnv("UPLOAD_PATH", "../uploads")

	// If running from scripts directory, adjust path
	if _, err := os.Stat(uploadPath); os.IsNotExist(err) {
		uploadPath = "/home/masubi/Desktop/code/pcl_analysis/backend/uploads"
	}

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
			log.Printf("File not found: %s", report.FileName)
			failed++
			continue
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
