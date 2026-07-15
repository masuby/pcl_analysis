package handlers

// Social Media Analysis — reads a chosen month's tab from the LBF/SME workbook,
// the CS workbook and the dedicated SME workbook (via the Google Sheets API
// using the shared service account) and returns the raw rows as JSON.
//
// The month is dynamic: the frontend first calls /api/social-media/months to
// learn which month tabs exist, then calls /api/social-media/data?month=YYYY-MM.
// Tab names are NOT consistent across workbooks (e.g. "MAY 2026 SHEET" vs
// "MAY SHEET 2026" vs "JUNE 2026 SHEET"), so we resolve the right tab per
// workbook by matching the month name + year inside each tab title.
//
// Frontend (DepartmentalDashboard / SocialMediaAnalysis) takes those rows,
// computes the Data / Agent Performance / Dispositions roll-ups, and builds
// the downloadable XLSX + email body client-side.

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"google.golang.org/api/option"
	sheets "google.golang.org/api/sheets/v4"
)

// Hard-coded sheet IDs — these are the operational call-centre workbooks the
// service account already has access to. Each month gets its own tab inside.
const (
	socialLBFSpreadsheetID = "1n2U_Tt-7fC3hRRIfFHrcyTT9HkN408C_YN4jUbPFeZE"
	socialCSSpreadsheetID  = "14bZuq-NLlIp7HToHCrhn7HA3eQQtjRsKt0z1Nbzy1bI"
	socialSMESpreadsheetID = "1uso8FojypIHlqt0FkO44w_4Rckhr6bLc8yk-EJUXmk8"
)

var socialMonthNames = []string{
	"", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
	"JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
}

var socialYearRe = regexp.MustCompile(`(20\d{2})`)

// newSheetsService builds a Sheets client from the service-account credentials.
func newSheetsService(ctx context.Context) (*sheets.Service, error) {
	credPath := os.Getenv("SHEETS_CREDENTIALS_PATH")
	if credPath == "" {
		credPath = "./credentials/sheets-service-account.json"
	}
	return sheets.NewService(ctx, option.WithCredentialsFile(credPath))
}

// socialTabTitles returns the tab titles of a workbook (best-effort).
func socialTabTitles(svc *sheets.Service, spreadsheetID string) []string {
	meta, err := svc.Spreadsheets.Get(spreadsheetID).Fields("sheets.properties.title").Do()
	if err != nil {
		return nil
	}
	titles := make([]string, 0, len(meta.Sheets))
	for _, sh := range meta.Sheets {
		if sh.Properties != nil {
			titles = append(titles, sh.Properties.Title)
		}
	}
	return titles
}

// socialResolveTab finds the tab in a workbook whose title contains the given
// month name AND year (e.g. month="JUNE", year="2026" matches "JUNE 2026 SHEET").
func socialResolveTab(titles []string, monthName, year string) string {
	monthName = strings.ToUpper(monthName)
	for _, t := range titles {
		up := strings.ToUpper(t)
		if strings.Contains(up, monthName) && strings.Contains(up, year) {
			return t
		}
	}
	return ""
}

// socialReadTab reads A1:Z3000 of a tab (best-effort; nil on any error).
func socialReadTab(svc *sheets.Service, spreadsheetID, tab string) [][]interface{} {
	if tab == "" {
		return nil
	}
	rng := fmt.Sprintf("'%s'!A1:Z3000", tab)
	resp, err := svc.Spreadsheets.Values.Get(spreadsheetID, rng).
		ValueRenderOption("UNFORMATTED_VALUE").Do()
	if err != nil {
		return nil
	}
	return resp.Values
}

type socialMonth struct {
	Year  int
	Month int
}

