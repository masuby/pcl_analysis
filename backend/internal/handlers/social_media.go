package handlers

// Social Media Analysis — reads the unified "MAY 2026 SHEET" from both the
// LBF/SME workbook and the CS workbook (via Google Sheets API using the
// shared service account) and returns the raw rows as JSON.
//
// Frontend (DepartmentalDashboard / SocialMediaAnalysis) takes those rows,
// computes the Data / Agent Performance / Dispositions roll-ups, and builds
// the downloadable XLSX + email body client-side.

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"google.golang.org/api/option"
	sheets "google.golang.org/api/sheets/v4"
)

// Hard-coded sheet IDs — these are the operational call-centre workbooks
// the service account already has access to. The "MAY 2026 SHEET" tab in
// each is created and maintained by bootstrap_may2026.py.
const (
	socialLBFSpreadsheetID = "1n2U_Tt-7fC3hRRIfFHrcyTT9HkN408C_YN4jUbPFeZE"
	socialCSSpreadsheetID  = "14bZuq-NLlIp7HToHCrhn7HA3eQQtjRsKt0z1Nbzy1bI"
	socialTargetTab        = "MAY 2026 SHEET"
)

// GetSocialMediaData — GET /api/social-media/data
//
// Pulls both unified MAY 2026 sheets and returns them as { lbf: rows, cs: rows }.
// First row of each list is the header.
func GetSocialMediaData(c *gin.Context) {
	credPath := os.Getenv("SHEETS_CREDENTIALS_PATH")
	if credPath == "" {
		credPath = "./credentials/sheets-service-account.json"
	}

	ctx := context.Background()
	svc, err := sheets.NewService(ctx, option.WithCredentialsFile(credPath))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "google sheets client init failed: " + err.Error(),
		})
		return
	}

	rng := fmt.Sprintf("'%s'!A1:Z3000", socialTargetTab)

	lbf, err := svc.Spreadsheets.Values.Get(socialLBFSpreadsheetID, rng).
		ValueRenderOption("UNFORMATTED_VALUE").
		Do()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "fetch LBF sheet failed: " + err.Error(),
		})
		return
	}
	cs, err := svc.Spreadsheets.Values.Get(socialCSSpreadsheetID, rng).
		ValueRenderOption("UNFORMATTED_VALUE").
		Do()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "fetch CS sheet failed: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"period":  socialTargetTab,
		"lbf":     lbf.Values,
		"cs":      cs.Values,
	})
}
