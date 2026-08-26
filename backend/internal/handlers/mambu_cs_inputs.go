package handlers

// The two CS affordability inputs: the deduction (Inst) extract and the CS loan
// extract. Both arrive as several files, because the extract is bigger than a
// worksheet can hold — May's deductions were 1,050,458 rows across two files.
//
// Uploading works as a BATCH: files go one at a time into an open batch, and
// activating the batch makes it the one the affordability run reads and retires
// the previous one. That is deliberately different from the employee register,
// which accumulates. A person missing from a later payroll extract has not left
// the payroll; a deduction missing from a later extract has been SETTLED, and
// carrying it forward would make that person look permanently poorer than they
// are and quietly stop them qualifying.

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
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

var csUploadJob struct {
	mu      sync.Mutex
	running bool
}

// What each batch kind needs, in the words the export uses.
var csBatchKinds = map[string]struct {
	Label     string
	Purpose   string
	Sheet     string
	NeedsCols []string
}{
	"INST": {
		Label:     "Deductions (Inst) extract",
		Purpose:   "What is already coming off each person's salary. Subtracted before working out what they can afford, and for a refinance the current installment is added back.",
		Sheet:     "Inst",
		NeedsCols: []string{"check_number", "installment", "balance"},
	},
	"CS_LOAN": {
		Label:     "CS loan accounts extract",
		Purpose:   "Decides who is Refinance, Reactivation or New, and which branch they belong to. A live balance means Refinance, a settled one Reactivation, and anyone absent is New.",
		Sheet:     "Loan Accounts",
		NeedsCols: []string{"Check Number (Client)", "Total Balance", "Branch"},
	},
}

// GetCSBatchKinds — GET /api/mambu/cs/kinds
func GetCSBatchKinds(c *gin.Context) {
	out := []gin.H{}
	for _, k := range []string{"INST", "CS_LOAN"} {
		m := csBatchKinds[k]
		out = append(out, gin.H{
			"kind": k, "label": m.Label, "purpose": m.Purpose,
			"sheet": m.Sheet, "requiredColumns": m.NeedsCols,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "kinds": out})
}

// ListCSBatches — GET /api/mambu/cs/batches
func ListCSBatches(c *gin.Context) {
	rows, err := database.DB.Query(
		`SELECT id, kind, status, COALESCE(file_names,''), file_count, row_count,
		        created_at, activated_at
		   FROM mambu_cs_batches
		  WHERE status <> 'SUPERSEDED' OR created_at > now() - interval '60 days'
		  ORDER BY created_at DESC LIMIT 40`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	active := gin.H{}
	open := gin.H{}
	history := []gin.H{}
	for rows.Next() {
		var id uuid.UUID
		var kind, status, names string
		var fileCount, rowCount int
		var created time.Time
		var activated *time.Time
		if err := rows.Scan(&id, &kind, &status, &names, &fileCount, &rowCount,
			&created, &activated); err != nil {
			continue
		}
		item := gin.H{
			"id": id, "kind": kind, "status": status,
			"files": splitNonEmpty(names), "fileCount": fileCount,
			"rows": rowCount, "createdAt": created,
		}
		if activated != nil {
			item["activatedAt"] = *activated
		}
		switch status {
		case "ACTIVE":
			active[kind] = item
		case "OPEN":
			open[kind] = item
		}
		history = append(history, item)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "active": active, "open": open, "history": history,
	})
}

// UploadCSFile — POST /api/mambu/cs/:kind/upload
//
// Adds one file to the open batch for that kind, creating the batch if there
// is none. The batch is not used by any report until it is activated.
func UploadCSFile(c *gin.Context) {
	kind := strings.ToUpper(strings.TrimSpace(c.Param("kind")))
	meta, ok := csBatchKinds[kind]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "Unknown kind. Expected INST or CS_LOAN."})
		return
	}

	csUploadJob.mu.Lock()
	if csUploadJob.running {
		csUploadJob.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false,
			"error": "Another file is still being read. Wait for it to finish."})
		return
	}
	csUploadJob.running = true
	csUploadJob.mu.Unlock()
	defer func() {
		csUploadJob.mu.Lock()
		csUploadJob.running = false
		csUploadJob.mu.Unlock()
	}()

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "No file provided"})
		return
	}
	name := filepath.Base(fileHeader.Filename)

	dir := filepath.Join(mambuRoot(), "mambu", "cs", strings.ToLower(kind))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	stored := filepath.Join(dir, fmt.Sprintf("%s_%s", uuid.New().String(), name))
	if err := c.SaveUploadedFile(fileHeader, stored); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false,
			"error": "Could not store the file: " + err.Error()})
		return
	}
	defer os.Remove(stored) // the rows are in the database; the file is not needed

	// Find or open the batch.
	var batchID uuid.UUID
	err = database.DB.QueryRow(
		`SELECT id FROM mambu_cs_batches WHERE kind=$1 AND status='OPEN'
		  ORDER BY created_at DESC LIMIT 1`, kind).Scan(&batchID)
	if err != nil {
		batchID = uuid.New()
		var by interface{}
		if v, ok := c.Get("userID"); ok {
			by = v
		}
		if _, err := database.DB.Exec(
			`INSERT INTO mambu_cs_batches (id, kind, status, uploaded_by)
			 VALUES ($1,$2,'OPEN',$3)`, batchID, kind, by); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
			return
		}
	}

	n, err := ingestCSFile(kind, meta.Sheet, meta.NeedsCols, stored, batchID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	var files string
	var fileCount, rowCount int
	database.DB.QueryRow(
		`UPDATE mambu_cs_batches
		    SET file_names = CASE WHEN COALESCE(file_names,'')='' THEN $2
		                          ELSE file_names || ',' || $2 END,
		        file_count = file_count + 1,
		        row_count  = row_count + $3
		  WHERE id = $1
		  RETURNING COALESCE(file_names,''), file_count, row_count`,
		batchID, name, n).Scan(&files, &fileCount, &rowCount)

	c.JSON(http.StatusOK, gin.H{
		"success": true, "batchId": batchID, "kind": kind,
		"fileName": name, "rowsRead": n,
		"batchFiles": fileCount, "batchRows": rowCount,
		"files": splitNonEmpty(files),
		"message": fmt.Sprintf("%s read — %s rows. %d file(s) in this batch, %s rows so far. "+
			"Activate the batch when every file is in.",
			name, formatThousands(n), fileCount, formatThousands(rowCount)),
	})
}

