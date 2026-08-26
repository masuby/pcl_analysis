package handlers

// The two source files the refinance / reactivation runs read.
//
// They are uploaded once and then STAY. A run never asks for a file — it uses
// whatever is currently active, which is why LBF, SME and Agrifinance all see
// the same data the moment one of them is updated. A file is only superseded by
// an explicit replace, so running a report can never quietly change the inputs.

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// The two kinds, and what each is for in plain terms.
var mambuSourceKinds = map[string]struct {
	Label      string
	Purpose    string
	NeedsCols  []string
	FilePrefix string
}{
	"LOAN": {
		Label:      "Loan accounts export",
		Purpose:    "Used for refinance — who is far enough through their current loan to top up.",
		NeedsCols:  []string{"Account Holder Name", "Branch", "Birth Date (Client)", "Activation Date", "Number of Installments"},
		FilePrefix: "Loan_Accounts",
	},
	"CLIENTS": {
		Label:      "Clients export",
		Purpose:    "Used for reactivation — who left and could be brought back.",
		NeedsCols:  []string{"Full Name", "Branch", "Birth Date", "Created"},
		FilePrefix: "Clients",
	},
}

func mambuRoot() string {
	root := uploadPath
	if root == "" {
		root = "/var/reports"
	}
	return root
}

// GetMambuSourceKinds — GET /api/mambu/sources/kinds
// What the two slots are, and which columns each file must carry.
func GetMambuSourceKinds(c *gin.Context) {
	out := []gin.H{}
	for _, k := range []string{"LOAN", "CLIENTS"} {
		m := mambuSourceKinds[k]
		out = append(out, gin.H{
			"kind": k, "label": m.Label, "purpose": m.Purpose,
			"requiredColumns": m.NeedsCols, "filePrefix": m.FilePrefix,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "kinds": out})
}

// UploadMambuSource — POST /api/mambu/sources/:kind
// Stores the file and makes it the active one for that slot, retiring whatever
// was there. The previous file is kept on disk and in the table so a mistaken
// replace can be traced.
func UploadMambuSource(c *gin.Context) {
	kind := strings.ToUpper(strings.TrimSpace(c.Param("kind")))
	meta, ok := mambuSourceKinds[kind]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "Unknown file kind. Expected LOAN or CLIENTS."})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "No file provided"})
		return
	}
	name := filepath.Base(fileHeader.Filename)
	if ext := strings.ToLower(filepath.Ext(name)); ext != ".xlsx" && ext != ".xls" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "Only .xlsx / .xls exports are accepted."})
		return
	}

	dir := filepath.Join(mambuRoot(), "mambu", "sources", strings.ToLower(kind))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false,
			"error": "Could not create the storage directory: " + err.Error()})
		return
	}

	id := uuid.New()
	rel := filepath.Join("mambu", "sources", strings.ToLower(kind),
		fmt.Sprintf("%s_%s", id.String(), name))
	full := filepath.Join(mambuRoot(), rel)
	if err := c.SaveUploadedFile(fileHeader, full); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false,
			"error": "Could not store the file: " + err.Error()})
		return
	}

	// Validate before it becomes active — a wrong export should be rejected at
	// upload, not three minutes into a run.
	t, err := readSheetTable(full)
	if err != nil {
		os.Remove(full)
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "That file could not be read as a spreadsheet: " + err.Error()})
		return
	}
	var missing []string
	for _, col := range meta.NeedsCols {
		if !t.Has(col) {
			missing = append(missing, col)
		}
	}
	if len(missing) > 0 {
		os.Remove(full)
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": fmt.Sprintf("This does not look like a %s. Missing column(s): %s.",
				meta.Label, strings.Join(missing, ", "))})
		return
	}

	sum := fileSHA256(full)
	info, _ := os.Stat(full)
	var size int64
	if info != nil {
		size = info.Size()
	}

	// Retire the current file, then install this one. Done in a transaction so
	// the "exactly one active" index can never be left violated.
	tx, err := database.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE mambu_source_files SET is_active = FALSE, replaced_at = now()
		  WHERE kind = $1 AND is_active`, kind); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	var uploadedBy interface{}
	if v, ok := c.Get("userID"); ok {
		uploadedBy = v
	}
	if _, err := tx.Exec(
		`INSERT INTO mambu_source_files
		   (id, kind, file_name, file_path, file_size, sha256, row_count, column_count, uploaded_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, kind, name, rel, size, sum, t.Len(), len(t.Cols), uploadedBy); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "id": id, "kind": kind, "fileName": name,
		"rows": t.Len(), "columns": len(t.Cols),
		"message": fmt.Sprintf("%s stored — %s rows. It stays in use until you replace it.",
			meta.Label, formatThousands(t.Len())),
	})
}

// ListMambuSources — GET /api/mambu/sources
// The active file per slot plus the recent history, so it is always visible
// which data a run would read.
func ListMambuSources(c *gin.Context) {
	rows, err := database.DB.Query(
		`SELECT id, kind, file_name, file_size, COALESCE(sha256,''),
		        COALESCE(row_count,0), COALESCE(column_count,0),
		        is_active, uploaded_at, replaced_at
		   FROM mambu_source_files
		  ORDER BY uploaded_at DESC LIMIT 60`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	active := gin.H{}
	history := []gin.H{}
	for rows.Next() {
		var id uuid.UUID
		var kind, name, sum string
		var size int64
		var rc, cc int
		var isActive bool
		var uploadedAt time.Time
		var replacedAt sql.NullTime
		if err := rows.Scan(&id, &kind, &name, &size, &sum, &rc, &cc,
			&isActive, &uploadedAt, &replacedAt); err != nil {
			continue
		}
		item := gin.H{
			"id": id, "kind": kind, "fileName": name, "fileSize": size,
			"sha256": sum, "rows": rc, "columns": cc, "isActive": isActive,
			"uploadedAt": uploadedAt,
		}
		if replacedAt.Valid {
			item["replacedAt"] = replacedAt.Time
		}
		if isActive {
			active[kind] = item
		}
		history = append(history, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "active": active, "history": history,
		"ready": active["LOAN"] != nil || active["CLIENTS"] != nil,
	})
}

// DeleteMambuSource — DELETE /api/mambu/sources/:kind
// Clears the active file for a slot. The file stays on disk and in history;
// only its "current" status is removed, because runs that already used it
// should remain explainable.
func DeleteMambuSource(c *gin.Context) {
	kind := strings.ToUpper(strings.TrimSpace(c.Param("kind")))
	if _, ok := mambuSourceKinds[kind]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Unknown file kind"})
		return
	}
	res, err := database.DB.Exec(
		`UPDATE mambu_source_files SET is_active = FALSE, replaced_at = now()
		  WHERE kind = $1 AND is_active`, kind)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "There is no active file for that slot"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "kind": kind,
		"message": "Cleared. Upload a file before running this report again."})
}

// activeSource returns the current file for a slot.
func activeSource(kind string) (id uuid.UUID, fullPath, fileName string, err error) {
	var rel string
	err = database.DB.QueryRow(
		`SELECT id, file_path, file_name FROM mambu_source_files
		  WHERE kind = $1 AND is_active`, kind).Scan(&id, &rel, &fileName)
	if err != nil {
		return uuid.Nil, "", "", err
	}
	return id, filepath.Join(mambuRoot(), rel), fileName, nil
}

func fileSHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

func formatThousands(n int) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	return string(out)
}
