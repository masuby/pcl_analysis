package services

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/xuri/excelize/v2"
)

// ExcelData represents parsed data from an Excel file
type ExcelData struct {
	Branch      string
	MetricName  string
	MetricValue float64
}

// ParseAndStoreExcelData parses an Excel file and stores the data in the database
// Now parses ALL sheets for comprehensive regional analysis
func ParseAndStoreExcelData(reportID uuid.UUID, filePath string, reportDate *time.Time) error {
	// Open Excel file
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to open Excel file: %w", err)
	}
	defer f.Close()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return fmt.Errorf("no sheets found in Excel file")
	}

	date := time.Now()
	if reportDate != nil {
		date = *reportDate
	}

	var allBatchData []models.ReportDataBatch

	// Parse ALL sheets
	for _, sheetName := range sheets {
		sheetData, err := parseSheet(f, sheetName, reportID, date)
		if err != nil {
			fmt.Printf("Warning: Failed to parse sheet %s: %v\n", sheetName, err)
			continue
		}
		allBatchData = append(allBatchData, sheetData...)
	}

	// Batch insert into database
	if len(allBatchData) > 0 {
		if err := models.BatchInsertReportData(allBatchData); err != nil {
			return fmt.Errorf("failed to insert report data: %w", err)
		}
	}

	return nil
}

// parseSheet parses a single sheet and returns batch data
// Excel structure for regional sheets:
// - Column A: Role indicator ("Team Leader", "Sales Rep", or empty for Total)
// - Column B: Person's name (Branch Manager name)
// - Other columns: Metrics
func parseSheet(f *excelize.File, sheetName string, reportID uuid.UUID, date time.Time) ([]models.ReportDataBatch, error) {
	rows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, fmt.Errorf("failed to get rows: %w", err)
	}

	if len(rows) < 2 {
		return nil, fmt.Errorf("not enough rows in sheet")
	}

	// First row is headers
	headers := rows[0]
	
	// Determine if this is a regional sheet (non-Country) with role-based structure
	// Regional sheets have Column A for role (Team Leader/Sales Rep) and Column B for name
	isRegionalSheet := sheetName != "Country"
	
	// Find Branch/Name column
	branchColIndex := 0
	roleColIndex := -1
	
	if isRegionalSheet {
		// Check if Column A appears to be a role column (empty header or contains role-like values)
		if len(headers) > 0 {
			headerA := strings.ToLower(strings.TrimSpace(headers[0]))
			// If header A is empty or looks like a role header, Column B has the names
			if headerA == "" || headerA == "role" || headerA == "type" {
				roleColIndex = 0
				branchColIndex = 1 // Column B has the Branch Manager name
			}
		}
		
		// Also check by examining first few data rows for role patterns
		if roleColIndex == -1 && len(rows) > 1 {
			for i := 1; i < len(rows) && i < 5; i++ {
				if len(rows[i]) > 0 {
					cellA := strings.ToLower(strings.TrimSpace(rows[i][0]))
					if cellA == "team leader" || cellA == "sales rep" || cellA == "" {
						roleColIndex = 0
						branchColIndex = 1
						break
					}
				}
			}
		}
	}
	
	// If no role column detected, use traditional parsing
	if roleColIndex == -1 {
		branchColIndex = findColumnIndex(headers, "Branch")
		if branchColIndex == -1 {
			branchColIndex = 0
		}
	}

	// Find all numeric columns (potential metrics) - skip role and branch columns
	metricColumns := []struct {
		Index int
		Name  string
	}{}

	for i, header := range headers {
		if i == branchColIndex || i == roleColIndex {
			continue
		}
		header = strings.TrimSpace(header)
		if header != "" && !isDateColumn(header) {
			metricColumns = append(metricColumns, struct {
				Index int
				Name  string
			}{Index: i, Name: header})
		}
	}

	var batchData []models.ReportDataBatch
	currentTeamLeader := ""

	for i := 1; i < len(rows); i++ {
		row := rows[i]
		if len(row) == 0 {
			continue
		}

		// Get role and branch/person name
		var role, branch string
		
		if roleColIndex >= 0 && roleColIndex < len(row) {
			role = strings.TrimSpace(row[roleColIndex])
		}
		
		if branchColIndex < len(row) {
			branch = strings.TrimSpace(row[branchColIndex])
		}

		// Determine row type
		var rowType string
		if roleColIndex >= 0 {
			// Use explicit role column (Column A)
			rowType = determineRowTypeFromRole(role, i)
		} else {
			// Fall back to old logic for Country sheet or sheets without role column
			rowType = determineRowType(branch, i, rows, sheetName)
		}
		
		// Track current team leader for Sales Rep rows
		if rowType == "Team Leader" {
			currentTeamLeader = branch
		}
		
		// For Total row (row 2), branch might be empty but has values
		if rowType == "Total" && branch == "" {
			branch = "Total"
		}
		
		// Skip rows without a branch name (except Total)
		if branch == "" && rowType != "Total" {
			continue
		}

		// Determine parent team leader for Sales Reps
		parentTeamLeader := ""
		if rowType == "Sales Rep" {
			parentTeamLeader = currentTeamLeader
		}

		// Extract metric values
		for _, mc := range metricColumns {
			if mc.Index >= len(row) {
				continue
			}

			cellValue := strings.TrimSpace(row[mc.Index])
			if cellValue == "" {
				continue
			}

			// Parse numeric value
			numValue, err := parseNumericValue(cellValue)
			if err != nil {
				continue // Skip non-numeric values
			}

			batchData = append(batchData, models.ReportDataBatch{
				ReportID:         reportID,
				SheetName:        sheetName,
				Branch:           branch,
				RowType:          rowType,
				ParentTeamLeader: parentTeamLeader,
				MetricName:       mc.Name,
				MetricValue:      numValue,
				ReportDate:       date,
			})
		}
	}

	return batchData, nil
}