// ActivateCSBatch — POST /api/mambu/cs/batches/:id/activate
//
// Makes an open batch the one the affordability run reads, and retires the
// previous one. Kept as a separate step so a half-uploaded extract can never
// be picked up by a report.
func ActivateCSBatch(c *gin.Context) {
	id := c.Param("id")

	var kind, status string
	var rowCount int
	if err := database.DB.QueryRow(
		`SELECT kind, status, row_count FROM mambu_cs_batches WHERE id=$1`, id).
		Scan(&kind, &status, &rowCount); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "No such batch"})
		return
	}
	if status == "ACTIVE" {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "That batch is already in use."})
		return
	}
	if rowCount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "That batch has no rows in it yet."})
		return
	}

	tx, err := database.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE mambu_cs_batches SET status='SUPERSEDED', superseded_at=now()
		  WHERE kind=$1 AND status='ACTIVE'`, kind); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if _, err := tx.Exec(
		`UPDATE mambu_cs_batches SET status='ACTIVE', activated_at=now() WHERE id=$1`, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "kind": kind,
		"message": fmt.Sprintf("This %s batch is now the one reports read (%s rows). "+
			"The previous one has been retired.",
			csBatchKinds[kind].Label, formatThousands(rowCount))})
}

// DeleteCSBatch — DELETE /api/mambu/cs/batches/:id
// Discards an open batch that was uploaded by mistake.
func DeleteCSBatch(c *gin.Context) {
	id := c.Param("id")
	var status string
	if err := database.DB.QueryRow(
		`SELECT status FROM mambu_cs_batches WHERE id=$1`, id).Scan(&status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "No such batch"})
		return
	}
	if status == "ACTIVE" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "That batch is in use by reports. Activate a replacement instead of deleting it."})
		return
	}
	if _, err := database.DB.Exec(`DELETE FROM mambu_cs_batches WHERE id=$1`, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Batch discarded."})
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

// ingestCSFile streams one workbook into the batch with COPY. The extract runs
// to a million rows, so nothing is held in memory beyond the copy buffer.
func ingestCSFile(kind, sheet string, needCols []string, path string, batchID uuid.UUID) (int, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return 0, fmt.Errorf("cannot open workbook: %w", err)
	}
	defer f.Close()

	if !sheetExists(f, sheet) {
		names := f.GetSheetList()
		if len(names) == 0 {
			return 0, fmt.Errorf("the workbook has no sheets")
		}
		sheet = names[0]
	}

	iter, err := f.Rows(sheet)
	if err != nil {
		return 0, fmt.Errorf("cannot read sheet %q: %w", sheet, err)
	}
	defer iter.Close()

	if !iter.Next() {
		return 0, fmt.Errorf("sheet %q is empty", sheet)
	}
	rawHeader, err := iter.Columns()
	if err != nil {
		return 0, err
	}
	idx := map[string]int{}
	for i, h := range rawHeader {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	col := func(name string) int {
		if i, ok := idx[strings.ToLower(strings.TrimSpace(name))]; ok {
			return i
		}
		return -1
	}

	var missing []string
	for _, need := range needCols {
		if col(need) < 0 {
			missing = append(missing, need)
		}
	}
	if len(missing) > 0 {
		hint := ""
		if kind == "CS_LOAN" {
			hint = " This looks like the Loan_Accounts export the LBF/SME refinance " +
				"report reads, which is keyed on Account Holder Name and carries no " +
				"check number, so it cannot be matched to the payroll register. The CS " +
				"export must include Check Number (Client) and Total Balance."
		}
		return 0, fmt.Errorf("this file is missing the column(s): %s.%s",
			strings.Join(missing, ", "), hint)
	}

	get := func(cells []string, i int) string {
		if i < 0 || i >= len(cells) {
			return ""
		}
		return strings.TrimSpace(cells[i])
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var stmt *sql.Stmt
	if kind == "INST" {
		stmt, err = tx.Prepare(pq.CopyIn("mambu_installments",
			"batch_id", "check_number", "installment", "balance",
			"application_number", "dedcode", "dedname"))
	} else {
		stmt, err = tx.Prepare(pq.CopyIn("mambu_cs_loans",
			"batch_id", "check_number", "total_balance", "branch", "account_state"))
	}
	if err != nil {
		return 0, err
	}

	iChk, iInst, iBal := col("check_number"), col("installment"), col("balance")
	iApp, iDedC, iDedN := col("application_number"), col("dedcode"), col("dedname")
	lChk, lBal := col("Check Number (Client)"), col("Total Balance")
	lBranch, lState := col("Branch"), col("Account State")

	n := 0
	for iter.Next() {
		cells, err := iter.Columns()
		if err != nil {
			continue
		}
		if kind == "INST" {
			chk := get(cells, iChk)
			if chk == "" {
				continue // a deduction with nobody to attach it to is not usable
			}
			if _, err := stmt.Exec(batchID, chk,
				numOrNil(get(cells, iInst)), numOrNil(get(cells, iBal)),
				textOrNil(get(cells, iApp)), textOrNil(get(cells, iDedC)),
				textOrNil(get(cells, iDedN))); err != nil {
				return 0, fmt.Errorf("row %d: %w", n+2, err)
			}
		} else {
			chk := get(cells, lChk)
			if chk == "" {
				continue
			}
			if _, err := stmt.Exec(batchID, chk,
				numOrNil(get(cells, lBal)), textOrNil(get(cells, lBranch)),
				textOrNil(get(cells, lState))); err != nil {
				return 0, fmt.Errorf("row %d: %w", n+2, err)
			}
		}
		n++
	}

	if _, err := stmt.Exec(); err != nil {
		return 0, fmt.Errorf("finishing the copy: %w", err)
	}
	if err := stmt.Close(); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}

// numOrNil keeps a blank or unreadable figure out of the database as NULL
// rather than a misleading zero — a missing installment is not a zero one, and
// the difference decides whether somebody qualifies.
func numOrNil(s string) interface{} {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", ""))
	if s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return f
}

func textOrNil(s string) interface{} {
	if s = strings.TrimSpace(s); s == "" {
		return nil
	}
	return s
}
