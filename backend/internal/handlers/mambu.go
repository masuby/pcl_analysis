package handlers

// MAMBU data — the employee register behind the CS affordability run.
//
// The extract is ~650,000 rows and ~60 MB, which shapes every decision here:
//
//   * The upload runs as a BACKGROUND JOB. A request that spends four minutes
//     parsing would sit past any sensible proxy timeout, so the handler stores
//     the file, returns an id, and the caller polls.
//   * Rows are read with excelize's streaming iterator and bulk-loaded with
//     COPY into a temporary staging table, then upserted in ONE statement.
//     Row-by-row INSERTs at this size take tens of minutes.
//   * check_number identifies a person, so an upload updates what it recognises
//     and appends what it does not. Nothing is deleted: a person missing from a
//     later extract is not evidence that they left the payroll.
//   * Unknown headers become new TEXT columns rather than being dropped, because
//     the extract has gained columns before and will again.

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/xuri/excelize/v2"
)

// Columns the affordability formula actually reads. Everything else in the
// extract is carried along as TEXT.
var mambuTypedColumns = map[string]string{
	"birth_date":   "date",
	"hiredate":     "date",
	"confirdate":   "date",
	"seniordate":   "date",
	"contract_end": "date",
	"grosspay":     "numeric",
	"basicpay":     "numeric",
	"netpay":       "numeric",
}

// A header only becomes a column if it looks like an identifier; anything else
// is a stray cell, and turning those into columns would corrupt the table.
var mambuSafeHeader = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

const mambuKeyColumn = "check_number"

// The columns the CS extract is expected to carry. Shown on the upload screen so
// somebody preparing a file knows what it must contain before they send 60 MB
// across. Extra columns are welcome — they are added to the table — but a file
// missing check_number identifies nobody, and one missing the salary or birth
// date columns cannot be run through the affordability formula.
var mambuExpectedColumns = []gin.H{
	{"name": "check_number", "required": true, "note": "identifies the person; rows are matched on this"},
	{"name": "votecode", "required": false, "note": "employer code"},
	{"name": "votename", "required": false, "note": "employer name"},
	{"name": "deptname", "required": false, "note": "department"},
	{"name": "first_name", "required": false, "note": ""},
	{"name": "middle_name", "required": false, "note": ""},
	{"name": "last_name", "required": false, "note": ""},
	{"name": "gender", "required": false, "note": ""},
	{"name": "birth_date", "required": true, "note": "needed for tenure — months to age 59.5"},
	{"name": "phone", "required": false, "note": "needed to call the lead"},
	{"name": "hiredate", "required": false, "note": ""},
	{"name": "confirdate", "required": false, "note": "confirmation date"},
	{"name": "seniordate", "required": false, "note": ""},
	{"name": "contract_end", "required": false, "note": ""},
	{"name": "jobtittle", "required": false, "note": "spelling as it appears in the extract"},
	{"name": "grosspay", "required": true, "note": "gross − basic gives allowances"},
	{"name": "basicpay", "required": true, "note": "a third of it is protected"},
	{"name": "netpay", "required": true, "note": "the starting point for affordability"},
}

// GetMambuEmployeeColumns — GET /api/mambu/employees/columns
func GetMambuEmployeeColumns(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "expected": mambuExpectedColumns})
}

