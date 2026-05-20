package services

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

func excelSerialToMonthKey(serial float64) (string, bool) {
	if !isFiniteFloat(serial) {
		return "", false
	}
	n := int64(math.Floor(serial))
	// Same guard as the frontend JS implementation.
	if n < 1 || n >= 100000 {
		return "", false
	}
	utcMs := (n - 25569) * 86400000 // 86400 * 1000
	d := time.UnixMilli(utcMs).UTC()
	return fmt.Sprintf("%04d-%02d", d.Year(), int(d.Month())), true
}

// Parse a cell value into a monthKey (YYYY-MM) compatible with the frontend logic.
func toMonthKey(cellValue string) (string, bool) {
	s := strings.TrimSpace(cellValue)
	if s == "" || s == "-" {
		return "", false
	}

	// Try numeric Excel serial.
	if f, err := strconv.ParseFloat(strings.ReplaceAll(s, ",", ""), 64); err == nil && isFiniteFloat(f) {
		return excelSerialToMonthKey(f)
	}

	// Normalize common cases like "2026-01-01 00:00:00" or "2026-01-01T00:00:00".
	normalized := s
	if i := strings.Index(normalized, " "); i > 0 {
		normalized = normalized[:i]
	}
	if i := strings.Index(normalized, "T"); i > 0 {
		normalized = normalized[:i]
	}

	// Fallback: date parsing (try both original and normalized).
	layouts := []string{
		"2006-01-02",
		"2006-1-2",
		"2006/01/02",
		"2006/1/2",
		"2006-01",
		"2006/01",
		"2006/01/02",
		"2006/1/2",
		"02/01/2006",
		"2/01/2006",
		"02/1/2006",
		"2/1/2006",
		"1/2/2006",
		"01/02/2006",
		"01/1/2006",
		"1/1/2006",
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05.000",
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05.000Z07:00",
		"2-Jan-2006",
		"02-Jan-2006",
		"Jan-2-2006",
		"Jan-02-2006",
		"Jan-2006",
		"January-2006",
		"Jan 2006",
		"January 2006",
		"Jan-06",
		"Jan 06",
		"Jan-2026",
		"January-2026",
		"January 2026",
		"Jan 2 2006",
		"Jan 02 2006",
		"January 2 2006",
		"January 02 2006",
	}

	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			tt := t.UTC()
			return fmt.Sprintf("%04d-%02d", tt.Year(), int(tt.Month())), true
		}
		if t, err := time.Parse(layout, normalized); err == nil {
			tt := t.UTC()
			return fmt.Sprintf("%04d-%02d", tt.Year(), int(tt.Month())), true
		}
	}

	return "", false
}

func monthNameToNumber(s string) (int, bool) {
	t := strings.ToLower(strings.TrimSpace(s))
	months := map[string]int{
		"jan": 1, "january": 1,
		"feb": 2, "february": 2,
		"mar": 3, "march": 3,
		"apr": 4, "april": 4,
		"may": 5,
		"jun": 6, "june": 6,
		"jul": 7, "july": 7,
		"aug": 8, "august": 8,
		"sep": 9, "sept": 9, "september": 9,
		"oct": 10, "october": 10,
		"nov": 11, "november": 11,
		"dec": 12, "december": 12,
	}
	if m, ok := months[t]; ok {
		return m, true
	}
	return 0, false
}

func parseFloatCell(cellValue string) float64 {
	s := strings.TrimSpace(cellValue)
	if s == "" || s == "-" {
		return 0
	}
	s = strings.ReplaceAll(s, ",", "")
	s = strings.ReplaceAll(s, "%", "")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || !isFiniteFloat(f) {
		return 0
	}
	return f
}

func normalizeWeight(weight float64) float64 {
	if !isFiniteFloat(weight) {
		return 0
	}
	// JS behavior: if weight > 1 assume it's a percentage (e.g. 10) -> 0.1
	if weight > 1 {
		return weight / 100
	}
	return weight
}

