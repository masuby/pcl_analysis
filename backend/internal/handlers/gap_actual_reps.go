package handlers

import (
	"bytes"
	"crypto/hmac"
	"fmt"
	"crypto/sha256"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/xuri/excelize/v2"
)

var gapFrontendURL string
var gapResponseSecret string
var gapGoogleSheetID string
var gapGoogleSheetGID string
var gapUploadPath string

// InitGapHandlers sets config for gap actual reps (response link and token signing)
func InitGapHandlers(cfg *config.GapConfig, jwtSecret string) {
	gapFrontendURL = strings.TrimSuffix(cfg.FrontendURL, "/")
	if cfg.ResponseSecret != "" {
		gapResponseSecret = cfg.ResponseSecret
	} else {
		gapResponseSecret = jwtSecret
	}
	if gapResponseSecret == "" {
		gapResponseSecret = "gap-response-default-secret"
	}
	gapGoogleSheetID = strings.TrimSpace(cfg.GoogleSheetID)
	gapGoogleSheetGID = strings.TrimSpace(cfg.GoogleSheetGID)
	if gapGoogleSheetGID == "" {
		gapGoogleSheetGID = "0"
	}
}

// InitGapStorage sets the directory where uploaded Gap Actual Reps Excel files are stored (one per report+product).
func InitGapStorage(uploadPath string) {
	gapUploadPath = filepath.Join(uploadPath, "gap_actual_reps")
	if gapUploadPath != "" {
		_ = os.MkdirAll(gapUploadPath, 0755)
	}
}

// gapResponseTokenPayload is encoded in the TL response link token
type gapResponseTokenPayload struct {
	ReportID      string `json:"reportId"`
	TeamLeaderKey string `json:"tlKey"`
	Product       string `json:"product"`
	Exp           int64  `json:"exp"` // unix seconds
}

func getGapResponseSecret() string {
	return gapResponseSecret
}

func getFrontendURL() string {
	if gapFrontendURL != "" {
		return gapFrontendURL
	}
	return "http://localhost:5173"
}

// signGapToken creates payload.exp = now + 30 days, signs with HMAC-SHA256, returns base64url(payload).base64url(sig)
func signGapToken(reportID, tlKey, product string) (string, error) {
	exp := time.Now().Add(30 * 24 * time.Hour).Unix()
	payload := gapResponseTokenPayload{ReportID: reportID, TeamLeaderKey: tlKey, Product: product, Exp: exp}
	b, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(b)
	mac := hmac.New(sha256.New, []byte(getGapResponseSecret()))
	mac.Write([]byte(payloadB64))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payloadB64 + "." + sigB64, nil
}

// verifyGapToken returns payload and nil if valid
func verifyGapToken(token string) (*gapResponseTokenPayload, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil, nil
	}
	payloadB64, sigB64 := parts[0], parts[1]
	mac := hmac.New(sha256.New, []byte(getGapResponseSecret()))
	mac.Write([]byte(payloadB64))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sigB64), []byte(expected)) {
		return nil, nil
	}
	dec, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, nil
	}
	var p gapResponseTokenPayload
	if err := json.Unmarshal(dec, &p); err != nil {
		return nil, nil
	}
	if p.Exp < time.Now().Unix() {
		return nil, nil // expired
	}
	return &p, nil
}

func getGoogleSheetEditURL() string {
	if gapGoogleSheetID == "" {
		return ""
	}
	return "https://docs.google.com/spreadsheets/d/" + gapGoogleSheetID + "/edit"
}