// determineRowTypeFromRole determines row type from explicit role column (Column A)
func determineRowTypeFromRole(role string, rowIndex int) string {
	roleLower := strings.ToLower(strings.TrimSpace(role))
	
	// Empty role in row 2 (index 1) = Total row
	if roleLower == "" {
		if rowIndex == 1 {
			return "Total"
		}
		return "Person" // Unknown row type
	}
	
	// Explicit Team Leader
	if roleLower == "team leader" || roleLower == "teamleader" || 
	   strings.HasPrefix(roleLower, "team leader") || 
	   strings.Contains(roleLower, "team leader") {
		return "Team Leader"
	}
	
	// Explicit Sales Rep
	if roleLower == "sales rep" || roleLower == "salesrep" || 
	   roleLower == "sales representative" ||
	   strings.HasPrefix(roleLower, "sales rep") || 
	   strings.Contains(roleLower, "sales rep") {
		return "Sales Rep"
	}
	
	// Check for abbreviations
	if roleLower == "tl" {
		return "Team Leader"
	}
	if roleLower == "sr" {
		return "Sales Rep"
	}
	
	return "Person"
}

// determineRowType identifies if a row is Total, Team Leader, Sales Rep, or Branch
// based on the value in column A of the Excel sheet
func determineRowType(branchName string, rowIndex int, allRows [][]string, sheetName string) string {
	branchLower := strings.ToLower(strings.TrimSpace(branchName))
	
	// Check for empty cell (row 2 with empty A column = Total row)
	if branchName == "" || branchLower == "" {
		return "Total"
	}

	// Check for explicit Total row
	if branchLower == "total" || strings.HasPrefix(branchLower, "total") {
		return "Total"
	}

	// For Country sheet, treat as Branch
	if sheetName == "Country" {
		return "Branch"
	}

	// Check if this is explicitly marked as Team Leader in column A
	if branchLower == "team leader" || 
	   branchLower == "teamleader" ||
	   strings.HasPrefix(branchLower, "team leader") ||
	   strings.Contains(branchLower, "team leader") {
		return "Team Leader"
	}

	// Check if this is explicitly marked as Sales Rep in column A
	if branchLower == "sales rep" || 
	   branchLower == "salesrep" ||
	   branchLower == "sales representative" ||
	   strings.HasPrefix(branchLower, "sales rep") ||
	   strings.Contains(branchLower, "sales rep") {
		return "Sales Rep"
	}

	// Check for common abbreviations
	if branchLower == "tl" || strings.HasPrefix(branchLower, "tl ") || strings.HasPrefix(branchLower, "tl-") {
		return "Team Leader"
	}
	if branchLower == "sr" || strings.HasPrefix(branchLower, "sr ") || strings.HasPrefix(branchLower, "sr-") {
		return "Sales Rep"
	}

	// For regional sheets (non-Country), check context from surrounding rows
	if rowIndex > 1 && rowIndex < len(allRows) && sheetName != "Country" {
		// Look at the row itself - check if column A contains role indicator
		if len(allRows[rowIndex]) > 0 {
			firstCol := strings.ToLower(strings.TrimSpace(allRows[rowIndex][0]))
			if strings.Contains(firstCol, "team") && strings.Contains(firstCol, "leader") {
				return "Team Leader"
			}
			if strings.Contains(firstCol, "sales") && strings.Contains(firstCol, "rep") {
				return "Sales Rep"
			}
		}
		
		// Check if the previous row was a Team Leader (then this might be a Sales Rep)
		if rowIndex > 2 && len(allRows[rowIndex-1]) > 0 {
			prevFirstCol := strings.ToLower(strings.TrimSpace(allRows[rowIndex-1][0]))
			if strings.Contains(prevFirstCol, "team leader") || prevFirstCol == "team leader" {
				// This row follows a team leader, likely a sales rep or another team leader
				if !strings.Contains(branchLower, "team") {
					return "Sales Rep"
				}
			}
		}
	}

	// Default for non-Country sheets
	if sheetName != "Country" {
		return "Person"
	}

	return "Branch"
}