// GetMambuEmployeesPreview — GET /api/mambu/employees/preview?limit=20
//
// The tail of the register, so somebody can see what is actually stored rather
// than trusting a row count. This returns personal data and stays behind the
// same authentication as everything else here.
func GetMambuEmployeesPreview(c *gin.Context) {
	limit := 20
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	rows, err := database.DB.Query(fmt.Sprintf(
		`SELECT check_number, COALESCE(votename,''), COALESCE(deptname,''),
		        btrim(COALESCE(first_name,'') || ' ' || COALESCE(middle_name,'') || ' ' || COALESCE(last_name,'')),
		        COALESCE(gender,''), birth_date, COALESCE(phone,''), COALESCE(jobtittle,''),
		        grosspay, basicpay, netpay, updated_at
		   FROM mambu_employees ORDER BY updated_at DESC, check_number LIMIT %d`, limit))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var (
			chk, vote, dept, name, gender, phone, title string
			birth                                       sql.NullTime
			gross, basic, net                           sql.NullFloat64
			updated                                     time.Time
		)
		if err := rows.Scan(&chk, &vote, &dept, &name, &gender, &birth, &phone, &title,
			&gross, &basic, &net, &updated); err != nil {
			continue
		}
		row := gin.H{
			"check_number": chk, "votename": vote, "deptname": dept, "name": name,
			"gender": gender, "phone": phone, "jobtittle": title, "updated_at": updated,
		}
		if birth.Valid {
			row["birth_date"] = birth.Time.Format("2006-01-02")
		}
		if gross.Valid {
			row["grosspay"] = gross.Float64
		}
		if basic.Valid {
			row["basicpay"] = basic.Float64
		}
		if net.Valid {
			row["netpay"] = net.Float64
		}
		out = append(out, row)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rows": out})
}

type mambuJob struct {
	mu       sync.Mutex
	running  bool
	uploadID string
}

var employeesJob = &mambuJob{}

// normaliseHeader turns "Check Number" / "CHECK_NUMBER " into "check_number".
func normaliseHeader(h string) string {
	s := strings.ToLower(strings.TrimSpace(h))
	s = strings.ReplaceAll(s, " ", "_")
	s = strings.ReplaceAll(s, "-", "_")
	s = regexp.MustCompile(`_+`).ReplaceAllString(s, "_")
	return strings.Trim(s, "_")
}

// UploadMambuEmployees — POST /api/mambu/employees/upload
func UploadMambuEmployees(c *gin.Context) {
	employeesJob.mu.Lock()
	if employeesJob.running {
		id := employeesJob.uploadID
		employeesJob.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{
			"success":  false,
			"error":    "An employee upload is already running.",
			"uploadId": id,
		})
		return
	}
	employeesJob.running = true
	employeesJob.mu.Unlock()

	release := func() {
		employeesJob.mu.Lock()
		employeesJob.running = false
		employeesJob.mu.Unlock()
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		release()
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "No file provided"})
		return
	}

	// Park the upload on disk first: parsing streams from the file, so it must
	// outlive the request.
	root := uploadPath
	if root == "" {
		root = "/var/reports"
	}
	dir := filepath.Join(root, "mambu")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		release()
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create upload directory"})
		return
	}
	uploadID := uuid.New()
	stored := filepath.Join(dir, fmt.Sprintf("%s_%s", uploadID.String(), filepath.Base(fileHeader.Filename)))
	if err := c.SaveUploadedFile(fileHeader, stored); err != nil {
		release()
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to store upload: " + err.Error()})
		return
	}

	var uploadedBy interface{}
	if v, ok := c.Get("userID"); ok {
		uploadedBy = v
	}
	if _, err := database.DB.Exec(
		`INSERT INTO mambu_uploads (id, kind, file_name, file_size, status, uploaded_by)
		 VALUES ($1, 'EMPLOYEES', $2, $3, 'RUNNING', $4)`,
		uploadID, fileHeader.Filename, fileHeader.Size, uploadedBy,
	); err != nil {
		release()
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to record upload: " + err.Error()})
		return
	}

	employeesJob.mu.Lock()
	employeesJob.uploadID = uploadID.String()
	employeesJob.mu.Unlock()

	go func() {
		defer release()
		defer os.Remove(stored) // the register is the record; the file is a courier
		stats, err := ingestEmployees(stored)
		if err != nil {
			_, _ = database.DB.Exec(
				`UPDATE mambu_uploads SET status='FAILED', error=$2, finished_at=now() WHERE id=$1`,
				uploadID, err.Error())
			return
		}
		_, _ = database.DB.Exec(
			`UPDATE mambu_uploads
			    SET status='DONE', rows_read=$2, rows_inserted=$3, rows_updated=$4,
			        columns_added=$5, finished_at=now()
			  WHERE id=$1`,
			uploadID, stats.RowsRead, stats.Inserted, stats.Updated,
			strings.Join(stats.ColumnsAdded, ", "))
	}()

	c.JSON(http.StatusAccepted, gin.H{
		"success":  true,
		"uploadId": uploadID,
		"message":  "Upload received. Processing in the background.",
	})
}

