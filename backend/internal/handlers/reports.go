package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/pcl/pcl-api/internal/services"
)

var uploadPath string
var maxFileSize int64

// InitReportHandlers initializes report handlers with config
func InitReportHandlers(cfg *config.StorageConfig) {
	uploadPath = cfg.UploadPath
	maxFileSize = cfg.MaxFileSize

	// Create upload directories
	departments := []string{"CS", "LBF", "SME", "MANAGEMENT", "ALL", "CHALLENGE"}
	for _, dept := range departments {
		dir := filepath.Join(uploadPath, dept)
		if err := os.MkdirAll(dir, 0755); err != nil {
			fmt.Printf("Warning: Could not create directory %s: %v\n", dir, err)
		}
	}
}

// GetAllReports retrieves all reports with pagination
func GetAllReports(c *gin.Context) {
	// Parse query parameters
	department := c.DefaultQuery("department", "")
	reportType := c.DefaultQuery("type", "")
	limitStr := c.DefaultQuery("limit", "100")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	if limit > 500 {
		limit = 500
	}

	// Try cache first (only for default pagination)
	if offset == 0 {
		cacheKey := fmt.Sprintf("reports:%s:%s:%d", department, reportType, limit)
		var cachedResponse struct {
			Reports []*models.Report `json:"reports"`
			Total   int              `json:"total"`
		}
		if err := database.CacheGet(cacheKey, &cachedResponse); err == nil {
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"data":    cachedResponse.Reports,
				"meta": gin.H{
					"total":  cachedResponse.Total,
					"limit":  limit,
					"offset": offset,
				},
				"cached": true,
			})
			return
		}
	}

	reports, total, err := models.GetAllReports(department, reportType, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch reports: " + err.Error(),
		})
		return
	}

	// Cache the result (only for default pagination)
	if offset == 0 {
		cacheKey := fmt.Sprintf("reports:%s:%s:%d", department, reportType, limit)
		cacheData := struct {
			Reports []*models.Report `json:"reports"`
			Total   int              `json:"total"`
		}{Reports: reports, Total: total}
		_ = database.CacheSet(cacheKey, cacheData, database.CacheTTLReports)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    reports,
		"meta": gin.H{
			"total":  total,
			"limit":  limit,
			"offset": offset,
		},
		"cached": false,
	})
}

// GetReportByID retrieves a single report by ID
func GetReportByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid report ID",
		})
		return
	}

	report, err := models.GetReportByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Report not found",
		})
		return
	}

	// Increment views
	_ = models.IncrementReportViews(id)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    report,
	})
}

// GetReportsByDepartmentAndType retrieves reports filtered by department and type
func GetReportsByDepartmentAndType(c *gin.Context) {
	department := c.Param("department")
	reportType := c.Param("type")

	reports, err := models.GetReportsByDepartmentAndType(department, reportType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch reports: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    reports,
	})
}

// GetRecentReports retrieves the most recent reports
func GetRecentReports(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "5")
	limit, _ := strconv.Atoi(limitStr)

	if limit > 20 {
		limit = 20
	}

	reports, err := models.GetRecentReports(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch recent reports: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    reports,
	})
}

// SearchReports searches reports by title or filename
func SearchReports(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Search query is required",
		})
		return
	}

	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	reports, total, err := models.SearchReports(query, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to search reports: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    reports,
		"meta": gin.H{
			"total":  total,
			"limit":  limit,
			"offset": offset,
		},
	})
}

// UploadReport handles file upload and creates a new report
func UploadReport(c *gin.Context) {
	userID, err := middleware.GetUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "Not authenticated",
		})
		return
	}

	// Parse multipart form
	if err := c.Request.ParseMultipartForm(maxFileSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "File too large or invalid form data",
		})
		return
	}

	// Get file from form
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "No file provided",
		})
		return
	}
	defer file.Close()

	// Get other form fields
	title := c.PostForm("title")
	department := c.PostForm("department")
	reportType := c.PostForm("type")
	dateStr := c.PostForm("date")

	if title == "" || department == "" || reportType == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Title, department, and type are required",
		})
		return
	}

	// Parse date if provided
	var reportDate *time.Time
	if dateStr != "" {
		parsed, err := time.Parse("2006-01-02", dateStr)
		if err == nil {
			reportDate = &parsed
		}
	}

	// Create file path
	fileName := header.Filename
	timestamp := time.Now().Unix()
	safeFileName := fmt.Sprintf("%d_%s", timestamp, fileName)
	filePath := filepath.Join(department, safeFileName)
	fullPath := filepath.Join(uploadPath, filePath)

	// Create destination directory
	destDir := filepath.Dir(fullPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create directory",
		})
		return
	}

	// Create destination file
	dst, err := os.Create(fullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create file",
		})
		return
	}
	defer dst.Close()

	// Copy file content
	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save file",
		})
		return
	}

	// Create report metadata
	input := &models.ReportCreate{
		Title:      title,
		FileName:   fileName,
		FilePath:   filePath,
		FileSize:   header.Size,
		Department: department,
		Type:       reportType,
		Date:       reportDate,
	}

	report, err := models.CreateReport(input, userID)
	if err != nil {
		// Clean up file on error
		os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create report: " + err.Error(),
		})
		return
	}

	// Parse Excel and store data (async)
	go func() {
		if err := services.ParseAndStoreExcelData(report.ID, fullPath, reportDate); err != nil {
			fmt.Printf("Warning: Failed to parse Excel file %s: %v\n", fileName, err)
		}
	}()

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data":    report,
	})
}

