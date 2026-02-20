package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/redis/go-redis/v9"
)

// DashboardResponse represents the dashboard data response
type DashboardResponse struct {
	Countrywise map[string][]DataPoint `json:"countrywise"`
	CS          map[string][]DataPoint `json:"cs"`
	LBF         map[string][]DataPoint `json:"lbf"`
	SME         map[string][]DataPoint `json:"sme"`
	Zanzibar    map[string][]DataPoint `json:"zanzibar"`
}

// DataPoint represents a single data point for charts
type DataPoint struct {
	Date       string  `json:"date"`
	Value      float64 `json:"value"`
	MetricName string  `json:"metricName"`
}

// BranchMapping defines which branches belong to which section
var BranchMapping = map[string][]string{
	"countrywise": {"Country"},
	"cs":          {"CS", "Cs Asset Finance"},
	"lbf":         {"LBF", "IPF", "MIF", "MIF Customs", "Lbf Yard Finance", "LBF QUICKCASH", "LBF-FLEX"},
	"sme":         {"SME"},
	"zanzibar":    {"ZANZIBAR"},
}

// GetDashboardData retrieves aggregated dashboard data
func GetDashboardData(c *gin.Context) {
	department := c.DefaultQuery("department", "ALL")
	fromDateStr := c.Query("fromDate")
	toDateStr := c.Query("toDate")

	// Parse dates
	var fromDate, toDate *time.Time
	if fromDateStr != "" {
		parsed, err := time.Parse("2006-01-02", fromDateStr)
		if err == nil {
			fromDate = &parsed
		}
	}
	if toDateStr != "" {
		parsed, err := time.Parse("2006-01-02", toDateStr)
		if err == nil {
			toDate = &parsed
		}
	}

	// Try to get from cache first
	cacheKey := database.GetDashboardCacheKey(department, fromDateStr+"-"+toDateStr)
	var cachedData DashboardResponse
	if err := database.CacheGet(cacheKey, &cachedData); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    cachedData,
			"cached":  true,
		})
		return
	}

	// Get data from database
	summaries, err := models.GetDashboardData(department, fromDate, toDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch dashboard data: " + err.Error(),
		})
		return
	}

	// Organize data by section
	response := organizeDashboardData(summaries)

	// Cache the result
	_ = database.CacheSet(cacheKey, response, database.CacheTTLDashboard)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
		"cached":  false,
	})
}

// organizeDashboardData organizes raw data into sections
func organizeDashboardData(summaries []*models.DashboardSummary) DashboardResponse {
	response := DashboardResponse{
		Countrywise: make(map[string][]DataPoint),
		CS:          make(map[string][]DataPoint),
		LBF:         make(map[string][]DataPoint),
		SME:         make(map[string][]DataPoint),
		Zanzibar:    make(map[string][]DataPoint),
	}

	for _, summary := range summaries {
		dataPoint := DataPoint{
			Date:       summary.ReportDate.Format("2006-01-02"),
			Value:      summary.TotalValue,
			MetricName: summary.MetricName,
		}

		// Determine which section this belongs to
		section := getSectionForBranch(summary.Branch)

		switch section {
		case "countrywise":
			if _, exists := response.Countrywise[summary.MetricName]; !exists {
				response.Countrywise[summary.MetricName] = []DataPoint{}
			}
			response.Countrywise[summary.MetricName] = append(response.Countrywise[summary.MetricName], dataPoint)
		case "cs":
			if _, exists := response.CS[summary.MetricName]; !exists {
				response.CS[summary.MetricName] = []DataPoint{}
			}
			response.CS[summary.MetricName] = append(response.CS[summary.MetricName], dataPoint)
		case "lbf":
			if _, exists := response.LBF[summary.MetricName]; !exists {
				response.LBF[summary.MetricName] = []DataPoint{}
			}
			response.LBF[summary.MetricName] = append(response.LBF[summary.MetricName], dataPoint)
		case "sme":
			if _, exists := response.SME[summary.MetricName]; !exists {
				response.SME[summary.MetricName] = []DataPoint{}
			}
			response.SME[summary.MetricName] = append(response.SME[summary.MetricName], dataPoint)
		case "zanzibar":
			if _, exists := response.Zanzibar[summary.MetricName]; !exists {
				response.Zanzibar[summary.MetricName] = []DataPoint{}
			}
			response.Zanzibar[summary.MetricName] = append(response.Zanzibar[summary.MetricName], dataPoint)
		}
	}

	return response
}