type ingestStats struct {
	RowsRead     int
	Inserted     int
	Updated      int
	ColumnsAdded []string
}

// existingEmployeeColumns reads the register's current shape.
func existingEmployeeColumns() (map[string]bool, error) {
	rows, err := database.DB.Query(
		`SELECT column_name FROM information_schema.columns WHERE table_name = 'mambu_employees'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out[n] = true
	}
	return out, rows.Err()
}

func ingestEmployees(path string) (*ingestStats, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot open workbook: %w", err)
	}
	defer f.Close()

	sheet := "Data"
	if !sheetExists(f, sheet) {
		names := f.GetSheetList()
		if len(names) == 0 {
			return nil, fmt.Errorf("workbook has no sheets")
		}
		sheet = names[0]
	}

	iter, err := f.Rows(sheet)
	if err != nil {
		return nil, fmt.Errorf("cannot read sheet %q: %w", sheet, err)
	}
	defer iter.Close()

	// ── header ───────────────────────────────────────────────────────────────
	if !iter.Next() {
		return nil, fmt.Errorf("sheet %q is empty", sheet)
	}
	rawHeader, err := iter.Columns()
	if err != nil {
		return nil, fmt.Errorf("cannot read header: %w", err)
	}
	headers := make([]string, 0, len(rawHeader))
	for _, h := range rawHeader {
		headers = append(headers, normaliseHeader(h))
	}

	keyIdx := -1
	for i, h := range headers {
		if h == mambuKeyColumn {
			keyIdx = i
			break
		}
	}
	if keyIdx == -1 {
		return nil, fmt.Errorf("the sheet has no %q column, so rows cannot be matched to people", mambuKeyColumn)
	}

	// ── grow the table if the extract has gained columns ──────────────────────
	existing, err := existingEmployeeColumns()
	if err != nil {
		return nil, err
	}
	stats := &ingestStats{}
	usable := make([]int, 0, len(headers)) // header indexes we will store
	for i, h := range headers {
		if h == "" || !mambuSafeHeader.MatchString(h) {
			continue // stray or unusable header — skip rather than corrupt the table
		}
		if !existing[h] {
			if _, err := database.DB.Exec(
				fmt.Sprintf(`ALTER TABLE mambu_employees ADD COLUMN IF NOT EXISTS %s TEXT`, pq.QuoteIdentifier(h)),
			); err != nil {
				return nil, fmt.Errorf("could not add new column %q: %w", h, err)
			}
			existing[h] = true
			stats.ColumnsAdded = append(stats.ColumnsAdded, h)
		}
		usable = append(usable, i)
	}

	// ── stage the file, then upsert in one statement ─────────────────────────
	tx, err := database.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	stageCols := make([]string, 0, len(usable))
	for _, i := range usable {
		stageCols = append(stageCols, headers[i])
	}
	createStage := fmt.Sprintf(
		`CREATE TEMP TABLE mambu_stage (%s) ON COMMIT DROP`,
		strings.Join(quotedTextColumns(stageCols), ", "))
	if _, err := tx.Exec(createStage); err != nil {
		return nil, fmt.Errorf("could not stage upload: %w", err)
	}

	stmt, err := tx.Prepare(pq.CopyIn("mambu_stage", stageCols...))
	if err != nil {
		return nil, fmt.Errorf("could not start bulk load: %w", err)
	}

	values := make([]interface{}, len(usable))
	for iter.Next() {
		cols, err := iter.Columns()
		if err != nil {
			return nil, fmt.Errorf("failed reading row %d: %w", stats.RowsRead+2, err)
		}
		key := ""
		if keyIdx < len(cols) {
			key = strings.TrimSpace(cols[keyIdx])
		}
		if key == "" {
			continue // a row without a check number identifies nobody
		}
		for n, i := range usable {
			if i < len(cols) {
				values[n] = strings.TrimSpace(cols[i])
			} else {
				values[n] = "" // trailing empties are omitted by the reader
			}
		}
		if _, err := stmt.Exec(values...); err != nil {
			return nil, fmt.Errorf("bulk load failed near row %d: %w", stats.RowsRead+2, err)
		}
		stats.RowsRead++
	}
	if _, err := stmt.Exec(); err != nil {
		return nil, fmt.Errorf("bulk load flush failed: %w", err)
	}
	if err := stmt.Close(); err != nil {
		return nil, err
	}

	if err := upsertEmployees(tx, stageCols, filepath.Base(path), stats); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return stats, nil
}

// upsertEmployees moves the staged rows into the register, updating people we
// already hold and appending the rest.
func upsertEmployees(tx *sql.Tx, stageCols []string, sourceFile string, stats *ingestStats) error {
	// how many of the staged people we already know — the rest are appends
	var known int
	if err := tx.QueryRow(
		`SELECT COUNT(*) FROM mambu_employees e
		  WHERE e.check_number IN (SELECT DISTINCT btrim(check_number) FROM mambu_stage)`,
	).Scan(&known); err != nil {
		return fmt.Errorf("could not compare against the register: %w", err)
	}

	insertCols := make([]string, 0, len(stageCols)+2)
	selectExprs := make([]string, 0, len(stageCols)+2)
	updates := make([]string, 0, len(stageCols))

	for _, col := range stageCols {
		q := pq.QuoteIdentifier(col)
		insertCols = append(insertCols, q)
		switch mambuTypedColumns[col] {
		case "date":
			selectExprs = append(selectExprs, fmt.Sprintf("mambu_date(s.%s)", q))
		case "numeric":
			selectExprs = append(selectExprs, fmt.Sprintf("mambu_num(s.%s)", q))
		default:
			if col == mambuKeyColumn {
				selectExprs = append(selectExprs, fmt.Sprintf("btrim(s.%s)", q))
			} else {
				selectExprs = append(selectExprs, fmt.Sprintf("s.%s", q))
			}
		}
		if col != mambuKeyColumn {
			updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", q, q))
		}
	}
	insertCols = append(insertCols, "source_file", "updated_at")
	selectExprs = append(selectExprs, "$1", "now()")
	updates = append(updates, "source_file = EXCLUDED.source_file", "updated_at = now()")

	// One row per person: a later row for the same check number wins, matching
	// "the newest statement of a person's details is the true one".
	query := fmt.Sprintf(`
		INSERT INTO mambu_employees (%s)
		SELECT %s FROM (
			SELECT DISTINCT ON (btrim(%s)) * FROM mambu_stage
			 WHERE btrim(%s) <> ''
			 ORDER BY btrim(%s), ctid DESC
		) s
		ON CONFLICT (check_number) DO UPDATE SET %s`,
		strings.Join(insertCols, ", "),
		strings.Join(selectExprs, ", "),
		pq.QuoteIdentifier(mambuKeyColumn),
		pq.QuoteIdentifier(mambuKeyColumn),
		pq.QuoteIdentifier(mambuKeyColumn),
		strings.Join(updates, ", "))

	res, err := tx.Exec(query, sourceFile)
	if err != nil {
		return fmt.Errorf("could not write to the register: %w", err)
	}
	affected, _ := res.RowsAffected()
	stats.Updated = known
	stats.Inserted = int(affected) - known
	if stats.Inserted < 0 {
		stats.Inserted = 0
	}
	return nil
}

func quotedTextColumns(cols []string) []string {
	out := make([]string, 0, len(cols))
	for _, c := range cols {
		out = append(out, pq.QuoteIdentifier(c)+" TEXT")
	}
	return out
}

func sheetExists(f *excelize.File, name string) bool {
	for _, s := range f.GetSheetList() {
		if s == name {
			return true
		}
	}
	return false
}

// GetMambuUpload — GET /api/mambu/uploads/:id
func GetMambuUpload(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid upload id"})
		return
	}
	var (
		kind, fileName, status string
		rowsRead, ins, upd     int
		colsAdded, errMsg      sql.NullString
		started                time.Time
		finished               sql.NullTime
	)
	err = database.DB.QueryRow(
		`SELECT kind, file_name, status, rows_read, rows_inserted, rows_updated,
		        columns_added, error, started_at, finished_at
		   FROM mambu_uploads WHERE id = $1`, id).
		Scan(&kind, &fileName, &status, &rowsRead, &ins, &upd, &colsAdded, &errMsg, &started, &finished)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Upload not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "id": id, "kind": kind, "fileName": fileName, "status": status,
		"rowsRead": rowsRead, "rowsInserted": ins, "rowsUpdated": upd,
		"columnsAdded": colsAdded.String, "error": errMsg.String,
		"startedAt": started, "finishedAt": finished.Time,
	})
}

// GetMambuEmployeesSummary — GET /api/mambu/employees/summary
//
// The little summary that sits above the register: how many people are on file,
// when it was last refreshed, and whether the salary fields the affordability
// run depends on are actually populated.
func GetMambuEmployeesSummary(c *gin.Context) {
	var (
		total, withPhone, withSalary, withBirth int64
		votes                                   int64
		lastUpdated                             sql.NullTime
		lastFile                                sql.NullString
	)
	err := database.DB.QueryRow(`
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE COALESCE(phone,'') <> ''),
		       COUNT(*) FILTER (WHERE netpay IS NOT NULL AND basicpay IS NOT NULL),
		       COUNT(*) FILTER (WHERE birth_date IS NOT NULL),
		       COUNT(DISTINCT votename),
		       MAX(updated_at)
		  FROM mambu_employees`).
		Scan(&total, &withPhone, &withSalary, &withBirth, &votes, &lastUpdated)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	_ = database.DB.QueryRow(
		`SELECT file_name FROM mambu_uploads
		  WHERE kind='EMPLOYEES' AND status='DONE'
		  ORDER BY finished_at DESC NULLS LAST LIMIT 1`).Scan(&lastFile)

	cols, _ := existingEmployeeColumns()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"employees": gin.H{
			"total": total, "withPhone": withPhone,
			"withSalary": withSalary, "withBirthDate": withBirth,
			"employers": votes, "columns": len(cols),
		},
		"lastUpdated": lastUpdated.Time,
		"lastFile":    lastFile.String,
	})
}

// ListMambuUploads — GET /api/mambu/uploads?kind=EMPLOYEES
func ListMambuUploads(c *gin.Context) {
	kind := c.DefaultQuery("kind", "")
	q := `SELECT id, kind, file_name, status, rows_read, rows_inserted, rows_updated,
	             COALESCE(columns_added,''), COALESCE(error,''), started_at, finished_at
	        FROM mambu_uploads`
	args := []interface{}{}
	if kind != "" {
		q += " WHERE kind = $1"
		args = append(args, strings.ToUpper(kind))
	}
	q += " ORDER BY started_at DESC LIMIT 20"

	rows, err := database.DB.Query(q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var (
			id                         uuid.UUID
			k, fn, st, colsAdded, eMsg string
			rr, ri, ru                 int
			started                    time.Time
			finished                   sql.NullTime
		)
		if err := rows.Scan(&id, &k, &fn, &st, &rr, &ri, &ru, &colsAdded, &eMsg, &started, &finished); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "kind": k, "fileName": fn, "status": st,
			"rowsRead": rr, "rowsInserted": ri, "rowsUpdated": ru,
			"columnsAdded": colsAdded, "error": eMsg,
			"startedAt": started, "finishedAt": finished.Time,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "uploads": out})
}
