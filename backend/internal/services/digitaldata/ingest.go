package digitaldata

// Ingest: read the three lead workbooks via the Sheets API, clean every tab,
// and land the result in digital_leads. Re-running is safe — rows are keyed by
// a content hash, so an unchanged source row is silently skipped.

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/pcl/pcl-api/internal/database"
	"google.golang.org/api/option"
	sheets "google.golang.org/api/sheets/v4"
)

// Default workbook IDs — the same operational books the Social Media handler
// reads. Overridable by env so staging can point elsewhere.
const (
	defaultLBFSheetID   = "1n2U_Tt-7fC3hRRIfFHrcyTT9HkN408C_YN4jUbPFeZE"
	defaultCSSheetID    = "14bZuq-NLlIp7HToHCrhn7HA3eQQtjRsKt0z1Nbzy1bI"
	defaultSMESheetID   = "1uso8FojypIHlqt0FkO44w_4Rckhr6bLc8yk-EJUXmk8"
	defaultZoneSheetID  = "1piZirOD9Jw3UBYty-zz7jdwD22tIikrPtGtt1gVhEtw"
	maxTabColumnsRange  = "A1:AZ"
	insertBatchSize     = 500
	sheetsReadRowsLimit = 40000
)

func sha256sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

type book struct {
	Label   string // LBF | CS | SME
	SheetID string
}

func books() []book {
	return []book{
		{"LBF", envOr("DIGITAL_LBF_SHEET_ID", defaultLBFSheetID)},
		{"CS", envOr("DIGITAL_CS_SHEET_ID", defaultCSSheetID)},
		{"SME", envOr("DIGITAL_SME_SHEET_ID", defaultSMESheetID)},
	}
}

// NewSheetsService builds a read-only Sheets client from the service account.
func NewSheetsService(ctx context.Context) (*sheets.Service, error) {
	credPath := envOr("SHEETS_CREDENTIALS_PATH", "./credentials/sheets-service-account.json")
	return sheets.NewService(ctx, option.WithCredentialsFile(credPath))
}

