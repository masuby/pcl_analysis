package models

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// Report represents a report metadata
type Report struct {
	ID          uuid.UUID  `json:"id"`
	Title       string     `json:"title"`
	FileName    string     `json:"fileName"`
	FilePath    string     `json:"filePath"`
	FileSize    int64      `json:"fileSize"`
	Department  string     `json:"department"`
	Type        string     `json:"type"`
	Date        *time.Time `json:"date"`
	Views       int        `json:"views"`
	Downloads   int        `json:"downloads"`
	IsActive    bool       `json:"isActive"`
	UploadedBy  *uuid.UUID `json:"uploadedBy,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// ReportCreate is the input for creating a new report
type ReportCreate struct {
	Title      string     `json:"title" binding:"required"`
	FileName   string     `json:"fileName" binding:"required"`
	FilePath   string     `json:"filePath" binding:"required"`
	FileSize   int64      `json:"fileSize"`
	Department string     `json:"department" binding:"required"`
	Type       string     `json:"type" binding:"required"`
	Date       *time.Time `json:"date"`
}

// ReportUpdate is the input for updating a report
type ReportUpdate struct {
	Title      string  `json:"title"`
	Department string  `json:"department"`
	Type       string  `json:"type"`
	DateStr    string  `json:"date"` // Accept date as string, parse manually
	IsActive   *bool   `json:"isActive"`
	ParsedDate *time.Time `json:"-"` // Internal use after parsing
}

// ReportFileUpdate is for updating report file path, name, title (used by sync_readable)
type ReportFileUpdate struct {
	Title    string `json:"title"`
	FileName string `json:"fileName"`
	FilePath string `json:"filePath"`
	FileSize int64  `json:"fileSize"`
}

// ReportData represents pre-parsed data from Excel files
type ReportData struct {
	ID               int64      `json:"id"`
	ReportID         uuid.UUID  `json:"reportId"`
	SheetName        string     `json:"sheetName"`
	Branch           string     `json:"branch"`
	RowType          string     `json:"rowType"`          // "Total", "Team Leader", "Sales Rep"
	ParentTeamLeader string     `json:"parentTeamLeader"` // For Sales Reps, their Team Leader
	MetricName       string     `json:"metricName"`
	MetricValue      float64    `json:"metricValue"`
	ReportDate       time.Time  `json:"reportDate"`
	CreatedAt        time.Time  `json:"createdAt"`
}

// ReportDataBatch is for batch inserting parsed Excel data
type ReportDataBatch struct {
	ReportID         uuid.UUID
	SheetName        string
	Branch           string
	RowType          string
	ParentTeamLeader string
	MetricName       string
	MetricValue      float64
	ReportDate       time.Time
}

// DashboardSummary represents aggregated dashboard data
type DashboardSummary struct {
	Department  string    `json:"department"`
	Branch      string    `json:"branch"`
	MetricName  string    `json:"metricName"`
	ReportDate  time.Time `json:"reportDate"`
	TotalValue  float64   `json:"totalValue"`
	AvgValue    float64   `json:"avgValue"`
	DataPoints  int       `json:"dataPoints"`
}

// CreateReport creates a new report in the database
func CreateReport(input *ReportCreate, uploadedBy uuid.UUID) (*Report, error) {
	report := &Report{
		ID:         uuid.New(),
		Title:      input.Title,
		FileName:   input.FileName,
		FilePath:   input.FilePath,
		FileSize:   input.FileSize,
		Department: input.Department,
		Type:       input.Type,
		Date:       input.Date,
		Views:      0,
		Downloads:  0,
		IsActive:   true,
		UploadedBy: &uploadedBy,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	query := `
		INSERT INTO reports (id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, uploaded_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id`

	err := database.DB.QueryRow(
		query,
		report.ID, report.Title, report.FileName, report.FilePath, report.FileSize,
		report.Department, report.Type, report.Date, report.Views, report.Downloads,
		report.IsActive, report.UploadedBy, report.CreatedAt, report.UpdatedAt,
	).Scan(&report.ID)

	if err != nil {
		return nil, err
	}

	return report, nil
}

// GetReportByID retrieves a report by ID
func GetReportByID(id uuid.UUID) (*Report, error) {
	report := &Report{}

	query := `
		SELECT id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, uploaded_by, created_at, updated_at
		FROM reports WHERE id = $1`

	var date sql.NullTime
	var uploadedBy sql.NullString

	err := database.DB.QueryRow(query, id).Scan(
		&report.ID, &report.Title, &report.FileName, &report.FilePath, &report.FileSize,
		&report.Department, &report.Type, &date, &report.Views, &report.Downloads,
		&report.IsActive, &uploadedBy, &report.CreatedAt, &report.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, errors.New("report not found")
	}
	if err != nil {
		return nil, err
	}

	if date.Valid {
		report.Date = &date.Time
	}
	if uploadedBy.Valid {
		uid, _ := uuid.Parse(uploadedBy.String)
		report.UploadedBy = &uid
	}

	return report, nil
}

// GetAllReports retrieves all reports with filters
func GetAllReports(department, reportType string, limit, offset int) ([]*Report, int, error) {
	var args []interface{}
	whereClause := "WHERE is_active = true"
	argCount := 1

	if department != "" && department != "ALL" {
		whereClause += " AND (department = $" + string(rune('0'+argCount)) + " OR department = 'ALL')"
		args = append(args, department)
		argCount++
	}

	if reportType != "" {
		whereClause += " AND UPPER(TRIM(type)) = UPPER(TRIM($" + string(rune('0'+argCount)) + "))"
		args = append(args, reportType)
		argCount++
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM reports " + whereClause
	var total int
	err := database.DB.QueryRow(countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Get reports
	query := `
		SELECT id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, uploaded_by, created_at, updated_at
		FROM reports ` + whereClause + `
		ORDER BY created_at DESC
		LIMIT $` + string(rune('0'+argCount)) + ` OFFSET $` + string(rune('0'+argCount+1))

	args = append(args, limit, offset)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var reports []*Report
	for rows.Next() {
		report := &Report{}
		var date sql.NullTime
		var uploadedBy sql.NullString

		err := rows.Scan(
			&report.ID, &report.Title, &report.FileName, &report.FilePath, &report.FileSize,
			&report.Department, &report.Type, &date, &report.Views, &report.Downloads,
			&report.IsActive, &uploadedBy, &report.CreatedAt, &report.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}

		if date.Valid {
			report.Date = &date.Time
		}
		if uploadedBy.Valid {
			uid, _ := uuid.Parse(uploadedBy.String)
			report.UploadedBy = &uid
		}

		reports = append(reports, report)
	}

	return reports, total, nil
}

// GetReportsByDepartmentAndType retrieves reports by department and type
func GetReportsByDepartmentAndType(department, reportType string) ([]*Report, error) {
	query := `
		SELECT id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, uploaded_by, created_at, updated_at
		FROM reports
		WHERE is_active = true
		AND (department = $1 OR department = 'ALL')
		AND UPPER(TRIM(type)) = UPPER(TRIM($2))
		ORDER BY date DESC`

	rows, err := database.DB.Query(query, department, reportType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reports []*Report
	for rows.Next() {
		report := &Report{}
		var date sql.NullTime
		var uploadedBy sql.NullString

		err := rows.Scan(
			&report.ID, &report.Title, &report.FileName, &report.FilePath, &report.FileSize,
			&report.Department, &report.Type, &date, &report.Views, &report.Downloads,
			&report.IsActive, &uploadedBy, &report.CreatedAt, &report.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		if date.Valid {
			report.Date = &date.Time
		}
		if uploadedBy.Valid {
			uid, _ := uuid.Parse(uploadedBy.String)
			report.UploadedBy = &uid
		}

		reports = append(reports, report)
	}

	return reports, nil
}

// UpdateReport updates a report in the database
func UpdateReport(id uuid.UUID, input *ReportUpdate) (*Report, error) {
	report, err := GetReportByID(id)
	if err != nil {
		return nil, err
	}

	if input.Title != "" {
		report.Title = input.Title
	}
	if input.Department != "" {
		report.Department = input.Department
	}
	if input.Type != "" {
		report.Type = input.Type
	}
	
	// Parse date string - try multiple formats
	if input.DateStr != "" {
		var parsedDate time.Time
		var parseErr error
		
		// Try RFC3339 first (2006-01-02T15:04:05Z07:00)
		parsedDate, parseErr = time.Parse(time.RFC3339, input.DateStr)
		if parseErr != nil {
			// Try RFC3339Nano (2006-01-02T15:04:05.999999999Z07:00)
			parsedDate, parseErr = time.Parse(time.RFC3339Nano, input.DateStr)
		}
		if parseErr != nil {
			// Try date-only format (2006-01-02)
			parsedDate, parseErr = time.Parse("2006-01-02", input.DateStr)
		}
		if parseErr != nil {
			// Try dd/mm/yyyy format
			parsedDate, parseErr = time.Parse("02/01/2006", input.DateStr)
		}
		
		if parseErr == nil {
			report.Date = &parsedDate
		}
		// If all parsing fails, keep existing date
	}
	
	if input.IsActive != nil {
		report.IsActive = *input.IsActive
	}
	report.UpdatedAt = time.Now()

	query := `
		UPDATE reports
		SET title = $1, department = $2, type = $3, date = $4, is_active = $5, updated_at = $6
		WHERE id = $7`

	_, err = database.DB.Exec(query,
		report.Title, report.Department, report.Type, report.Date, report.IsActive, report.UpdatedAt, id)

	if err != nil {
		return nil, err
	}

	return report, nil
}

// UpdateReportFile updates a report's title, file_name, file_path, file_size
func UpdateReportFile(id uuid.UUID, input *ReportFileUpdate) (*Report, error) {
	report, err := GetReportByID(id)
	if err != nil {
		return nil, err
	}
	if input.Title != "" {
		report.Title = input.Title
	}
	if input.FileName != "" {
		report.FileName = input.FileName
	}
	if input.FilePath != "" {
		report.FilePath = input.FilePath
	}
	if input.FileSize > 0 {
		report.FileSize = input.FileSize
	}
	report.UpdatedAt = time.Now()

	query := `UPDATE reports SET title = $1, file_name = $2, file_path = $3, file_size = $4, updated_at = $5 WHERE id = $6`
	_, err = database.DB.Exec(query,
		report.Title, report.FileName, report.FilePath, report.FileSize, report.UpdatedAt, id)
	if err != nil {
		return nil, err
	}
	return report, nil
}

// IncrementReportViews increments the view count
func IncrementReportViews(id uuid.UUID) error {
	query := `UPDATE reports SET views = views + 1, updated_at = $1 WHERE id = $2`
	_, err := database.DB.Exec(query, time.Now(), id)
	return err
}

// IncrementReportDownloads increments the download count
func IncrementReportDownloads(id uuid.UUID) error {
	query := `UPDATE reports SET downloads = downloads + 1, updated_at = $1 WHERE id = $2`
	_, err := database.DB.Exec(query, time.Now(), id)
	return err
}

// DeleteReport soft deletes a report
func DeleteReport(id uuid.UUID) error {
	query := `UPDATE reports SET is_active = false, updated_at = $1 WHERE id = $2`
	result, err := database.DB.Exec(query, time.Now(), id)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("report not found")
	}

	return nil
}

// DeleteReportData removes all parsed data for a report (used before re-parsing)
func DeleteReportData(reportID uuid.UUID) error {
	_, err := database.DB.Exec(`DELETE FROM report_data WHERE report_id = $1`, reportID)
	return err
}

// BatchInsertReportData inserts multiple report data rows efficiently
func BatchInsertReportData(data []ReportDataBatch) error {
	if len(data) == 0 {
		return nil
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO report_data (report_id, sheet_name, branch, row_type, parent_team_leader, metric_name, metric_value, report_date, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now()
	for _, d := range data {
		sheetName := d.SheetName
		if sheetName == "" {
			sheetName = "Country" // Default for backward compatibility
		}
		rowType := d.RowType
		if rowType == "" {
			rowType = "Branch" // Default for backward compatibility
		}
		parentTeamLeader := d.ParentTeamLeader
		_, err := stmt.Exec(d.ReportID, sheetName, d.Branch, rowType, parentTeamLeader, d.MetricName, d.MetricValue, d.ReportDate, now)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetReportData retrieves parsed data for a report
func GetReportData(reportID uuid.UUID) ([]*ReportData, error) {
	query := `
		SELECT id, report_id, COALESCE(sheet_name, 'Country'), branch, COALESCE(row_type, 'Branch'), 
		       COALESCE(parent_team_leader, ''), metric_name, metric_value, report_date, created_at
		FROM report_data
		WHERE report_id = $1
		ORDER BY sheet_name, branch, metric_name`

	rows, err := database.DB.Query(query, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var data []*ReportData
	for rows.Next() {
		d := &ReportData{}
		err := rows.Scan(&d.ID, &d.ReportID, &d.SheetName, &d.Branch, &d.RowType, &d.ParentTeamLeader, &d.MetricName, &d.MetricValue, &d.ReportDate, &d.CreatedAt)
		if err != nil {
			return nil, err
		}
		data = append(data, d)
	}

	return data, nil
}

// GetAllManagementReportData retrieves all parsed data for MANAGEMENT reports in a single optimized query
// Returns data grouped by report_id for efficient frontend processing
func GetAllManagementReportData() (map[string][]*ReportData, error) {
	query := `
		SELECT rd.id, rd.report_id, COALESCE(rd.sheet_name, 'Country') as sheet_name, 
		       rd.branch, COALESCE(rd.row_type, 'Branch') as row_type,
		       COALESCE(rd.parent_team_leader, '') as parent_team_leader, 
		       rd.metric_name, rd.metric_value, rd.report_date, rd.created_at
		FROM report_data rd
		JOIN reports r ON rd.report_id = r.id
		WHERE r.type = 'MANAGEMENT' AND r.is_active = true
		  AND (rd.sheet_name = 'Country' OR rd.sheet_name IS NULL)
		ORDER BY rd.report_id, rd.branch, rd.metric_name`

	rows, err := database.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]*ReportData)
	for rows.Next() {
		d := &ReportData{}
		err := rows.Scan(&d.ID, &d.ReportID, &d.SheetName, &d.Branch, &d.RowType, &d.ParentTeamLeader, &d.MetricName, &d.MetricValue, &d.ReportDate, &d.CreatedAt)
		if err != nil {
			return nil, err
		}
		reportIDStr := d.ReportID.String()
		result[reportIDStr] = append(result[reportIDStr], d)
	}

	return result, nil
}

// GetAllClusterData retrieves all cluster data (Country sheet) in a single optimized query
// Returns data grouped by branch name for cluster analysis
func GetAllClusterData() (map[string][]map[string]interface{}, error) {
	query := `
		SELECT 
			rd.branch,
			rd.metric_name,
			rd.metric_value,
			rd.report_date,
			r.id as report_id,
			r.file_name
		FROM report_data rd
		JOIN reports r ON rd.report_id = r.id
		WHERE r.type = 'MANAGEMENT' AND r.is_active = true
		  AND (rd.sheet_name = 'Country' OR rd.sheet_name IS NULL)
		ORDER BY rd.report_date DESC, rd.branch, rd.metric_name`

	rows, err := database.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group by branch -> date -> metrics
	dateGroups := make(map[string]map[string]map[string]interface{}) // branch -> dateKey -> metrics

	for rows.Next() {
		var branch, metricName, fileName string
		var metricValue float64
		var reportDate time.Time
		var reportID uuid.UUID

		if err := rows.Scan(&branch, &metricName, &metricValue, &reportDate, &reportID, &fileName); err != nil {
			return nil, err
		}

		if branch == "" {
			continue
		}

		dateKey := reportDate.Format("2006-01-02") + "_" + reportID.String()

		if dateGroups[branch] == nil {
			dateGroups[branch] = make(map[string]map[string]interface{})
		}
		if dateGroups[branch][dateKey] == nil {
			dateGroups[branch][dateKey] = map[string]interface{}{
				"Branch":   branch,
				"reportId": reportID.String(),
				"fileName": fileName,
				"date":     reportDate,
			}
		}
		dateGroups[branch][dateKey][metricName] = metricValue
	}

	// Convert to result format
	result := make(map[string][]map[string]interface{})
	for branch, dates := range dateGroups {
		for _, metrics := range dates {
			result[branch] = append(result[branch], metrics)
		}
	}

	return result, nil
}

// GetAllRegionalData retrieves all regional data (non-Country sheets) in a single optimized query
// Returns data grouped by sheet name and then by branch
// OPTIMIZED: Uses indexes and efficient grouping
func GetAllRegionalData() (map[string]map[string][]map[string]interface{}, error) {
	query := `
		SELECT 
			COALESCE(rd.sheet_name, 'Country') as sheet_name,
			rd.branch,
			COALESCE(rd.row_type, 'Branch') as row_type,
			COALESCE(rd.parent_team_leader, '') as parent_team_leader,
			rd.metric_name,
			rd.metric_value,
			rd.report_date,
			r.id as report_id,
			r.file_name
		FROM report_data rd
		INNER JOIN reports r ON rd.report_id = r.id
		WHERE r.type = 'MANAGEMENT' 
		  AND r.is_active = true
		  AND rd.sheet_name IS NOT NULL 
		  AND rd.sheet_name != 'Country'
		  AND rd.metric_value IS NOT NULL
		ORDER BY rd.sheet_name, rd.report_date DESC, rd.branch, rd.metric_name`

	rows, err := database.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group by sheet -> branch -> date -> metrics
	sheetGroups := make(map[string]map[string]map[string]map[string]interface{})

	for rows.Next() {
		var sheetName, branch, rowType, parentTeamLeader, metricName, fileName string
		var metricValue float64
		var reportDate time.Time
		var reportID uuid.UUID

		if err := rows.Scan(&sheetName, &branch, &rowType, &parentTeamLeader, &metricName, &metricValue, &reportDate, &reportID, &fileName); err != nil {
			return nil, err
		}

		dateKey := reportDate.Format("2006-01-02") + "_" + reportID.String() + "_" + branch

		if sheetGroups[sheetName] == nil {
			sheetGroups[sheetName] = make(map[string]map[string]map[string]interface{})
		}
		if sheetGroups[sheetName][branch] == nil {
			sheetGroups[sheetName][branch] = make(map[string]map[string]interface{})
		}
		if sheetGroups[sheetName][branch][dateKey] == nil {
			sheetGroups[sheetName][branch][dateKey] = map[string]interface{}{
				"Branch":           branch,
				"rowType":          rowType,
				"parentTeamLeader": parentTeamLeader,
				"date":             reportDate,
				"reportId":         reportID.String(),
				"fileName":         fileName,
			}
		}
		// Only add non-zero or valid metric values
		if metricValue != 0 || metricName != "" {
			sheetGroups[sheetName][branch][dateKey][metricName] = metricValue
		}
	}

	// Check for any errors during iteration
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	// Convert to result format
	result := make(map[string]map[string][]map[string]interface{})
	for sheet, branches := range sheetGroups {
		result[sheet] = make(map[string][]map[string]interface{})
		for branch, dates := range branches {
			for _, metrics := range dates {
				// Only add rows that have at least one metric value
				hasMetrics := false
				for k, v := range metrics {
					if k != "Branch" && k != "rowType" && k != "parentTeamLeader" && k != "date" && k != "reportId" && k != "fileName" {
						if numVal, ok := v.(float64); ok && numVal != 0 {
							hasMetrics = true
							break
						}
					}
				}
				if hasMetrics {
					result[sheet][branch] = append(result[sheet][branch], metrics)
				}
			}
		}
	}

	return result, nil
}

// GetAvailableSheets retrieves distinct sheet names for MANAGEMENT reports
func GetAvailableSheets() ([]string, error) {
	query := `
		SELECT DISTINCT COALESCE(rd.sheet_name, 'Country') as sheet_name
		FROM report_data rd
		JOIN reports r ON rd.report_id = r.id
		WHERE r.type = 'MANAGEMENT' AND r.is_active = true
		ORDER BY sheet_name`

	rows, err := database.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sheets []string
	for rows.Next() {
		var sheet string
		if err := rows.Scan(&sheet); err != nil {
			return nil, err
		}
		sheets = append(sheets, sheet)
	}

	return sheets, nil
}

// GetRegionalData retrieves data for regional analysis (branch sheets)
func GetRegionalData(sheetName string) (map[string][]map[string]interface{}, error) {
	query := `
		SELECT 
			rd.branch,
			COALESCE(rd.row_type, 'Branch') as row_type,
			COALESCE(rd.parent_team_leader, '') as parent_team_leader,
			rd.metric_name,
			rd.metric_value,
			rd.report_date,
			r.id as report_id,
			r.file_name
		FROM report_data rd
		JOIN reports r ON rd.report_id = r.id
		WHERE r.type = 'MANAGEMENT' 
		AND r.is_active = true
		AND COALESCE(rd.sheet_name, 'Country') = $1
		ORDER BY rd.report_date DESC, rd.branch, rd.metric_name`

	rows, err := database.DB.Query(query, sheetName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group by branch -> date -> metrics
	result := make(map[string][]map[string]interface{})
	dateGroups := make(map[string]map[string]map[string]interface{}) // branch -> date -> metrics

	for rows.Next() {
		var branch, rowType, parentTeamLeader, metricName, fileName string
		var metricValue float64
		var reportDate time.Time
		var reportID uuid.UUID

		if err := rows.Scan(&branch, &rowType, &parentTeamLeader, &metricName, &metricValue, &reportDate, &reportID, &fileName); err != nil {
			return nil, err
		}

		dateKey := reportDate.Format("2006-01-02")
		
		if dateGroups[branch] == nil {
			dateGroups[branch] = make(map[string]map[string]interface{})
		}
		if dateGroups[branch][dateKey] == nil {
			dateGroups[branch][dateKey] = map[string]interface{}{
				"Branch":           branch,
				"rowType":          rowType,
				"parentTeamLeader": parentTeamLeader,
				"date":             reportDate,
				"reportId":         reportID.String(),
				"fileName":         fileName,
			}
		}
		dateGroups[branch][dateKey][metricName] = metricValue
	}

	// Convert to result format
	for branch, dates := range dateGroups {
		for _, metrics := range dates {
			result[branch] = append(result[branch], metrics)
		}
	}

	return result, nil
}

// GetDashboardData retrieves aggregated dashboard data
func GetDashboardData(department string, fromDate, toDate *time.Time) ([]*DashboardSummary, error) {
	query := `
		SELECT 
			r.department,
			rd.branch,
			rd.metric_name,
			rd.report_date,
			SUM(rd.metric_value) as total_value,
			AVG(rd.metric_value) as avg_value,
			COUNT(*) as data_points
		FROM report_data rd
		JOIN reports r ON rd.report_id = r.id
		WHERE r.is_active = true`

	var args []interface{}
	argCount := 1

	if department != "" && department != "ALL" {
		query += " AND (r.department = $" + string(rune('0'+argCount)) + " OR r.department = 'ALL')"
		args = append(args, department)
		argCount++
	}

	if fromDate != nil {
		query += " AND rd.report_date >= $" + string(rune('0'+argCount))
		args = append(args, fromDate)
		argCount++
	}

	if toDate != nil {
		query += " AND rd.report_date <= $" + string(rune('0'+argCount))
		args = append(args, toDate)
		argCount++
	}

	query += " GROUP BY r.department, rd.branch, rd.metric_name, rd.report_date ORDER BY rd.report_date DESC"

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []*DashboardSummary
	for rows.Next() {
		s := &DashboardSummary{}
		err := rows.Scan(&s.Department, &s.Branch, &s.MetricName, &s.ReportDate, &s.TotalValue, &s.AvgValue, &s.DataPoints)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, s)
	}

	return summaries, nil
}

// SearchReports searches reports by title or file name
func SearchReports(searchTerm string, limit, offset int) ([]*Report, int, error) {
	searchPattern := "%" + searchTerm + "%"

	var total int
	countQuery := `SELECT COUNT(*) FROM reports WHERE is_active = true AND (title ILIKE $1 OR file_name ILIKE $1)`
	err := database.DB.QueryRow(countQuery, searchPattern).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := `
		SELECT id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, uploaded_by, created_at, updated_at
		FROM reports
		WHERE is_active = true AND (title ILIKE $1 OR file_name ILIKE $1)
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`

	rows, err := database.DB.Query(query, searchPattern, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var reports []*Report
	for rows.Next() {
		report := &Report{}
		var date sql.NullTime
		var uploadedBy sql.NullString

		err := rows.Scan(
			&report.ID, &report.Title, &report.FileName, &report.FilePath, &report.FileSize,
			&report.Department, &report.Type, &date, &report.Views, &report.Downloads,
			&report.IsActive, &uploadedBy, &report.CreatedAt, &report.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}

		if date.Valid {
			report.Date = &date.Time
		}
		if uploadedBy.Valid {
			uid, _ := uuid.Parse(uploadedBy.String)
			report.UploadedBy = &uid
		}

		reports = append(reports, report)
	}

	return reports, total, nil
}

// GetRecentReports retrieves the most recent reports
func GetRecentReports(limit int) ([]*Report, error) {
	query := `
		SELECT id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, uploaded_by, created_at, updated_at
		FROM reports
		WHERE is_active = true
		ORDER BY created_at DESC
		LIMIT $1`

	rows, err := database.DB.Query(query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reports []*Report
	for rows.Next() {
		report := &Report{}
		var date sql.NullTime
		var uploadedBy sql.NullString

		err := rows.Scan(
			&report.ID, &report.Title, &report.FileName, &report.FilePath, &report.FileSize,
			&report.Department, &report.Type, &date, &report.Views, &report.Downloads,
			&report.IsActive, &uploadedBy, &report.CreatedAt, &report.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		if date.Valid {
			report.Date = &date.Time
		}
		if uploadedBy.Valid {
			uid, _ := uuid.Parse(uploadedBy.String)
			report.UploadedBy = &uid
		}

		reports = append(reports, report)
	}

	return reports, nil
}
