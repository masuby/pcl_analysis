package handlers

// Running a refinance / reactivation report and handing back a zip.
//
// A run reads the currently active source file, the live roster, and the
// do-not-contact list, and writes one folder per product containing FULL,
// UNALLOCATED, By_Branch, By_Cluster and By_Zone workbooks.

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

var rrJob struct {
	mu      sync.Mutex
	running bool
	runID   uuid.UUID
}

type rrRunRequest struct {
	Mode     string   `json:"mode"`     // refinance | reactivation
	Products []string `json:"products"` // LBF, SME, Agrifinance, CS
	DateFrom string   `json:"dateFrom"` // reactivation only, dd/mm/yyyy or yyyy-mm-dd
	DateTo   string   `json:"dateTo"`
}

func normaliseProduct(s string) string {
	switch zoneKey(s) {
	case "LBF":
		return ProdLBF
	case "SME":
		return ProdSME
	case "AGRI", "AGRIFINANCE":
		return ProdAGRI
	case "CS":
		return ProdCS
	}
	return ""
}

func parseRunDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, f := range []string{"2006-01-02", "02/01/2006", "02-01-2006"} {
		if t, err := time.Parse(f, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// RunMambuRR — POST /api/mambu/rr/run
func RunMambuRR(c *gin.Context) {
	var req rrRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}

	mode := strings.ToUpper(strings.TrimSpace(req.Mode))
	if mode != "REFINANCE" && mode != "REACTIVATION" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "mode must be refinance or reactivation"})
		return
	}

	var products []string
	seen := map[string]bool{}
	for _, p := range req.Products {
		if code := normaliseProduct(p); code != "" && !seen[code] {
			seen[code] = true
			products = append(products, code)
		}
	}
	if len(products) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "Choose at least one product (LBF, SME, Agrifinance or CS)."})
		return
	}

	kind := "LOAN"
	if mode == "REACTIVATION" {
		kind = "CLIENTS"
	}
	srcID, srcPath, srcName, err := activeSource(kind)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": fmt.Sprintf("No %s file has been uploaded yet — upload one in Source files first.",
				mambuSourceKinds[kind].Label)})
		return
	}

	var from, to time.Time
	if mode == "REACTIVATION" {
		var ok1, ok2 bool
		from, ok1 = parseRunDate(req.DateFrom)
		to, ok2 = parseRunDate(req.DateTo)
		if !ok1 || !ok2 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false,
				"error": "Reactivation needs a From and To date (dd/mm/yyyy)."})
			return
		}
		if to.Before(from) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false,
				"error": "The To date must be on or after the From date."})
			return
		}
	}

	rrJob.mu.Lock()
	if rrJob.running {
		id := rrJob.runID
		rrJob.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false,
			"error": "A run is already in progress.", "runId": id})
		return
	}
	runID := uuid.New()
	rrJob.running, rrJob.runID = true, runID
	rrJob.mu.Unlock()

	var runBy interface{}
	if v, ok := c.Get("userID"); ok {
		runBy = v
	}

	var fromArg, toArg interface{}
	if mode == "REACTIVATION" {
		fromArg, toArg = from, to
	}
	var loanRef, clientRef interface{}
	if kind == "LOAN" {
		loanRef = srcID
	} else {
		clientRef = srcID
	}

	if _, err := database.DB.Exec(
		`INSERT INTO mambu_rr_runs (id, mode, products, date_from, date_to,
		        source_loan, source_clients, run_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		runID, mode, strings.Join(products, ","), fromArg, toArg,
		loanRef, clientRef, runBy); err != nil {
		rrJob.mu.Lock()
		rrJob.running = false
		rrJob.mu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	go runRRJob(runID, mode, products, srcPath, from, to)

	c.JSON(http.StatusOK, gin.H{
		"success": true, "runId": runID, "mode": mode, "products": products,
		"sourceFile": srcName,
		"message":    "Run started. The workbooks are built on the server; this takes a minute or two.",
	})
}

func runRRJob(runID uuid.UUID, mode string, products []string,
	srcPath string, from, to time.Time) {

	defer func() {
		rrJob.mu.Lock()
		rrJob.running = false
		rrJob.mu.Unlock()
	}()

	fail := func(err error) {
		database.DB.Exec(
			`UPDATE mambu_rr_runs SET status='FAILED', error=$2, finished_at=now() WHERE id=$1`,
			runID, err.Error())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	zc, err := LoadZoneClusters(ctx, true)
	if err != nil {
		fail(err)
		return
	}
	dnc, err := doNotContactSet()
	if err != nil {
		fail(fmt.Errorf("reading the do-not-contact list: %w", err))
		return
	}
	table, err := readSheetTable(srcPath)
	if err != nil {
		fail(err)
		return
	}

	in := rrRunInput{
		Mode: mode, Products: products, DateFrom: from, DateTo: to,
		Today: time.Now(), DNC: dnc, ZC: zc,
	}

	var out *rrRunOutput
	if mode == "REFINANCE" {
		out, err = buildRefinance(table, in)
	} else {
		out, err = buildReactivation(table, in)
	}
	if err != nil {
		fail(err)
		return
	}

	// Agrifinance has exactly one branch on the map and nobody on the roster,
	// so say so plainly rather than shipping workbooks with an empty
	// "Assigned To" column and letting somebody discover it later.
	for _, p := range out.Products {
		if p.Product == ProdAGRI && p.Rows > 0 && len(zc.PeopleForBranch(ProdAGRI, "Tukuyu")) == 0 {
			out.Warnings = append(out.Warnings,
				"Agrifinance: the roster has no Agrifinance people, so its rows could not be "+
					"assigned to anyone. Add them to the Zone and Clusters sheet (Product = Agrifinance) "+
					"and run again.")
		}
	}

	zipRel, zipSize, err := writeRunZip(runID, mode, out)
	if err != nil {
		fail(err)
		return
	}

	// Record every workbook and who it is addressed to, so Distribute later
	// sends exactly these files to exactly these people.
	if err := saveRunFiles(runID, out); err != nil {
		fail(fmt.Errorf("recording the run's files: %w", err))
		return
	}

	rowsOut, dncRemoved := 0, 0
	for _, p := range out.Products {
		rowsOut += p.Rows
		dncRemoved += p.DNCRemoved
	}
	stats, _ := json.Marshal(gin.H{"funnel": out.Funnel, "products": out.Products})

	if _, err := database.DB.Exec(
		`UPDATE mambu_rr_runs
		    SET status='DONE', rows_in=$2, rows_out=$3, dnc_removed=$4,
		        stats=$5, warnings=$6, zip_path=$7, zip_size=$8, finished_at=now()
		  WHERE id=$1`,
		runID, out.Funnel.Loaded, rowsOut, dncRemoved, stats,
		strings.Join(out.Warnings, "\n"), zipRel, zipSize); err != nil {
		fail(err)
	}
}

func writeRunZip(runID uuid.UUID, mode string, out *rrRunOutput) (string, int64, error) {
	dir := filepath.Join(mambuRoot(), "mambu", "runs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	name := fmt.Sprintf("%s_%s_%s.zip",
		titleWord(mode), time.Now().Format("2006-01-02"), runID.String()[:8])
	rel := filepath.Join("mambu", "runs", name)
	full := filepath.Join(mambuRoot(), rel)

	f, err := os.Create(full)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	for _, p := range out.Products {
		for _, file := range p.files {
			w, err := zw.Create(file.RelPath)
			if err != nil {
				zw.Close()
				return "", 0, err
			}
			if _, err := w.Write(file.Data); err != nil {
				zw.Close()
				return "", 0, err
			}
		}
	}

	// A README so somebody opening the zip in three months knows what the
	// filters were and why a name might be missing.
	if w, err := zw.Create("README.txt"); err == nil {
		w.Write([]byte(runReadme(mode, out)))
	}
	if err := zw.Close(); err != nil {
		return "", 0, err
	}

	info, _ := os.Stat(full)
	var size int64
	if info != nil {
		size = info.Size()
	}
	return rel, size, nil
}

func runReadme(mode string, out *rrRunOutput) string {
	var b strings.Builder
	// Go's reference date is 2006-01-02 15:04:05 — a literal year here would be
	// read as layout digits and print nonsense.
	fmt.Fprintf(&b, "%s run — %s\r\n\r\n", titleWord(mode),
		time.Now().Format("2 January 2006 15:04"))

	b.WriteString("How the list was narrowed down\r\n")
	fmt.Fprintf(&b, "  Rows in the export            %d\r\n", out.Funnel.Loaded)
	if out.Funnel.AfterDateFilter > 0 {
		fmt.Fprintf(&b, "  Within the chosen dates       %d\r\n", out.Funnel.AfterDateFilter)
	}
	fmt.Fprintf(&b, "  One row per person            %d\r\n", out.Funnel.AfterDedupe)
	fmt.Fprintf(&b, "  Under 64 years old            %d\r\n", out.Funnel.AfterAge)
	if out.Funnel.AfterTenure > 0 {
		fmt.Fprintf(&b, "  At least 30%% through the loan %d\r\n", out.Funnel.AfterTenure)
	}
	if out.Funnel.AfterCollection > 0 {
		fmt.Fprintf(&b, "  Not in Collections            %d\r\n", out.Funnel.AfterCollection)
	}

	b.WriteString("\r\nPer product\r\n")
	for _, p := range out.Products {
		fmt.Fprintf(&b, "  %-14s %d rows — %d allocated, %d unallocated, "+
			"%d removed as do-not-contact\r\n",
			p.Product, p.Rows, p.Allocated, p.Unallocated, p.DNCRemoved)
		fmt.Fprintf(&b, "  %-14s %d branch, %d cluster, %d zone workbooks\r\n",
			"", p.BranchFiles, p.ClusterFile, p.ZoneFiles)
	}

	b.WriteString("\r\nWhat is in each folder\r\n" +
		"  FULL          every row, each assigned within its own branch.\r\n" +
		"  UNALLOCATED   clients with no sales rep, assigned to the call centre.\r\n" +
		"                These are in FULL too, but excluded from the splits below\r\n" +
		"                so no branch is handed a client it does not own.\r\n" +
		"  By_Branch     one workbook per branch.\r\n" +
		"  By_Cluster    one per cluster, addressed to the cluster manager.\r\n" +
		"  By_Zone       one per zone, still assigned per-branch inside it.\r\n\r\n" +
		"Every workbook has Summary (who got what), Distribution (the rows with\r\n" +
		"an assignee) and Data (the plain rows). FULL also has Do_Not_Contact,\r\n" +
		"listing anyone removed because they asked not to be called.\r\n")

	if len(out.Warnings) > 0 {
		b.WriteString("\r\nWorth knowing\r\n")
		for _, w := range out.Warnings {
			fmt.Fprintf(&b, "  - %s\r\n", w)
		}
	}
	return b.String()
}

// GetMambuRRRun — GET /api/mambu/rr/runs/:id
func GetMambuRRRun(c *gin.Context) {
	id := c.Param("id")
	var (
		mode, products, status string
		errText, warnings      *string
		rowsIn, rowsOut, dncN  int
		zipPath                *string
		zipSize                *int64
		statsRaw               []byte
		started                time.Time
		finished               *time.Time
	)
	err := database.DB.QueryRow(
		`SELECT mode, products, status, error, warnings, rows_in, rows_out,
		        dnc_removed, zip_path, zip_size, stats, started_at, finished_at
		   FROM mambu_rr_runs WHERE id = $1`, id).
		Scan(&mode, &products, &status, &errText, &warnings, &rowsIn, &rowsOut,
			&dncN, &zipPath, &zipSize, &statsRaw, &started, &finished)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Run not found"})
		return
	}

	resp := gin.H{
		"success": true, "id": id, "mode": mode,
		"products": strings.Split(products, ","), "status": status,
		"rowsIn": rowsIn, "rowsOut": rowsOut, "dncRemoved": dncN,
		"startedAt": started,
	}
	if errText != nil {
		resp["error"] = *errText
	}
	if warnings != nil && *warnings != "" {
		resp["warnings"] = strings.Split(*warnings, "\n")
	}
	if finished != nil {
		resp["finishedAt"] = *finished
	}
	if zipSize != nil {
		resp["zipSize"] = *zipSize
	}
	if zipPath != nil && *zipPath != "" {
		resp["downloadUrl"] = "/api/mambu/rr/runs/" + id + "/download"
	}
	if len(statsRaw) > 0 {
		var s interface{}
		if json.Unmarshal(statsRaw, &s) == nil {
			resp["stats"] = s
		}
	}
	c.JSON(http.StatusOK, resp)
}

// ListMambuRRRuns — GET /api/mambu/rr/runs
func ListMambuRRRuns(c *gin.Context) {
	rows, err := database.DB.Query(
		`SELECT id, mode, products, status, rows_in, rows_out, dnc_removed,
		        COALESCE(zip_size,0), started_at, finished_at
		   FROM mambu_rr_runs ORDER BY started_at DESC LIMIT 25`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var id uuid.UUID
		var mode, products, status string
		var in, outN, dncN int
		var zipSize int64
		var started time.Time
		var finished *time.Time
		if err := rows.Scan(&id, &mode, &products, &status, &in, &outN, &dncN,
			&zipSize, &started, &finished); err != nil {
			continue
		}
		item := gin.H{
			"id": id, "mode": mode, "products": strings.Split(products, ","),
			"status": status, "rowsIn": in, "rowsOut": outN, "dncRemoved": dncN,
			"zipSize": zipSize, "startedAt": started,
		}
		if finished != nil {
			item["finishedAt"] = *finished
		}
		if status == "DONE" && zipSize > 0 {
			item["downloadUrl"] = "/api/mambu/rr/runs/" + id.String() + "/download"
		}
		out = append(out, item)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "runs": out})
}

// DownloadMambuRRRun — GET /api/mambu/rr/runs/:id/download
func DownloadMambuRRRun(c *gin.Context) {
	id := c.Param("id")
	var rel, mode string
	var started time.Time
	if err := database.DB.QueryRow(
		`SELECT COALESCE(zip_path,''), mode, started_at FROM mambu_rr_runs WHERE id=$1`, id).
		Scan(&rel, &mode, &started); err != nil || rel == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "No file for that run"})
		return
	}
	full := filepath.Join(mambuRoot(), rel)
	if _, err := os.Stat(full); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false,
			"error": "The file for that run is no longer on the server"})
		return
	}
	name := fmt.Sprintf("%s_%s.zip",
		titleWord(mode), started.Format("2006-01-02"))
	c.FileAttachment(full, name)
}

// titleWord renders REFINANCE as "Refinance" for file names and headings.
// strings.Title is deprecated, and this only ever sees a single ASCII word.
func titleWord(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// saveRunFiles stores one row per built workbook, with the recipients resolved
// at build time.
func saveRunFiles(runID uuid.UUID, out *rrRunOutput) error {
	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO mambu_rr_files
		   (id, run_id, product, scope, name, cluster, rel_path, rows, emails, names)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, p := range out.Products {
		for _, f := range p.files {
			if _, err := stmt.Exec(uuid.New(), runID, p.Product, f.Scope, f.Name,
				f.Cluster, f.RelPath, f.Rows,
				strings.Join(f.Emails, ","), strings.Join(f.Names, ",")); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
