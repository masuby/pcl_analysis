//go:build liveingest

package digitaldata

// Live end-to-end ingest against the real workbooks and a real Postgres.
// Excluded from normal builds by the `liveingest` tag; run with:
//
//	go test -tags liveingest -run TestLiveIngest -v ./internal/services/digitaldata/
//
// Requires DB_* env vars and a readable service-account credentials file.

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/pcl/pcl-api/internal/database"
)

func TestLiveIngest(t *testing.T) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), envOr("DB_SSLMODE", "disable"))

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Fatalf("ping db: %v", err)
	}
	database.DB = db

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	start := time.Now()
	sum, err := Ingest(ctx, nil, false, true)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}

	t.Logf("=== INGEST %s in %s ===", sum.Status, time.Since(start).Round(time.Second))
	t.Logf("books=%d tabs scanned=%d ingested=%d", sum.BooksScanned, sum.TabsScanned, sum.TabsIngested)
	t.Logf("rows read=%d inserted=%d skipped(blank)=%d", sum.RowsRead, sum.RowsInserted, sum.RowsSkipped)

	t.Log("")
	t.Logf("%-4s %-22s %-16s %6s %8s %8s  %s", "BOOK", "TAB", "KIND", "ROWS", "INSERTED", "HDR/DATA", "NOTE")
	sort.SliceStable(sum.Tabs, func(i, j int) bool { return sum.Tabs[i].Book < sum.Tabs[j].Book })
	for _, tr := range sum.Tabs {
		hdr := fmt.Sprintf("%d/%d", tr.FromHeader, tr.FromData)
		if tr.Headerless {
			hdr = "NONE/" + fmt.Sprint(tr.FromData)
		}
		tab := tr.Tab
		if len(tab) > 22 {
			tab = tab[:22]
		}
		t.Logf("%-4s %-22s %-16s %6d %8d %8s  %s", tr.Book, tab, tr.Kind, tr.Rows, tr.Inserted, hdr, tr.Note)
	}

	// ------------------------------------------------------------- verify
	report := func(label, query string) {
		rows, err := db.Query(query)
		if err != nil {
			t.Errorf("%s: %v", label, err)
			return
		}
		defer rows.Close()
		t.Logf("--- %s ---", label)
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]interface{}, len(cols))
			ptrs := make([]interface{}, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if rows.Scan(ptrs...) != nil {
				continue
			}
			line := ""
			for i, c := range cols {
				line += fmt.Sprintf("%s=%v  ", c, deref(vals[i]))
			}
			t.Log("   " + line)
		}
	}

	report("totals", `
		SELECT COUNT(*) AS rows,
		       COUNT(DISTINCT phone_e164) FILTER (WHERE phone_e164 <> '') AS unique_phones,
		       COUNT(*) FILTER (WHERE phone_valid) AS valid_phones,
		       COUNT(*) FILTER (WHERE lead_date IS NOT NULL) AS with_date,
		       COUNT(*) FILTER (WHERE jsonb_array_length(issues) = 0) AS clean
		  FROM digital_leads`)

	report("by product", `SELECT product, COUNT(*) FROM digital_leads GROUP BY 1 ORDER BY 2 DESC`)
	report("by platform", `SELECT platform, COUNT(*) FROM digital_leads GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)
	report("by status", `SELECT status_canonical, COUNT(*) FROM digital_leads GROUP BY 1 ORDER BY 2 DESC`)
	report("issues", `
		SELECT code, COUNT(*) FROM digital_leads,
		       LATERAL jsonb_array_elements_text(issues) code
		 GROUP BY 1 ORDER BY 2 DESC`)
	report("months (top 12)", `
		SELECT lead_month, COUNT(*) FROM digital_leads
		 WHERE lead_month IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 12`)
	report("sample cleaned rows", `
		SELECT lead_date, lead_name, phone_e164, product, platform, status_canonical
		  FROM digital_leads
		 WHERE jsonb_array_length(issues) = 0
		 ORDER BY random() LIMIT 8`)

	// Re-running must be a no-op: same rows, nothing new inserted.
	sum2, err := Ingest(ctx, nil, false, true)
	if err != nil {
		t.Fatalf("second ingest: %v", err)
	}
	t.Logf("=== RE-INGEST: inserted=%d (must be 0 for idempotency) ===", sum2.RowsInserted)
	if sum2.RowsInserted != 0 {
		t.Errorf("re-ingest inserted %d rows, want 0", sum2.RowsInserted)
	}
}

func deref(v interface{}) interface{} {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return v
}

func TestLiveDirectorySync(t *testing.T) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), envOr("DB_SSLMODE", "disable"))
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()
	database.DB = db

	n, err := SyncDirectory(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	t.Logf("=== DIRECTORY: %d people ===", n)

	rows, err := db.Query(`
		SELECT source_tab, product, channel, COUNT(*)
		  FROM digital_directory WHERE is_active
		 GROUP BY 1,2,3 ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var tab, product, channel string
		var c int
		if rows.Scan(&tab, &product, &channel, &c) == nil {
			t.Logf("   %-16s product=%-4s channel=%-7s people=%d", tab, product, channel, c)
		}
	}

	roleRows, err := db.Query(`
		SELECT role, COUNT(*) FROM digital_directory WHERE is_active
		 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`)
	if err != nil {
		t.Fatal(err)
	}
	defer roleRows.Close()
	t.Log("--- roles ---")
	for roleRows.Next() {
		var role string
		var c int
		if roleRows.Scan(&role, &c) == nil {
			t.Logf("   %-32s %d", role, c)
		}
	}
}