// cellString renders a Sheets cell as text. Values arrive UNFORMATTED, so
// numbers are float64 — formatted without an exponent so a phone number stays
// "255766000788" rather than "2.55766000788e+11".
func cellString(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(t)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func toStringRows(vals [][]interface{}) [][]string {
	out := make([][]string, 0, len(vals))
	for _, r := range vals {
		row := make([]string, len(r))
		for i, c := range r {
			row[i] = cellString(c)
		}
		out = append(out, row)
	}
	return out
}

// TabResult is the per-tab audit entry stored on the run.
type TabResult struct {
	Book       string `json:"book"`
	Tab        string `json:"tab"`
	Kind       string `json:"kind"`
	HeaderRow  int    `json:"headerRow"`
	Headerless bool   `json:"headerless"`
	FromHeader int    `json:"fromHeader"`
	FromData   int    `json:"fromData"`
	Rows       int    `json:"rows"`
	Inserted   int    `json:"inserted"`
	Skipped    int    `json:"skipped"`
	Note       string `json:"note,omitempty"`
}

// RunSummary is what the ingest endpoint returns.
type RunSummary struct {
	RunID        string      `json:"runId"`
	Status       string      `json:"status"`
	BooksScanned int         `json:"booksScanned"`
	TabsScanned  int         `json:"tabsScanned"`
	TabsIngested int         `json:"tabsIngested"`
	RowsRead     int         `json:"rowsRead"`
	RowsInserted int         `json:"rowsInserted"`
	RowsSkipped  int         `json:"rowsSkipped"`
	Tabs         []TabResult `json:"tabs"`
	Error        string      `json:"error,omitempty"`
}

// Ingest reads every workbook, cleans every lead-bearing tab and writes the
// results. includePayroll controls whether the CS book's payroll/portfolio
// campaign tabs (BUY OFF, REACTIVATION, NEW HIRE, ...) are ingested too; they
// are real data but they are not inbound digital leads.
func Ingest(ctx context.Context, triggeredBy *string, includePayroll bool, dayFirst bool) (*RunSummary, error) {
	svc, err := NewSheetsService(ctx)
	if err != nil {
		return nil, fmt.Errorf("sheets client: %w", err)
	}

	var runID string
	err = database.DB.QueryRowContext(ctx,
		`INSERT INTO digital_ingest_runs (triggered_by) VALUES ($1) RETURNING id`,
		nullableUUID(triggeredBy),
	).Scan(&runID)
	if err != nil {
		return nil, fmt.Errorf("create run: %w", err)
	}

	sum := &RunSummary{RunID: runID, Status: "SUCCESS", Tabs: []TabResult{}}

	for _, b := range books() {
		meta, err := svc.Spreadsheets.Get(b.SheetID).Fields("sheets.properties.title").Context(ctx).Do()
		if err != nil {
			sum.Tabs = append(sum.Tabs, TabResult{Book: b.Label, Note: "cannot open workbook: " + err.Error()})
			continue
		}
		sum.BooksScanned++

		titles := make([]string, 0, len(meta.Sheets))
		ranges := make([]string, 0, len(meta.Sheets))
		for _, sh := range meta.Sheets {
			if sh.Properties == nil {
				continue
			}
			titles = append(titles, sh.Properties.Title)
			ranges = append(ranges, fmt.Sprintf("'%s'!%s", sh.Properties.Title, maxTabColumnsRange))
		}
		if len(ranges) == 0 {
			continue
		}

		resp, err := svc.Spreadsheets.Values.BatchGet(b.SheetID).
			Ranges(ranges...).ValueRenderOption("UNFORMATTED_VALUE").Context(ctx).Do()
		if err != nil {
			sum.Tabs = append(sum.Tabs, TabResult{Book: b.Label, Note: "batch read failed: " + err.Error()})
			continue
		}

		for i, vr := range resp.ValueRanges {
			if i >= len(titles) {
				break
			}
			tab := titles[i]
			sum.TabsScanned++

			rows := toStringRows(vr.Values)
			kind := ClassifyTab(tab, len(rows)-1)

			tr := TabResult{Book: b.Label, Tab: tab, Kind: kind, Rows: max(0, len(rows)-1)}

			if kind == KindEmpty || kind == KindReference || kind == KindReport {
				tr.Note = "skipped — not a lead tab"
				sum.Tabs = append(sum.Tabs, tr)
				continue
			}
			if kind == KindPayroll && !includePayroll {
				tr.Note = "skipped — payroll campaign tab (includePayroll=false)"
				sum.Tabs = append(sum.Tabs, tr)
				continue
			}
			if len(rows) == 0 {
				tr.Note = "no rows"
				sum.Tabs = append(sum.Tabs, tr)
				continue
			}

			cm := BuildColumnMap(rows)
			tr.HeaderRow, tr.Headerless = cm.HeaderRow, cm.Headerless
			tr.FromHeader, tr.FromData = cm.FromHeader, cm.FromData

			// A tab with no locatable phone column is still ingested: those rows
			// carry real dispositions and comments, they just never had a number
			// entered (LBF's OCTOBER SHEET and JAN 2026 are entirely like this).
			// Every row lands flagged NO_PHONE so the loss is visible in the
			// Data Quality view instead of vanishing behind a "skipped" note.
			if !cm.Has(FPhone) {
				tr.Note = "no phone column in source — rows kept and flagged NO_PHONE"
			}

			opt := CleanOpts{Book: b.Label, Tab: tab, TabKind: kind, DayFirst: dayFirst}
			start := cm.HeaderRow + 1
			batch := make([]CleanRow, 0, insertBatchSize)

			for r := start; r < len(rows) && r < sheetsReadRowsLimit; r++ {
				sum.RowsRead++
				cr, keep := CleanRowFrom(rows[r], cm, r+1, opt)
				if !keep {
					tr.Skipped++
					sum.RowsSkipped++
					continue
				}
				batch = append(batch, cr)
				if len(batch) >= insertBatchSize {
					n, err := insertLeads(ctx, batch, runID)
					if err != nil {
						return failRun(ctx, sum, runID, err)
					}
					tr.Inserted += n
					sum.RowsInserted += n
					batch = batch[:0]
				}
			}
			if len(batch) > 0 {
				n, err := insertLeads(ctx, batch, runID)
				if err != nil {
					return failRun(ctx, sum, runID, err)
				}
				tr.Inserted += n
				sum.RowsInserted += n
			}

			sum.TabsIngested++
			sum.Tabs = append(sum.Tabs, tr)
		}
	}

	if err := markPrimaries(ctx); err != nil {
		return failRun(ctx, sum, runID, err)
	}

	tabsJSON, _ := json.Marshal(sum.Tabs)
	_, _ = database.DB.ExecContext(ctx, `
		UPDATE digital_ingest_runs
		   SET finished_at = NOW(), status = 'SUCCESS',
		       books_scanned = $2, tabs_scanned = $3, tabs_ingested = $4,
		       rows_read = $5, rows_inserted = $6, rows_skipped = $7, tab_report = $8
		 WHERE id = $1`,
		runID, sum.BooksScanned, sum.TabsScanned, sum.TabsIngested,
		sum.RowsRead, sum.RowsInserted, sum.RowsSkipped, string(tabsJSON))

	return sum, nil
}

func failRun(ctx context.Context, sum *RunSummary, runID string, cause error) (*RunSummary, error) {
	tabsJSON, _ := json.Marshal(sum.Tabs)
	_, _ = database.DB.ExecContext(ctx, `
		UPDATE digital_ingest_runs
		   SET finished_at = NOW(), status = 'FAILED', error = $2, tab_report = $3
		 WHERE id = $1`, runID, cause.Error(), string(tabsJSON))
	sum.Status = "FAILED"
	sum.Error = cause.Error()
	return sum, cause
}

// insertLeads writes a batch with a single multi-row INSERT. Duplicate
// row_hash (an unchanged source row from a previous run) is ignored.
func insertLeads(ctx context.Context, rows []CleanRow, runID string) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}
	const cols = 24
	ph := make([]string, 0, len(rows))
	args := make([]interface{}, 0, len(rows)*cols)

	for i, r := range rows {
		b := i * cols
		ph = append(ph, fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			b+1, b+2, b+3, b+4, b+5, b+6, b+7, b+8, b+9, b+10, b+11, b+12,
			b+13, b+14, b+15, b+16, b+17, b+18, b+19, b+20, b+21, b+22, b+23, b+24))

		issues, _ := json.Marshal(r.Issues)
		args = append(args,
			r.Product, r.Platform, r.TabKind,
			nullStr(r.Name), nullStr(r.CheckNo), nullTime(r.Date), nullStr(r.Month),
			nullStr(r.AssignedTo), nullStr(r.PhoneE164), nullStr(r.PhoneRaw), r.PhoneValid,
			nullStr(r.StatusRaw), r.StatusCanon, nullStr(r.Comment),
			r.IsConverted, nullFloat(r.Amount), nullStr(r.ClientType), nullStr(r.Region),
			r.SourceBook, r.SourceTab, r.SourceRow, r.RowHash, string(issues), runID)
	}

	q := `INSERT INTO digital_leads
	  (product, platform, tab_kind, lead_name, check_no, lead_date, lead_month,
	   assigned_to, phone_e164, phone_raw, phone_valid, status_raw, status_canonical,
	   comment, is_converted, loan_amount, client_type, region,
	   source_book, source_tab, source_row, row_hash, issues, ingest_run_id)
	  VALUES ` + strings.Join(ph, ",") + `
	  ON CONFLICT (row_hash) DO NOTHING`

	res, err := database.DB.ExecContext(ctx, q, args...)
	if err != nil {
		return 0, fmt.Errorf("insert leads: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// markPrimaries flags the earliest record for each phone number as the primary
// lead. The rest are repeat touches — this is the 23% duplication in the LBF
// book, kept as history rather than deleted.
func markPrimaries(ctx context.Context) error {
	_, err := database.DB.ExecContext(ctx, `
		WITH ranked AS (
		  SELECT id,
		         ROW_NUMBER() OVER (
		           PARTITION BY phone_e164
		           ORDER BY lead_date NULLS LAST, created_at, source_row
		         ) AS rn
		    FROM digital_leads
		   WHERE phone_e164 IS NOT NULL AND phone_e164 <> ''
		)
		UPDATE digital_leads d
		   SET is_primary = (r.rn = 1)
		  FROM ranked r
		 WHERE d.id = r.id AND d.is_primary <> (r.rn = 1)`)
	return err
}

// ------------------------------------------------------------- directory sync

// SyncDirectory pulls the Zone and Clusters workbook into digital_directory.
// Every tab except the Zone/Branch/Cluster mapping tab is a people list with
// Zone | Branch | Name | Role | Phone | Email | Cluster | Product.
func SyncDirectory(ctx context.Context) (int, error) {
	svc, err := NewSheetsService(ctx)
	if err != nil {
		return 0, fmt.Errorf("sheets client: %w", err)
	}
	id := envOr("ZONE_AND_CLUSTERS_SHEET_ID", defaultZoneSheetID)

	meta, err := svc.Spreadsheets.Get(id).Fields("sheets.properties.title").Context(ctx).Do()
	if err != nil {
		return 0, fmt.Errorf("open zone workbook: %w", err)
	}

	titles := make([]string, 0, len(meta.Sheets))
	ranges := make([]string, 0, len(meta.Sheets))
	for _, sh := range meta.Sheets {
		if sh.Properties == nil {
			continue
		}
		t := sh.Properties.Title
		if normKey(t) == "zoneandcluster" { // the branch->cluster map, not people
			continue
		}
		titles = append(titles, t)
		ranges = append(ranges, fmt.Sprintf("'%s'!A1:J2000", t))
	}
	if len(ranges) == 0 {
		return 0, nil
	}

	resp, err := svc.Spreadsheets.Values.BatchGet(id).Ranges(ranges...).Context(ctx).Do()
	if err != nil {
		return 0, fmt.Errorf("read zone workbook: %w", err)
	}

	// Everything currently held is deactivated, then re-activated by the upsert,
	// so people removed from the workbook stop receiving leads.
	if _, err := database.DB.ExecContext(ctx, `UPDATE digital_directory SET is_active = false`); err != nil {
		return 0, err
	}

	total := 0
	for i, vr := range resp.ValueRanges {
		if i >= len(titles) {
			break
		}
		tab := titles[i]
		rows := toStringRows(vr.Values)
		if len(rows) < 2 {
			continue
		}

		idx := map[string]int{}
		for c, h := range rows[0] {
			switch normKey(h) {
			case "zone":
				idx["zone"] = c
			// The CRM tab names the branch column "Tenant"; every other tab
			// calls it "Branch". Both mean the same thing for routing.
			case "branch", "tenant":
				idx["branch"] = c
			case "name", "fullname", "names":
				idx["name"] = c
			case "role", "title", "position":
				idx["role"] = c
			case "phone", "phoneno", "mobile", "simu":
				idx["phone"] = c
			case "email", "emailaddress":
				idx["email"] = c
			case "cluster":
				idx["cluster"] = c
			case "product":
				idx["product"] = c
			}
		}
		if _, ok := idx["name"]; !ok {
			continue
		}

		get := func(row []string, k string) string {
			c, ok := idx[k]
			if !ok || c >= len(row) {
				return ""
			}
			return strings.TrimSpace(row[c])
		}

		product, channel := directoryTabMeta(tab)

		for _, row := range rows[1:] {
			name := get(row, "name")
			if name == "" {
				continue
			}
			p := get(row, "product")
			if p == "" {
				p = product
			} else {
				p = CanonicalProduct(p, product)
			}
			phone, _ := NormalizePhone(get(row, "phone"))

			_, err := database.DB.ExecContext(ctx, `
				INSERT INTO digital_directory
				  (zone, branch, full_name, role, phone, email, cluster, product, channel, source_tab, is_active, synced_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW())
				ON CONFLICT (source_tab, lower(full_name), COALESCE(lower(email),''), COALESCE(lower(branch),''))
				DO UPDATE SET zone = EXCLUDED.zone, role = EXCLUDED.role,
				              phone = EXCLUDED.phone, cluster = EXCLUDED.cluster,
				              product = EXCLUDED.product, channel = EXCLUDED.channel,
				              is_active = true, synced_at = NOW()`,
				nullStr(get(row, "zone")), nullStr(get(row, "branch")), name,
				nullStr(get(row, "role")), nullStr(phone), nullStr(get(row, "email")),
				nullStr(get(row, "cluster")), nullStr(p), channel, tab)
			if err != nil {
				return total, fmt.Errorf("upsert %s/%s: %w", tab, name, err)
			}
			total++
		}
	}
	return total, nil
}

// directoryTabMeta derives the product and the call-centre/branch channel from
// a Zone & Clusters tab name (CS_CC, LBF_Branches, SME, CRM, ...).
func directoryTabMeta(tab string) (product, channel string) {
	t := normKey(tab)

	// The CRM tab is the roster of CRM system users (936 of them). It is the
	// lookup that answers "which branch and product does this Created_By belong
	// to". Its rows carry their own Product per person, and they must NOT be
	// offered as DIGITAL DATA assignees — that rule picks channel 'CC' and SME
	// branch managers — so they get a channel of their own.
	if t == "crm" {
		return "", "CRM"
	}

	switch {
	case strings.HasPrefix(t, "cs"):
		product = "CS"
	case strings.HasPrefix(t, "lbf"):
		product = "LBF"
	case strings.HasPrefix(t, "sme"):
		product = "SME"
	}
	if strings.Contains(t, "cc") {
		channel = "CC"
	} else {
		channel = "BRANCH"
	}
	return product, channel
}

// ------------------------------------------------------------------- helpers

func nullStr(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullTime(t *time.Time) interface{} {
	if t == nil {
		return nil
	}
	return *t
}

func nullFloat(f *float64) interface{} {
	if f == nil {
		return nil
	}
	return *f
}

func nullableUUID(s *string) interface{} {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	return *s
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

var _ = sql.ErrNoRows
