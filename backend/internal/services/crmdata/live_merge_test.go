//go:build livecrm

package crmdata

// Live merge test against the real Lead_Report and a real Postgres.
//   go test -tags livecrm -run TestLiveCRMMerge -v ./internal/services/crmdata/

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/pcl/pcl-api/internal/database"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"))
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	database.DB = db
	return db
}

func newUpload(t *testing.T, db *sql.DB, name string) string {
	t.Helper()
	var id string
	if err := db.QueryRow(
		`INSERT INTO crm_uploads (file_name) VALUES ($1) RETURNING id`, name).Scan(&id); err != nil {
		t.Fatalf("create upload: %v", err)
	}
	return id
}

func TestLiveCRMMerge(t *testing.T) {
	db := openDB(t)
	defer db.Close()
	ctx := context.Background()

	path := os.Getenv("CRM_FILE")
	if path == "" {
		t.Skip("CRM_FILE not set")
	}

	start := time.Now()
	rows, skipped, err := ParseWorkbook(path)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	t.Logf("parsed %d rows (%d skipped, no phone) in %s",
		len(rows), skipped, time.Since(start).Round(time.Millisecond))

	valid := 0
	for _, r := range rows {
		if r.PhoneValid {
			valid++
		}
	}
	t.Logf("valid TZ mobiles: %d/%d (%.0f%%)", valid, len(rows), float64(valid)/float64(len(rows))*100)

	// ---- first merge: everything is new -------------------------------------
	r1, err := Merge(ctx, newUpload(t, db, "first.xlsx"), rows, skipped)
	if err != nil {
		t.Fatalf("merge 1: %v", err)
	}
	t.Logf("MERGE 1  inserted=%d updated=%d skipped=%d bad=%d total=%d",
		r1.Inserted, r1.Updated, r1.Skipped, r1.BadPhones, r1.Total)
	if r1.Updated != 0 {
		t.Errorf("first merge into an empty store should update nothing, got %d", r1.Updated)
	}

	// ---- second merge of the SAME file: everything updates, nothing appends --
	r2, err := Merge(ctx, newUpload(t, db, "again.xlsx"), rows, skipped)
	if err != nil {
		t.Fatalf("merge 2: %v", err)
	}
	t.Logf("MERGE 2  inserted=%d updated=%d total=%d", r2.Inserted, r2.Updated, r2.Total)
	if r2.Inserted != 0 {
		t.Errorf("re-uploading the same file must not append: inserted=%d", r2.Inserted)
	}
	if r2.Total != r1.Total {
		t.Errorf("store grew on re-upload: %d -> %d", r1.Total, r2.Total)
	}

	// ---- third merge: one changed row + one brand-new client -----------------
	mod := make([]Row, 2)
	mod[0] = rows[0]
	mod[0].Status = "Converted"
	mod[0].Comment = "updated by test"
	mod[1] = rows[0]
	mod[1].PhoneNorm = "255700000001"
	mod[1].PhoneValid = true
	mod[1].Name = "Brand New Client"

	r3, err := Merge(ctx, newUpload(t, db, "delta.xlsx"), mod, 0)
	if err != nil {
		t.Fatalf("merge 3: %v", err)
	}
	t.Logf("MERGE 3  inserted=%d updated=%d total=%d", r3.Inserted, r3.Updated, r3.Total)
	if r3.Inserted != 1 || r3.Updated != 1 {
		t.Errorf("expected 1 append + 1 update, got inserted=%d updated=%d", r3.Inserted, r3.Updated)
	}

	var status, comment string
	var updateCount int
	if err := db.QueryRow(
		`SELECT status, COALESCE(comment,''), update_count FROM crm_leads WHERE phone_norm=$1`,
		rows[0].PhoneNorm).Scan(&status, &comment, &updateCount); err != nil {
		t.Fatalf("verify update: %v", err)
	}
	t.Logf("updated row: status=%q comment=%q update_count=%d", status, comment, updateCount)
	if status != "Converted" || comment != "updated by test" {
		t.Errorf("row was not updated in place")
	}

	// ---- blank values must not erase what we already hold --------------------
	blank := []Row{rows[0]}
	blank[0].Comment = ""
	blank[0].Branch = ""
	if _, err := Merge(ctx, newUpload(t, db, "blanks.xlsx"), blank, 0); err != nil {
		t.Fatalf("merge 4: %v", err)
	}
	var keptComment, keptBranch string
	_ = db.QueryRow(`SELECT COALESCE(comment,''), COALESCE(branch,'') FROM crm_leads WHERE phone_norm=$1`,
		rows[0].PhoneNorm).Scan(&keptComment, &keptBranch)
	t.Logf("after blank upload: comment=%q branch=%q", keptComment, keptBranch)
	if keptComment == "" || keptBranch == "" {
		t.Errorf("a blank cell erased data that was already held")
	}

	// ---- routing coverage ----------------------------------------------------
	var routable, unroutable, noBranch int
	_ = db.QueryRow(`
		SELECT COUNT(*) FILTER (WHERE branch_key <> '' AND EXISTS (
		         SELECT 1 FROM digital_directory dd
		          WHERE dd.is_active AND lower(dd.role) LIKE '%team leader%'
		            AND crm_branch_key(dd.branch) = crm_leads.branch_key
		            AND (crm_leads.product_hint = '' OR dd.product = crm_leads.product_hint))),
		       COUNT(*) FILTER (WHERE branch_key <> '' AND NOT EXISTS (
		         SELECT 1 FROM digital_directory dd
		          WHERE dd.is_active AND lower(dd.role) LIKE '%team leader%'
		            AND crm_branch_key(dd.branch) = crm_leads.branch_key
		            AND (crm_leads.product_hint = '' OR dd.product = crm_leads.product_hint))),
		       COUNT(*) FILTER (WHERE branch_key = '')
		  FROM crm_leads`).Scan(&routable, &unroutable, &noBranch)
	t.Logf("ROUTING  to a TL=%d   branch but no TL=%d   no branch=%d", routable, unroutable, noBranch)
}