func isFiniteFloat(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func findHeaderIndex(headers []string, predicate func(string) bool) int {
	for i, h := range headers {
		if predicate(h) {
			return i
		}
	}
	return -1
}

func ParseKpiTargetFile(product, kind, filePath string) (map[string]interface{}, error) {
	p := strings.ToUpper(strings.TrimSpace(product))
	k := strings.ToUpper(strings.TrimSpace(kind))
	switch p {
	case "CS":
		switch k {
		case "TOTAL":
			return parseCsKpiTotal(filePath)
		case "CLUSTER":
			return parseCsKpiCluster(filePath)
		default:
			return map[string]interface{}{}, fmt.Errorf("unknown kpi target kind: %s", kind)
		}
	case "LBF", "SME":
		if k != "TOTAL" {
			return map[string]interface{}{}, fmt.Errorf("kpi target parsing not implemented for %s/%s yet", product, kind)
		}
		return parseLbfOrSmeKpiTotal(p, filePath)
	default:
		return map[string]interface{}{}, fmt.Errorf("kpi target parsing not implemented for %s/%s yet", product, kind)
	}
}

func parseLbfOrSmeKpiTotal(product, filePath string) (map[string]interface{}, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open KPI target file: %w", err)
	}
	defer f.Close()

	out := map[string]interface{}{
		"product":              product,
		"performanceStandards": []interface{}{},
		"targetsByMonth":       map[string]interface{}{},
	}

	// KPI sheet: performance standards + sub-weight(ing)
	kpiRows, err := f.GetRows("KPI")
	if err != nil || len(kpiRows) == 0 {
		return nil, fmt.Errorf("missing KPI sheet")
	}
	kpiHeader := kpiRows[0]
	nameIdx := findHeaderIndex(kpiHeader, func(h string) bool {
		t := strings.ToLower(strings.TrimSpace(h))
		return strings.Contains(t, "performance") || strings.EqualFold(strings.TrimSpace(h), "kpi")
	})
	weightIdx := findHeaderIndex(kpiHeader, func(h string) bool {
		t := strings.ToLower(strings.TrimSpace(h))
		return strings.Contains(t, "weight")
	})
	if nameIdx < 0 {
		nameIdx = 0
	}
	if weightIdx < 0 {
		weightIdx = 1
	}

	perf := make([]interface{}, 0, 16)
	for i := 1; i < len(kpiRows); i++ {
		row := kpiRows[i]
		if len(row) == 0 {
			continue
		}
		name := ""
		if nameIdx < len(row) {
			name = strings.TrimSpace(row[nameIdx])
		}
		if name == "" {
			continue
		}
		w := 0.0
		if weightIdx < len(row) {
			w = parseFloatCell(row[weightIdx])
		}
		w = normalizeWeight(w)
		perf = append(perf, map[string]interface{}{
			"name":   name,
			"weight": w,
		})
	}
	out["performanceStandards"] = perf

	// TARGET sheet: one row per month with product-specific numeric columns.
	targetRows, err := f.GetRows("TARGET")
	if err != nil || len(targetRows) == 0 {
		return nil, fmt.Errorf("missing TARGET sheet")
	}
	headers := targetRows[0]
	monthIdx := findHeaderIndex(headers, func(h string) bool {
		t := strings.ToLower(strings.TrimSpace(h))
		return strings.Contains(t, "month") || strings.Contains(t, "period")
	})
	if monthIdx < 0 {
		monthIdx = 0
	}

	targetsByMonth := out["targetsByMonth"].(map[string]interface{})
	for i := 1; i < len(targetRows); i++ {
		row := targetRows[i]
		if monthIdx >= len(row) {
			continue
		}
		monthKey, ok := toMonthKey(row[monthIdx])
		if !ok {
			// LBF files can store month as "March" without year. Keep a month-only fallback key.
			if m, mok := monthNameToNumber(row[monthIdx]); mok {
				monthKey = fmt.Sprintf("0000-%02d", m)
			} else {
				continue
			}
		}

		entry := map[string]interface{}{}
		for j, h := range headers {
			if j >= len(row) {
				continue
			}
			key := strings.TrimSpace(h)
			if key == "" {
				continue
			}
			if j == monthIdx {
				entry["monthLabel"] = strings.TrimSpace(row[j])
				continue
			}
			entry[key] = parseFloatCell(row[j])
		}
		targetsByMonth[monthKey] = entry
	}

	return out, nil
}