// ParseExcelSheets returns information about all sheets in an Excel file
func ParseExcelSheets(filePath string) ([]string, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	return f.GetSheetList(), nil
}

// ParseExcelHeaders returns headers from a specific sheet
func ParseExcelHeaders(filePath, sheetName string) ([]string, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	rows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return []string{}, nil
	}

	// Clean headers
	headers := make([]string, len(rows[0]))
	for i, h := range rows[0] {
		headers[i] = strings.TrimSpace(h)
	}

	return headers, nil
}

// ParseExcelData parses specific columns from an Excel file
func ParseExcelData(filePath, sheetName, branchColumn, dataColumn string) ([]ExcelData, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	rows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, err
	}

	if len(rows) < 2 {
		return []ExcelData{}, nil
	}

	headers := rows[0]
	branchIdx := findColumnIndex(headers, branchColumn)
	dataIdx := findColumnIndex(headers, dataColumn)

	if branchIdx == -1 || dataIdx == -1 {
		return nil, fmt.Errorf("required columns not found: %s, %s", branchColumn, dataColumn)
	}

	var data []ExcelData

	for i := 1; i < len(rows); i++ {
		row := rows[i]
		
		if branchIdx >= len(row) || dataIdx >= len(row) {
			continue
		}

		branch := strings.TrimSpace(row[branchIdx])
		valueStr := strings.TrimSpace(row[dataIdx])

		if branch == "" || valueStr == "" {
			continue
		}

		value, err := parseNumericValue(valueStr)
		if err != nil {
			continue
		}

		data = append(data, ExcelData{
			Branch:      branch,
			MetricName:  dataColumn,
			MetricValue: value,
		})
	}

	return data, nil
}

// GetAvailableMetrics returns all available numeric columns from an Excel file
func GetAvailableMetrics(filePath string) ([]string, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Try Country sheet first
	sheetName := "Country"
	sheets := f.GetSheetList()
	if !contains(sheets, sheetName) && len(sheets) > 0 {
		sheetName = sheets[0]
	}

	rows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, err
	}

	if len(rows) < 2 {
		return []string{}, nil
	}

	headers := rows[0]
	
	// Check which columns have numeric data
	var metrics []string
	
	for colIdx, header := range headers {
		header = strings.TrimSpace(header)
		if header == "" || strings.ToLower(header) == "branch" || isDateColumn(header) {
			continue
		}

		// Check if this column has at least one numeric value
		for rowIdx := 1; rowIdx < len(rows) && rowIdx < 10; rowIdx++ { // Check first 10 data rows
			if colIdx < len(rows[rowIdx]) {
				cellValue := strings.TrimSpace(rows[rowIdx][colIdx])
				if _, err := parseNumericValue(cellValue); err == nil {
					metrics = append(metrics, header)
					break
				}
			}
		}
	}

	return metrics, nil
}

// Helper functions

func findColumnIndex(headers []string, columnName string) int {
	columnNameLower := strings.ToLower(strings.TrimSpace(columnName))
	
	for i, header := range headers {
		if strings.ToLower(strings.TrimSpace(header)) == columnNameLower {
			return i
		}
	}
	
	return -1
}

func parseNumericValue(value string) (float64, error) {
	// Remove common non-numeric characters
	cleaned := value
	cleaned = strings.ReplaceAll(cleaned, ",", "")
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	cleaned = strings.ReplaceAll(cleaned, "$", "")
	cleaned = strings.ReplaceAll(cleaned, "%", "")
	cleaned = strings.TrimSpace(cleaned)

	if cleaned == "" || cleaned == "-" {
		return 0, fmt.Errorf("empty value")
	}

	return strconv.ParseFloat(cleaned, 64)
}

