package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/models"
)

// InitMarketingHandlers creates the upload directory for marketing files.
// It reuses the package-level uploadPath set by InitReportHandlers.
func InitMarketingHandlers() {
	dir := filepath.Join(uploadPath, "marketing", "digital_sales")
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Printf("Warning: Could not create marketing upload dir %s: %v\n", dir, err)
	}
}

// POST /api/marketing/digital-sales/upload
// multipart/form-data fields:
//
//	file        – the .xlsx file
//	year        – 4-digit integer year (e.g. "2026")
//	parsed_data – JSON string of the client-parsed YearData object
func UploadMarketingDSFile(c *gin.Context) {
	userID, err := middleware.GetUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Not authenticated"})
		return
	}

	if err := c.Request.ParseMultipartForm(maxFileSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "File too large or invalid form data"})
		return
	}

	// Validate year
	yearStr := c.PostForm("year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2000 || year > 2100 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid or missing year"})
		return
	}

	// Decode parsed_data
	parsedDataStr := c.PostForm("parsed_data")
	var parsedData map[string]interface{}
	if parsedDataStr != "" {
		if err := json.Unmarshal([]byte(parsedDataStr), &parsedData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "parsed_data is not valid JSON"})
			return
		}
	}

	// Read uploaded file
	file, header, err := c.Request.FormFile("file")
	if err != nil || header == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "No file provided"})
		return
	}
	defer file.Close()

	// Build disk path: uploads/marketing/digital_sales/<timestamp>_<filename>
	timestamp := time.Now().UnixNano()
	safeFileName := fmt.Sprintf("%d_%s", timestamp, header.Filename)
	relPath := filepath.Join("marketing", "digital_sales", safeFileName)
	fullPath := filepath.Join(uploadPath, relPath)

	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create upload directory"})
		return
	}

	dst, err := os.Create(fullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create destination file"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to save uploaded file"})
		return
	}

	record, err := models.UpsertMarketingDSFile(&models.MarketingDSFileCreate{
		Year:       year,
		FileName:   header.Filename,
		FilePath:   relPath,
		FileSize:   header.Size,
		ParsedData: parsedData,
	}, userID)
	if err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save record: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": record})
}

// GET /api/marketing/digital-sales/files
// Returns all active (non-deleted) files with their parsed data.
func GetMarketingDSFiles(c *gin.Context) {
	files, err := models.ListActiveMarketingDSFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to list files: " + err.Error()})
		return
	}
	if files == nil {
		files = []*models.MarketingDSFile{}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": files})
}

// DELETE /api/marketing/digital-sales/files/:year
// Soft-deletes the active file for the given year.
func DeleteMarketingDSFile(c *gin.Context) {
	yearStr := c.Param("year")
	year, err := strconv.Atoi(yearStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid year"})
		return
	}
	if err := models.DeleteMarketingDSFileForYear(year); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GET /api/marketing/digital-sales/files/:year/download
// Serves the original uploaded Excel file for download.
func DownloadMarketingDSFile(c *gin.Context) {
	yearStr := c.Param("year")
	year, err := strconv.Atoi(yearStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid year"})
		return
	}

	f, err := models.GetMarketingDSFileByYear(year)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "File not found for year"})
		return
	}

	fullPath := filepath.Join(uploadPath, f.FilePath)
	if _, statErr := os.Stat(fullPath); statErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "File missing from disk"})
		return
	}

	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.FileAttachment(fullPath, f.FileName)
}