func parseCsKpiTotal(filePath string) (map[string]interface{}, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open KPI target file: %w", err)
	}
	defer f.Close()

	out := map[string]interface{}{
		"performanceStandards": []interface{}{},
		"mainland":              map[string]interface{}{},
		"zanzibar":              map[string]interface{}{},
		"callCenter":            map[string]interface{}{},
	}

	// KPI sheet: performance standards + weights
	kpiRows, err := f.GetRows("KPI")
	if err != nil || len(kpiRows) == 0 {
		return nil, fmt.Errorf("missing KPI sheet")
	}
	header := kpiRows[0]
	nameIdx := findHeaderIndex(header, func(h string) bool {
		t := strings.ToLower(strings.TrimSpace(h))
		compact := strings.ReplaceAll(t, " ", "")
		return compact == "kpi" || strings.Contains(compact, "performancestandards")
	})
	weightIdx := findHeaderIndex(header, func(h string) bool {
		return strings.Contains(strings.ToLower(h), "weight")
	})
	if nameIdx < 0 {
		nameIdx = 0
	}
	if weightIdx < 0 {
		weightIdx = 1
	}

	var perf []interface{}
	for i := 1; i < len(kpiRows) && i <= 10; i++ {
		row := kpiRows[i]
		name := ""
		if nameIdx >= 0 && nameIdx < len(row) {
			name = strings.TrimSpace(row[nameIdx])
		}
		if name == "" {
			continue
		}
		w := 0.0
		if weightIdx >= 0 && weightIdx < len(row) {
			w = parseFloatCell(row[weightIdx])
		}
		w = normalizeWeight(w)
		perf = append(perf, map[string]interface{}{
			"name":   name,
			"weight": w,
		})
	}
	out["performanceStandards"] = perf

	// MAINLAND sheet
	if err := parseCsMainlandZanzibarSheet(f, "MAINLAND", out, "mainland"); err != nil {
		return nil, err
	}
	// ZANZIBAR sheet
	if err := parseCsMainlandZanzibarSheet(f, "ZANZIBAR", out, "zanzibar"); err != nil {
		return nil, err
	}

	// CALL CENTER sheet
	ccRows, err := f.GetRows("CALL CENTER")
	if err != nil || len(ccRows) == 0 {
		return nil, fmt.Errorf("missing CALL CENTER sheet")
	}
	ccHeader := ccRows[0]
	monthIdx := findHeaderIndex(ccHeader, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "MONTH") })
	targetIdx := findHeaderIndex(ccHeader, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "TARGET") })
	if monthIdx < 0 || targetIdx < 0 {
		return nil, fmt.Errorf("CALL CENTER sheet missing MONTH/TARGET columns")
	}

	callCenter := out["callCenter"].(map[string]interface{})
	for i := 1; i < len(ccRows); i++ {
		row := ccRows[i]
		if monthIdx >= len(row) {
			continue
		}
		monthKey, ok := toMonthKey(row[monthIdx])
		if !ok {
			continue
		}
		target := 0.0
		if targetIdx < len(row) {
			target = parseFloatCell(row[targetIdx])
		}
		callCenter[monthKey] = target
	}

	return out, nil
}

func parseCsMainlandZanzibarSheet(f *excelize.File, sheetName string, out map[string]interface{}, outKey string) error {
	rows, err := f.GetRows(sheetName)
	if err != nil || len(rows) == 0 {
		return fmt.Errorf("missing %s sheet", sheetName)
	}
	headers := rows[0]

	monthIdx := findHeaderIndex(headers, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "MONTH") })
	newIdx := findHeaderIndex(headers, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "NEW BUSINESS TARGET") })
	repeatIdx := findHeaderIndex(headers, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "REPEAT BUSINESS TARGET") })
	reactIdx := findHeaderIndex(headers, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "REACTIVATION BUSINESS TARGET") })
	totalIdx := findHeaderIndex(headers, func(h string) bool { return strings.EqualFold(strings.TrimSpace(h), "TOTAL SALES TARGET") })
	if monthIdx < 0 || newIdx < 0 || repeatIdx < 0 || reactIdx < 0 || totalIdx < 0 {
		return fmt.Errorf("%s sheet missing required columns", sheetName)
	}

	dest := out[outKey].(map[string]interface{})
	// Debugging: validate we can parse the MONTH column into YYYY-MM keys.
	// This is intentionally low-volume (first 4 rows per sheet).
	debugPrinted := 0
	for i := 1; i < len(rows); i++ {
		row := rows[i]
		if monthIdx >= len(row) {
			continue
		}
		monthKey, ok := toMonthKey(row[monthIdx])
		if debugPrinted < 4 {
			fmt.Printf("[kpi-target-parser] %s MONTH raw=%q -> monthKey=%q ok=%v\n", sheetName, row[monthIdx], monthKey, ok)
			debugPrinted++
		}
		if !ok {
			continue
		}

		newBusiness := 0.0
		repeatBusiness := 0.0
		reactivation := 0.0
		total := 0.0
		if newIdx < len(row) {
			newBusiness = parseFloatCell(row[newIdx])
		}
		if repeatIdx < len(row) {
			repeatBusiness = parseFloatCell(row[repeatIdx])
		}
		if reactIdx < len(row) {
			reactivation = parseFloatCell(row[reactIdx])
		}
		if totalIdx < len(row) {
			total = parseFloatCell(row[totalIdx])
		}

		dest[monthKey] = map[string]interface{}{
			"newBusiness":   newBusiness,
			"repeatBusiness": repeatBusiness,
			"reactivation":  reactivation,
			"total":         total,
		}
	}

	return nil
}