// UpdateReport updates a report's metadata
func UpdateReport(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid report ID",
		})
		return
	}

	var input models.ReportUpdate

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid input: " + err.Error(),
		})
		return
	}

	report, err := models.UpdateReport(id, &input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to update report: " + err.Error(),
		})
		return
	}

	// Invalidate reports cache after update
	_ = database.CacheDeletePattern("reports:*")

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    report,
	})
}

// DeleteReport deletes a report
func DeleteReport(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid report ID",
		})
		return
	}

	if err := models.DeleteReport(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to delete report: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Report deleted successfully",
	})
}

// DownloadReport handles report file download
func DownloadReport(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid report ID",
		})
		return
	}

	report, err := models.GetReportByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Report not found",
		})
		return
	}

	// Increment downloads
	_ = models.IncrementReportDownloads(id)

	// Serve file
	fullPath := filepath.Join(uploadPath, report.FilePath)
	c.FileAttachment(fullPath, report.FileName)
}

// GetReportData retrieves pre-parsed data for a report
func GetReportData(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid report ID",
		})
		return
	}

	data, err := models.GetReportData(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch report data: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GetBatchReportData retrieves all management report data in a single optimized query
// This is much faster than making individual calls for each report
func GetBatchReportData(c *gin.Context) {
	// Try to get from cache first
	cacheKey := "batch_report_data:management"
	var cachedData map[string][]*models.ReportData
	if err := database.CacheGet(cacheKey, &cachedData); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    cachedData,
			"cached":  true,
		})
		return
	}

	data, err := models.GetAllManagementReportData()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch batch report data: " + err.Error(),
		})
		return
	}

	// Cache for 5 minutes
	_ = database.CacheSet(cacheKey, data, 5*time.Minute)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
		"cached":  false,
	})
}

// GetClusterData retrieves all report data organized by branch for cluster analysis
// OPTIMIZED: Uses a single database query instead of one per report
func GetClusterData(c *gin.Context) {
	// Try cache first
	cacheKey := "cluster_data:all"
	var cachedData map[string][]map[string]interface{}
	if err := database.CacheGet(cacheKey, &cachedData); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    cachedData,
			"cached":  true,
		})
		return
	}

	// Use optimized batch query
	data, err := models.GetAllClusterData()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch cluster data: " + err.Error(),
		})
		return
	}

	// Cache for 5 minutes
	_ = database.CacheSet(cacheKey, data, 5*time.Minute)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
		"cached":  false,
	})
}

// GetAvailableSheets returns distinct sheet names from MANAGEMENT reports
func GetAvailableSheets(c *gin.Context) {
	sheets, err := models.GetAvailableSheets()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch sheets: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    sheets,
	})
}

// GetRegionalDataBatch returns ALL regional data in a single call
func GetRegionalDataBatch(c *gin.Context) {
	// Try cache first
	cacheKey := "regional_data:all"
	var cachedData map[string]map[string][]map[string]interface{}
	if err := database.CacheGet(cacheKey, &cachedData); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    cachedData,
			"cached":  true,
		})
		return
	}

	// Use optimized batch query
	data, err := models.GetAllRegionalData()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch regional data: " + err.Error(),
		})
		return
	}

	// Cache for 5 minutes
	_ = database.CacheSet(cacheKey, data, 5*time.Minute)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
		"cached":  false,
	})
}

// GetRegionalData returns data for regional/branch analysis
func GetRegionalData(c *gin.Context) {
	sheetName := c.Query("sheet")
	if sheetName == "" {
		sheetName = "Country" // Default
	}

	data, err := models.GetRegionalData(sheetName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch regional data: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// BatchParseReports parses all existing reports and stores data (admin only)
func BatchParseReports(c *gin.Context) {
	// Get all reports
	reports, _, err := models.GetAllReports("", "", 1000, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch reports: " + err.Error(),
		})
		return
	}

	parsed := 0
	failed := 0
	skipped := 0
	errors := []string{}

	for _, report := range reports {
		// Skip if already has parsed data
		existingData, _ := models.GetReportData(report.ID)
		if len(existingData) > 0 {
			skipped++
			continue
		}

		// Check if file exists
		fullPath := filepath.Join(uploadPath, report.FilePath)
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			failed++
			errors = append(errors, fmt.Sprintf("%s: file not found", report.FileName))
			continue
		}

		// Try structured parsing first (for MANAGEMENT reports with Branch column)
		err := services.ParseAndStoreExcelData(report.ID, fullPath, report.Date)
		if err != nil {
			// If structured parsing fails, try generic JSON parsing (for CRM/CALL CENTER)
			jsonData, jsonErr := services.ParseExcelToJSON(fullPath)
			if jsonErr != nil {
				failed++
				errors = append(errors, fmt.Sprintf("%s: %v", report.FileName, err))
				continue
			}
			
			// Store generic data
			if storeErr := services.StoreGenericReportData(report.ID, report.Type, jsonData, report.Date); storeErr != nil {
				failed++
				errors = append(errors, fmt.Sprintf("%s: failed to store generic data: %v", report.FileName, storeErr))
				continue
			}
		}

		parsed++
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("Batch parsing complete: %d parsed, %d skipped, %d failed", parsed, skipped, failed),
		"details": gin.H{
			"total":   len(reports),
			"parsed":  parsed,
			"skipped": skipped,
			"failed":  failed,
			"errors":  errors,
		},
	})
}