// fetchGapActualRepsFromSheet fetches CSV export and returns map[reportId][tlKey]=value for the given reportId
func fetchGapActualRepsFromSheet(reportIDStr string) map[string]float64 {
	if gapGoogleSheetID == "" {
		return nil
	}
	exportURL := "https://docs.google.com/spreadsheets/d/" + gapGoogleSheetID + "/export?format=csv&gid=" + gapGoogleSheetGID
	resp, err := http.Get(exportURL)
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil
	}
	defer resp.Body.Close()
	reader := csv.NewReader(resp.Body)
	rows, err := reader.ReadAll()
	if err != nil || len(rows) < 2 {
		return nil
	}
	headers := rows[0]
	reportIdCol, tlKeyCol, valueCol := -1, -1, -1
	normalize := func(s string) string {
		s = strings.TrimSpace(strings.ToUpper(s))
		return strings.ReplaceAll(s, " ", "")
	}
	for i, h := range headers {
		hu := normalize(h)
		switch {
		case hu == "REPORTID" || hu == "REPORT_ID":
			reportIdCol = i
		case hu == "TEAMLEADERKEY" || hu == "TEAM_LEADER_KEY" || hu == "TLKEY":
			tlKeyCol = i
		case hu == "ACTUALREPS" || hu == "ACTUAL_REPS" || hu == "VALUE" || (strings.Contains(hu, "ACTUAL") && strings.Contains(hu, "REP")):
			valueCol = i
		}
	}
	if reportIdCol < 0 || tlKeyCol < 0 || valueCol < 0 {
		return nil
	}
	out := make(map[string]float64)
	for _, row := range rows[1:] {
		if len(row) <= reportIdCol || len(row) <= tlKeyCol || len(row) <= valueCol {
			continue
		}
		rId := strings.TrimSpace(row[reportIdCol])
		if rId != reportIDStr {
			continue
		}
		tlKey := strings.TrimSpace(row[tlKeyCol])
		if tlKey == "" || strings.HasPrefix(tlKey, "{") || tlKey == "tlKey" {
			continue
		}
		v, _ := strconv.ParseFloat(strings.TrimSpace(row[valueCol]), 64)
		out[tlKey] = v
	}
	return out
}

// GetGapActualRepsByReport returns actual reps and recipient emails for a report (auth required). No longer reads from Google Sheet.
func GetGapActualRepsByReport(c *gin.Context) {
	reportIDStr := c.Param("reportId")
	if reportIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reportId required"})
		return
	}
	reportID, err := uuid.Parse(reportIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reportId"})
		return
	}
	data, err := models.GetGapActualRepsByReport(reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	emails, _ := models.GetGapRecipientEmailsByReport(reportID)
	if emails == nil {
		emails = make(map[string]models.RecipientEmailInfo)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "recipientEmails": emails})
}

// GetGapSheetURL returns the Google Sheet edit URL for TLs (auth required)
func GetGapSheetURL(c *gin.Context) {
	url := getGoogleSheetEditURL()
	if url == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": ""}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": url}})
}

// PostGapActualRepWithToken is the public endpoint for TL to submit their value (token in body)
func PostGapActualRepWithToken(c *gin.Context) {
	var req struct {
		Token string  `json:"token" binding:"required"`
		Value float64 `json:"value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "token and value required"})
		return
	}
	p, err := verifyGapToken(req.Token)
	if err != nil || p == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid or expired link"})
		return
	}
	reportID, err := uuid.Parse(p.ReportID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid token"})
		return
	}
	if err := models.UpsertGapActualRep(reportID, p.TeamLeaderKey, p.Product, req.Value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Your response has been saved."})
}

// GetGapResponseLink returns a signed URL for the TL to submit their Actual Sales Rep (auth required)
func GetGapResponseLink(c *gin.Context) {
	reportIDStr := c.Query("reportId")
	tlKey := c.Query("tlKey")
	product := c.DefaultQuery("product", "CS")
	if reportIDStr == "" || tlKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reportId and tlKey required"})
		return
	}
	if _, err := uuid.Parse(reportIDStr); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reportId"})
		return
	}
	token, err := signGapToken(reportIDStr, tlKey, product)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	url := getFrontendURL() + "/gap-response?token=" + token
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": url}})
}

// PostGapActualRepForReport allows HOD to save/update actual rep for a team leader (auth required)
func PostGapActualRepForReport(c *gin.Context) {
	reportIDStr := c.Param("reportId")
	if reportIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reportId required"})
		return
	}
	reportID, err := uuid.Parse(reportIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reportId"})
		return
	}
	var req struct {
		TeamLeaderKey string  `json:"teamLeaderKey" binding:"required"`
		Value         float64 `json:"value"`
		Product       string  `json:"product"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "teamLeaderKey required"})
		return
	}
	product := req.Product
	if product == "" {
		product = "CS"
	}
	if err := models.UpsertGapActualRep(reportID, req.TeamLeaderKey, product, req.Value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Saved."})
}