func parseCsKpiCluster(filePath string) (map[string]interface{}, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open cluster KPI target file: %w", err)
	}
	defer f.Close()

	out := map[string]interface{}{
		"performanceStandards": []interface{}{},
		"clusters":              map[string]interface{}{},
	}

	// KPI sheet
	kpiRows, err := f.GetRows("KPI")
	if err != nil || len(kpiRows) == 0 {
		return nil, fmt.Errorf("missing KPI sheet")
	}
	header := kpiRows[0]
	nameIdx := findHeaderIndex(header, func(h string) bool {
		t := strings.ToLower(strings.TrimSpace(h))
		compact := strings.ReplaceAll(t, " ", "")
		return compact == "kpi" || strings.Contains(compact, "performancestandards")
	})
	weightIdx := findHeaderIndex(header, func(h string) bool {
		return strings.Contains(strings.ToLower(h), "weight")
	})
	if nameIdx < 0 {
		nameIdx = 0
	}
	if weightIdx < 0 {
		weightIdx = 1
	}

	var perf []interface{}
	for i := 1; i < len(kpiRows); i++ {
		row := kpiRows[i]
		name := ""
		if nameIdx < len(row) {
			name = strings.TrimSpace(row[nameIdx])
		}
		if name == "" || strings.EqualFold(name, "Total") {
			continue
		}
		w := 0.0
		if weightIdx < len(row) {
			w = parseFloatCell(row[weightIdx])
		}
		w = normalizeWeight(w)
		perf = append(perf, map[string]interface{}{
			"name":   name,
			"weight": w,
		})
	}
	out["performanceStandards"] = perf

	clusters := out["clusters"].(map[string]interface{})
	clusterSheetNames := []string{"Cluster 1", "Cluster 2", "Cluster 3", "Zanzibar"}
	for _, sheetName := range clusterSheetNames {
		rows, err := f.GetRows(sheetName)
		if err != nil || len(rows) == 0 {
			clusters[sheetName] = map[string]interface{}{}
			continue
		}
		headers := rows[0]
		monthIdx := findHeaderIndex(headers, func(h string) bool { return strings.Contains(strings.ToLower(h), "month") })
		newIdx := findHeaderIndex(headers, func(h string) bool {
			t := strings.ToLower(h)
			return strings.Contains(t, "new") && strings.Contains(t, "business")
		})
		repeatIdx := findHeaderIndex(headers, func(h string) bool {
			t := strings.ToLower(h)
			return strings.Contains(t, "repeat") && strings.Contains(t, "business")
		})
		totalIdx := findHeaderIndex(headers, func(h string) bool {
			t := strings.ToLower(h)
			return strings.Contains(t, "total") && strings.Contains(t, "target")
		})
		if monthIdx < 0 || newIdx < 0 || repeatIdx < 0 || totalIdx < 0 {
			clusters[sheetName] = map[string]interface{}{}
			continue
		}

		byMonth := map[string]interface{}{}
		for i := 1; i < len(rows); i++ {
			row := rows[i]
			if monthIdx >= len(row) {
				continue
			}
			monthKey, ok := toMonthKey(row[monthIdx])
			if !ok {
				continue
			}
			newBusiness := 0.0
			repeatBusiness := 0.0
			total := 0.0
			if newIdx < len(row) {
				newBusiness = parseFloatCell(row[newIdx])
			}
			if repeatIdx < len(row) {
				repeatBusiness = parseFloatCell(row[repeatIdx])
			}
			if totalIdx < len(row) {
				total = parseFloatCell(row[totalIdx])
			}
			byMonth[monthKey] = map[string]interface{}{
				"newBusiness":   newBusiness,
				"repeatBusiness": repeatBusiness,
				"total":         total,
			}
		}
		clusters[sheetName] = byMonth
	}

	return out, nil
}