// socialListMonths scans every tab of all workbooks and returns the distinct
// (year, month) pairs found in tab titles, newest first.
func socialListMonths(svc *sheets.Service) []socialMonth {
	seen := map[string]bool{}
	var months []socialMonth
	for _, id := range []string{socialLBFSpreadsheetID, socialCSSpreadsheetID, socialSMESpreadsheetID} {
		for _, title := range socialTabTitles(svc, id) {
			up := strings.ToUpper(title)
			ym := socialYearRe.FindString(up)
			if ym == "" {
				continue
			}
			year, _ := strconv.Atoi(ym)
			for num := 1; num <= 12; num++ {
				if strings.Contains(up, socialMonthNames[num]) {
					key := fmt.Sprintf("%d-%02d", year, num)
					if !seen[key] {
						seen[key] = true
						months = append(months, socialMonth{Year: year, Month: num})
					}
					break
				}
			}
		}
	}
	sort.Slice(months, func(i, j int) bool {
		if months[i].Year != months[j].Year {
			return months[i].Year > months[j].Year
		}
		return months[i].Month > months[j].Month
	})
	return months
}

// GetSocialMediaMonths — GET /api/social-media/months
//
// Returns the months that have tabs in the workbooks, newest first:
//
//	{ success, months: [ { value: "2026-06", label: "JUNE 2026" }, ... ] }
func GetSocialMediaMonths(c *gin.Context) {
	ctx := context.Background()
	svc, err := newSheetsService(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "google sheets client init failed: " + err.Error(),
		})
		return
	}

	months := socialListMonths(svc)
	out := make([]gin.H, 0, len(months))
	for _, m := range months {
		out = append(out, gin.H{
			"value": fmt.Sprintf("%d-%02d", m.Year, m.Month),
			"label": fmt.Sprintf("%s %d", socialMonthNames[m.Month], m.Year),
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "months": out})
}

// GetSocialMediaData — GET /api/social-media/data?month=YYYY-MM
//
// Resolves the requested month's tab in each workbook and returns the rows as
// { lbf, cs, sme }. First row of each list is the header. When month is omitted
// the latest available month is used.
func GetSocialMediaData(c *gin.Context) {
	ctx := context.Background()
	svc, err := newSheetsService(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "google sheets client init failed: " + err.Error(),
		})
		return
	}

	// Determine the target (year, month) — from ?month=YYYY-MM or latest tab.
	var year, month int
	if mq := strings.TrimSpace(c.Query("month")); mq != "" {
		parts := strings.SplitN(mq, "-", 2)
		if len(parts) == 2 {
			year, _ = strconv.Atoi(parts[0])
			month, _ = strconv.Atoi(parts[1])
		}
	}
	if year == 0 || month < 1 || month > 12 {
		months := socialListMonths(svc)
		if len(months) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": true, "period": "", "lbf": nil, "cs": nil, "sme": nil,
			})
			return
		}
		year, month = months[0].Year, months[0].Month
	}

	monthName := socialMonthNames[month]
	yearStr := strconv.Itoa(year)

	// Resolve + read each workbook independently (best-effort: a month may be
	// missing in one workbook without breaking the others).
	lbfTitles := socialTabTitles(svc, socialLBFSpreadsheetID)
	csTitles := socialTabTitles(svc, socialCSSpreadsheetID)
	smeTitles := socialTabTitles(svc, socialSMESpreadsheetID)

	lbfTab := socialResolveTab(lbfTitles, monthName, yearStr)
	csTab := socialResolveTab(csTitles, monthName, yearStr)
	smeTab := socialResolveTab(smeTitles, monthName, yearStr)

	lbfValues := socialReadTab(svc, socialLBFSpreadsheetID, lbfTab)
	csValues := socialReadTab(svc, socialCSSpreadsheetID, csTab)
	smeValues := socialReadTab(svc, socialSMESpreadsheetID, smeTab)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"period":  fmt.Sprintf("%s %d", monthName, year),
		"month":   fmt.Sprintf("%d-%02d", year, month),
		"lbf":     lbfValues,
		"cs":      csValues,
		"sme":     smeValues,
		"resolvedTabs": gin.H{
			"lbf": lbfTab, "cs": csTab, "sme": smeTab,
		},
	})
}
