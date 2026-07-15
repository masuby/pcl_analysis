package handlers

// LBF Call Centre targets — reads the "…Performance Dashboard" workbook (one tab
// per month, named e.g. "June 2026-Perfomance ") via the shared service account
// and returns the raw rows of the requested months. The frontend
// (salesFileBuilder) parses the per-agent monthly TARGET values and writes an
// "LBF call center" sheet into the Challenge sales file.
//
// Reuses newSheetsService / socialTabTitles / socialReadTab / socialMonthNames /
// socialYearRe from social_media.go (same package).

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const lbfCallCenterSpreadsheetID = "1PnPgs_XMKv-finvdsfjxJIX0GqGAp-Z-rvDp6VgVWtk"

// GetLBFCallCenterTargets — GET /api/lbf-callcenter-targets?months=2026-01,2026-06
//
// Returns the raw rows of each requested month's tab (all parseable months when
// no filter is given):
//
//	{ success, tabs: { "2026-06": { tab: "June 2026-Perfomance ", values: [[...]] }, ... } }
func GetLBFCallCenterTargets(c *gin.Context) {
	ctx := context.Background()
	svc, err := newSheetsService(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "google sheets client init failed: " + err.Error(),
		})
		return
	}

	// Optional months filter (YYYY-MM, comma-separated).
	want := map[string]bool{}
	if mq := strings.TrimSpace(c.Query("months")); mq != "" {
		for _, part := range strings.Split(mq, ",") {
			if p := strings.TrimSpace(part); p != "" {
				want[p] = true
			}
		}
	}

	titles := socialTabTitles(svc, lbfCallCenterSpreadsheetID)
	tabs := gin.H{}
	for _, title := range titles {
		up := strings.ToUpper(title)
		ym := socialYearRe.FindString(up)
		if ym == "" {
			continue
		}
		year, _ := strconv.Atoi(ym)
		month := 0
		for num := 1; num <= 12; num++ {
			if strings.Contains(up, socialMonthNames[num]) {
				month = num
				break
			}
		}
		if month == 0 {
			continue
		}
		key := fmt.Sprintf("%d-%02d", year, month)
		if len(want) > 0 && !want[key] {
			continue
		}
		if _, exists := tabs[key]; exists {
			continue // first tab for a month wins
		}
		tabs[key] = gin.H{"tab": title, "values": socialReadTab(svc, lbfCallCenterSpreadsheetID, title)}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "tabs": tabs})
}