// getSectionForBranch determines which section a branch belongs to
func getSectionForBranch(branch string) string {
	for section, branches := range BranchMapping {
		for _, b := range branches {
			if b == branch {
				return section
			}
		}
	}
	return ""
}

// GetDashboardStats retrieves summary statistics
func GetDashboardStats(c *gin.Context) {
	department := c.DefaultQuery("department", "ALL")

	// Try cache first
	cacheKey := "stats:" + department
	var cachedStats map[string]interface{}
	if err := database.CacheGet(cacheKey, &cachedStats); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    cachedStats,
			"cached":  true,
		})
		return
	}

	// Get counts from database
	var totalReports, totalViews, totalDownloads int
	
	query := `
		SELECT 
			COUNT(*) as total_reports,
			COALESCE(SUM(views), 0) as total_views,
			COALESCE(SUM(downloads), 0) as total_downloads
		FROM reports
		WHERE is_active = true`
	
	args := []interface{}{}
	if department != "" && department != "ALL" {
		query += " AND (department = $1 OR department = 'ALL')"
		args = append(args, department)
	}

	row := database.DB.QueryRow(query, args...)
	if err := row.Scan(&totalReports, &totalViews, &totalDownloads); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch stats",
		})
		return
	}

	// Get unique dates count
	var uniqueDates int
	dateQuery := `SELECT COUNT(DISTINCT date) FROM reports WHERE is_active = true AND date IS NOT NULL`
	database.DB.QueryRow(dateQuery).Scan(&uniqueDates)

	stats := map[string]interface{}{
		"totalReports":   totalReports,
		"totalViews":     totalViews,
		"totalDownloads": totalDownloads,
		"uniqueDates":    uniqueDates,
	}

	// Cache for 5 minutes
	_ = database.CacheSet(cacheKey, stats, 5*time.Minute)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
		"cached":  false,
	})
}

// GetAvailableMetrics retrieves available metrics for charts
func GetAvailableMetrics(c *gin.Context) {
	// Try cache
	cacheKey := "metrics:available"
	var cachedMetrics []string
	if err := database.CacheGet(cacheKey, &cachedMetrics); err == nil && err != redis.Nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    cachedMetrics,
		})
		return
	}

	// Get unique metric names
	query := `SELECT DISTINCT metric_name FROM report_data ORDER BY metric_name`
	rows, err := database.DB.Query(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch metrics",
		})
		return
	}
	defer rows.Close()

	var metrics []string
	for rows.Next() {
		var metric string
		if err := rows.Scan(&metric); err == nil {
			metrics = append(metrics, metric)
		}
	}

	// Cache for 1 hour
	_ = database.CacheSet(cacheKey, metrics, time.Hour)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    metrics,
	})
}

// GetAvailableDates retrieves available report dates
func GetAvailableDates(c *gin.Context) {
	department := c.DefaultQuery("department", "")
	reportType := c.DefaultQuery("type", "")

	query := `
		SELECT DISTINCT DATE(date) as report_date 
		FROM reports 
		WHERE is_active = true AND date IS NOT NULL`
	
	args := []interface{}{}
	argCount := 1

	if department != "" && department != "ALL" {
		query += fmt.Sprintf(" AND (department = $%d OR department = 'ALL')", argCount)
		args = append(args, department)
		argCount++
	}

	if reportType != "" {
		query += fmt.Sprintf(" AND type = $%d", argCount)
		args = append(args, reportType)
	}

	query += " ORDER BY report_date DESC"

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch dates",
		})
		return
	}
	defer rows.Close()

	var dates []string
	for rows.Next() {
		var date time.Time
		if err := rows.Scan(&date); err == nil {
			dates = append(dates, date.Format("2006-01-02"))
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    dates,
	})
}

// RefreshMaterializedView refreshes the dashboard materialized view and invalidates report caches
func RefreshMaterializedView(c *gin.Context) {
	mvSuccess := true
	if _, err := database.DB.Exec("REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_summary"); err != nil {
		mvSuccess = false
		// Don't return - still clear caches so charts get fresh data
	}

	// Always invalidate caches so charts get fresh data (even if MV refresh failed)
	_ = database.InvalidateDashboardCache()
	_ = database.CacheDeletePattern("batch_report_data:*")
	_ = database.CacheDeletePattern("cluster_data:*")
	_ = database.CacheDeletePattern("regional_data:*")
	_ = database.CacheDeletePattern("reports:*")

	if !mvSuccess {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "Caches cleared. Materialized view refresh failed (non-blocking).",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Materialized view refreshed and caches cleared successfully",
	})
}