// column indices for upload Excel: Supervision, Product, Team Leader Name, Email, Name (optional), Actual Sales Reps
func parseGapUploadHeaders(headers []string) (supervisionCol, productCol, nameCol, emailCol, displayNameCol, actualCol int) {
	supervisionCol, productCol, nameCol, emailCol, displayNameCol, actualCol = -1, -1, -1, -1, -1, -1
	norm := func(s string) string { return strings.TrimSpace(strings.ToUpper(strings.ReplaceAll(s, " ", ""))) }
	for i, h := range headers {
		n := norm(h)
		switch {
		case n == "SUPERVISION":
			supervisionCol = i
		case n == "PRODUCT":
			productCol = i
		case (strings.Contains(n, "TEAMLEADER") && strings.Contains(n, "NAME")) || n == "TEAMLEADERNAME":
			nameCol = i
		case n == "EMAIL":
			emailCol = i
		case n == "NAME":
			displayNameCol = i // optional display name for email (after Email column)
		case (strings.Contains(n, "ACTUAL") && strings.Contains(n, "REP")) || n == "ACTUALSALESREPS":
			actualCol = i
		}
	}
	return
}

// PostGapActualRepsUpload accepts an Excel file with sheets Branch and RSM; columns: Supervision, Product, Team Leader Name, Email, Actual Sales Reps. Upserts actual reps and recipient emails.
func PostGapActualRepsUpload(c *gin.Context) {
	reportIDStr := c.Param("reportId")
	if reportIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reportId required"})
		return
	}
	reportID, err := uuid.Parse(reportIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reportId"})
		return
	}
	product := c.DefaultQuery("product", "CS")
	if product == "" {
		product = "CS"
	}

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "file required"})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "failed to read file"})
		return
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid Excel file"})
		return
	}
	defer f.Close()

	sheets := f.GetSheetList()
	updated := 0
	for _, sheetName := range sheets {
		sheetNorm := strings.TrimSpace(strings.ToUpper(sheetName))
		isBranch := sheetNorm == "BRANCH"
		isRSM := sheetNorm == "RSM"
		if !isBranch && !isRSM {
			continue
		}
		rows, err := f.GetRows(sheetName)
		if err != nil || len(rows) < 2 {
			continue
		}
		headers := rows[0]
		supCol, productCol, nameCol, emailCol, displayNameCol, actualCol := parseGapUploadHeaders(headers)
		if supCol < 0 || actualCol < 0 {
			continue
		}
		if emailCol < 0 {
			// Log so you can inspect: Excel may use a different header than "Email"
			fmt.Printf("[Gap upload] Sheet %q: no Email column found. Headers: %v\n", sheetName, headers)
		}
		if nameCol < 0 {
			fmt.Printf("[Gap upload] Sheet %q: no Team Leader Name column found. Headers: %v\n", sheetName, headers)
		}
		productUpper := strings.ToUpper(product)
		for _, row := range rows[1:] {
			if len(row) <= supCol || len(row) <= actualCol {
				continue
			}
			// Only process rows where Product column matches the upload product (avoid mixing CS/LBF/SME)
			if productCol >= 0 && len(row) > productCol {
				rowProduct := strings.TrimSpace(strings.ToUpper(row[productCol]))
				if rowProduct != "" && rowProduct != productUpper {
					continue
				}
			}
			supervision := strings.TrimSpace(row[supCol])
			if supervision == "" {
				continue
			}
			var key string
			if isRSM {
				// RSM: match by "Team Leader Name" from Excel (that column holds the supervision/region name)
				if nameCol >= 0 && len(row) > nameCol && strings.TrimSpace(row[nameCol]) != "" {
					key = "RSM:" + strings.TrimSpace(row[nameCol])
				} else {
					key = "RSM:" + supervision
				}
			} else {
				// Branch: key = Team Leader Name | Supervision
				name := ""
				if nameCol >= 0 && len(row) > nameCol {
					name = strings.TrimSpace(row[nameCol])
				}
				key = name + "|" + supervision
			}
			email := ""
			if emailCol >= 0 && len(row) > emailCol {
				email = strings.TrimSpace(row[emailCol])
			}
			displayName := ""
			if displayNameCol >= 0 && len(row) > displayNameCol {
				displayName = strings.TrimSpace(row[displayNameCol])
			}
			actualStr := ""
			if len(row) > actualCol {
				actualStr = strings.TrimSpace(row[actualCol])
			}
			val, _ := strconv.ParseFloat(actualStr, 64)
			if err := models.UpsertGapActualRep(reportID, key, product, val); err != nil {
				continue
			}
			if err := models.UpsertGapRecipientEmail(reportID, key, product, email, displayName); err != nil {
				continue
			}
			updated++
		}
	}
	// Save the uploaded file for future view/replace (one file per report+product)
	if gapUploadPath != "" {
		filename := reportID.String() + "_" + product + ".xlsx"
		fullPath := filepath.Join(gapUploadPath, filename)
		if err := os.WriteFile(fullPath, data, 0644); err != nil {
			// Log but don't fail the request; data was already applied to DB
			// nolint:errcheck
			c.JSON(http.StatusOK, gin.H{"success": true, "message": "Upload complete. File could not be saved for viewing.", "updated": updated})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Upload complete. File saved for future use.", "updated": updated})
}

// GetGapUploadedFile returns the Excel file previously uploaded for this report+product (auth required). 404 if none.
func GetGapUploadedFile(c *gin.Context) {
	reportIDStr := c.Param("reportId")
	product := c.DefaultQuery("product", "CS")
	if product == "" {
		product = "CS"
	}
	if reportIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reportId required"})
		return
	}
	reportID, err := uuid.Parse(reportIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reportId"})
		return
	}
	if gapUploadPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no file uploaded"})
		return
	}
	filename := reportID.String() + "_" + product + ".xlsx"
	fullPath := filepath.Join(gapUploadPath, filename)
	data, err := os.ReadFile(fullPath)
	if err != nil || len(data) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no file uploaded for this report and product"})
		return
	}
	c.Header("Content-Disposition", "inline; filename=\""+filename+"\"")
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data)
}

// DeleteGapUploadedFile removes the saved Excel file for this report+product (auth required).
func DeleteGapUploadedFile(c *gin.Context) {
	reportIDStr := c.Param("reportId")
	product := c.DefaultQuery("product", "CS")
	if product == "" {
		product = "CS"
	}
	if reportIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reportId required"})
		return
	}
	reportID, err := uuid.Parse(reportIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reportId"})
		return
	}
	if gapUploadPath == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "No file to remove."})
		return
	}
	filename := reportID.String() + "_" + product + ".xlsx"
	fullPath := filepath.Join(gapUploadPath, filename)
	if err := os.Remove(fullPath); err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{"success": true, "message": "No file to remove."})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "File removed."})
}

// GetGapResponseTokenPayload is a public endpoint used by the frontend TL response page to decode and show context (optional)
// We don't expose full payload for security; frontend just needs to submit token + value. So we can skip this or return minimal info.
func GetGapResponseTokenPayload(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "token required"})
		return
	}
	p, err := verifyGapToken(token)
	if err != nil || p == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid or expired link"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"product": p.Product,
			"expired": p.Exp < time.Now().Unix(),
		},
	})
}