func isDateColumn(header string) bool {
	lower := strings.ToLower(header)
	dateKeywords := []string{"date", "time", "created", "updated", "timestamp"}
	
	for _, keyword := range dateKeywords {
		if strings.Contains(lower, keyword) {
			return true
		}
	}
	
	return false
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// ExtractBranchData extracts data for specific branches (for dashboard sections)
type BranchSectionData struct {
	Section string
	Branch  string
	Metrics map[string]float64
}

func ExtractBranchSections(filePath string) ([]BranchSectionData, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Try Country sheet first
	sheetName := "Country"
	sheets := f.GetSheetList()
	if !contains(sheets, sheetName) && len(sheets) > 0 {
		sheetName = sheets[0]
	}

	rows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, err
	}

	if len(rows) < 2 {
		return []BranchSectionData{}, nil
	}

	headers := rows[0]
	branchIdx := findColumnIndex(headers, "Branch")
	if branchIdx == -1 {
		return nil, fmt.Errorf("Branch column not found")
	}

	// Define branch sections
	branchSections := map[string]string{
		"Country":          "countrywise",
		"CS":               "cs",
		"Cs Asset Finance": "cs",
		"LBF":              "lbf",
		"IPF":              "lbf",
		"MIF":              "lbf",
		"MIF Customs":      "lbf",
		"Lbf Yard Finance": "lbf",
		"LBF QUICKCASH":    "lbf",
		"SME":              "sme",
		"ZANZIBAR":         "zanzibar",
	}

	var results []BranchSectionData

	for i := 1; i < len(rows); i++ {
		row := rows[i]
		if branchIdx >= len(row) {
			continue
		}

		branch := strings.TrimSpace(row[branchIdx])
		section, exists := branchSections[branch]
		if !exists {
			continue
		}

		metrics := make(map[string]float64)

		for colIdx, header := range headers {
			if colIdx == branchIdx {
				continue
			}
			header = strings.TrimSpace(header)
			if header == "" || isDateColumn(header) {
				continue
			}

			if colIdx < len(row) {
				value, err := parseNumericValue(row[colIdx])
				if err == nil {
					metrics[header] = value
				}
			}
		}

		results = append(results, BranchSectionData{
			Section: section,
			Branch:  branch,
			Metrics: metrics,
		})
	}

	return results, nil
}

// ParseExcelToJSON parses all sheets of an Excel file into JSON format
// This is used for CRM and CALL CENTER reports that don't follow the Branch/Metrics pattern
func ParseExcelToJSON(filePath string) (map[string][]map[string]interface{}, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open Excel file: %w", err)
	}
	defer f.Close()

	result := make(map[string][]map[string]interface{})
	
	for _, sheetName := range f.GetSheetList() {
		rows, err := f.GetRows(sheetName)
		if err != nil {
			continue
		}
		
		if len(rows) < 2 {
			continue
		}
		
		// First row is headers
		headers := rows[0]
		sheetData := []map[string]interface{}{}
		
		for i := 1; i < len(rows); i++ {
			row := rows[i]
			if len(row) == 0 {
				continue
			}
			
			rowData := make(map[string]interface{})
			hasData := false
			
			for j, header := range headers {
				header = strings.TrimSpace(header)
				if header == "" {
					continue
				}
				
				value := ""
				if j < len(row) {
					value = strings.TrimSpace(row[j])
				}
				
				if value != "" {
					hasData = true
					// Try to parse as number
					if numVal, err := parseNumericValue(value); err == nil {
						rowData[header] = numVal
					} else {
						rowData[header] = value
					}
				}
			}
			
			if hasData {
				sheetData = append(sheetData, rowData)
			}
		}
		
		if len(sheetData) > 0 {
			result[sheetName] = sheetData
		}
	}
	
	return result, nil
}

// StoreGenericReportData stores parsed JSON data for CRM/CALL CENTER reports
func StoreGenericReportData(reportID uuid.UUID, reportType string, data map[string][]map[string]interface{}, reportDate *time.Time) error {
	date := time.Now()
	if reportDate != nil {
		date = *reportDate
	}
	
	var batchData []models.ReportDataBatch
	
	for sheetName, rows := range data {
		for _, row := range rows {
			// For CRM/CALL CENTER, use sheet name as branch and store key-value pairs
			for key, value := range row {
				numValue := float64(0)
				switch v := value.(type) {
				case float64:
					numValue = v
				case int:
					numValue = float64(v)
				case string:
					// Skip string values for numeric storage
					continue
				}
				
				batchData = append(batchData, models.ReportDataBatch{
					ReportID:    reportID,
					Branch:      sheetName, // Use sheet name as "branch"
					MetricName:  key,
					MetricValue: numValue,
					ReportDate:  date,
				})
			}
		}
	}
	
	if len(batchData) > 0 {
		return models.BatchInsertReportData(batchData)
	}
	
	return nil
}

