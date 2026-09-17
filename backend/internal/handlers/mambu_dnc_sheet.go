package handlers

// The do-not-contact list, mirrored into the Zone and Clusters workbook.
//
// There are two ways to put a number on the list and both have to work:
//
//	the web      somebody takes a complaint and types the number into the app
//	the sheet    somebody opens the DO_NOT_CONTACT tab and types it there
//
// So the tab is both an output and an input. Every add or delete in the app
// rewrites the tab, and every read of the list first pulls in anything the tab
// has that the database does not.
//
// Deliberately asymmetric: the sheet can ADD but never REMOVE. A row deleted
// from a spreadsheet is indistinguishable from a row nobody has typed yet, and
// a cleared tab must not silently empty a list whose whole job is to stop
// people being called. Removing a number is done in the app, which then
// rewrites the tab without it.
//
// Sheets being unreachable must never break a distribution run or an add: every
// call here is best-effort, and the database remains the thing that decides.

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pcl/pcl-api/internal/database"
	"google.golang.org/api/sheets/v4"
)

const (
	dncSheetTab    = "DO_NOT_CONTACT"
	dncSheetHeader = "Phone"
	dncSyncTTL     = 60 * time.Second
	dncSheetRange  = "'" + dncSheetTab + "'!A1:D5000"
)

// dncRow is one number as the sheet holds it.
type dncRow struct {
	Phone   string // normalised, 255XXXXXXXXX
	Reason  string
	AddedOn string
	Source  string
}

var (
	dncSyncMu   sync.Mutex
	dncSyncedAt time.Time
)

// readDNCSheet returns the numbers on the tab, keyed by normalised phone.
//
// Rows whose phone cannot be read as a Tanzanian mobile are skipped and
// counted: somebody typing "0712 317" into a spreadsheet should not stop the
// other 200 rows loading, but it must not pass silently either.
func readDNCSheet(ctx context.Context, svc *sheets.Service, id string) (map[string]dncRow, []dncRow, error) {
	resp, err := svc.Spreadsheets.Values.Get(id, dncSheetRange).Context(ctx).Do()
	if err != nil {
		return nil, nil, err
	}
	out := map[string]dncRow{}
	bad := []dncRow{}
	for i, row := range resp.Values {
		cell := func(n int) string {
			if n < len(row) {
				return strings.TrimSpace(fmt.Sprint(row[n]))
			}
			return ""
		}
		raw := cell(0)
		if raw == "" {
			continue
		}
		// Skip the header wherever it sits, so a re-run that finds the tab
		// already written does not try to store the word "Phone".
		if i == 0 && strings.EqualFold(raw, dncSheetHeader) {
			continue
		}
		phone, ok := NormaliseTZPhone(raw)
		if !ok {
			// Kept, not dropped. The rewrite below would otherwise delete what
			// somebody typed and leave them no way to know it never took.
			bad = append(bad, dncRow{Phone: raw, Reason: cell(1)})
			continue
		}
		out[phone] = dncRow{
			Phone:   phone,
			Reason:  cell(1),
			AddedOn: cell(2),
			Source:  cell(3),
		}
	}
	return out, bad, nil
}

// writeDNCSheet rewrites the tab from the database: header, then one row per
// number, newest first. A full rewrite rather than an append, so the tab ends
// up canonical - normalised, deduplicated, and without anything the app has
// since removed.
func writeDNCSheet(ctx context.Context, svc *sheets.Service, id string, rows []dncRow) error {
	values := [][]interface{}{{dncSheetHeader, "Reason", "Added on", "Added via"}}
	for _, r := range rows {
		values = append(values, []interface{}{r.Phone, r.Reason, r.AddedOn, r.Source})
	}
	// Clear first: without it, shrinking the list leaves the old tail behind,
	// and those stale numbers would be read straight back in on the next sync.
	if _, err := svc.Spreadsheets.Values.Clear(id, dncSheetRange,
		&sheets.ClearValuesRequest{}).Context(ctx).Do(); err != nil {
		return err
	}
	_, err := svc.Spreadsheets.Values.Update(id, "'"+dncSheetTab+"'!A1",
		&sheets.ValueRange{Values: values}).
		ValueInputOption("RAW").Context(ctx).Do()
	return err
}

// dbDNCRows reads the list out of the database in the shape the sheet wants.
func dbDNCRows() ([]dncRow, error) {
	rows, err := database.DB.Query(
		`SELECT phone, COALESCE(reason,''), to_char(created_at, 'YYYY-MM-DD'),
		        COALESCE(source, 'Web')
		   FROM mambu_do_not_contact ORDER BY created_at DESC, phone`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []dncRow{}
	for rows.Next() {
		var r dncRow
		if err := rows.Scan(&r.Phone, &r.Reason, &r.AddedOn, &r.Source); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SyncDoNotContact reconciles the sheet and the database.
//
//	imported  numbers the sheet had and the database did not
//	written   numbers now on the tab
//
// Additive in one direction only - see the note at the top of this file.
func SyncDoNotContact(ctx context.Context) (imported, written, skipped int, err error) {
	id := zoneSheetID()
	if id == "" {
		return 0, 0, 0, fmt.Errorf("ZONE_CLUSTERS_SHEET_ID is not set")
	}
	svc, err := newSheetsService(ctx)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("google sheets: %w", err)
	}

	sheetRows, unreadable, err := readDNCSheet(ctx, svc, id)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("reading %s: %w", dncSheetTab, err)
	}
	skipped = len(unreadable)

	// sheet -> database
	for phone, r := range sheetRows {
		reason := strings.TrimSpace(r.Reason)
		if reason == "" {
			reason = "Added in the Zone and Clusters sheet"
		}
		res, execErr := database.DB.Exec(
			`INSERT INTO mambu_do_not_contact (phone, raw_input, reason, source)
			 VALUES ($1, $1, $2, 'Sheet')
			 ON CONFLICT (phone) DO NOTHING`, phone, reason)
		if execErr != nil {
			return imported, 0, skipped, fmt.Errorf("storing %s: %w", phone, execErr)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			imported++
		}
	}

	// database -> sheet
	dbRows, err := dbDNCRows()
	if err != nil {
		return imported, 0, skipped, err
	}
	// Source comes from the row, never from "is it on the tab?" - after the
	// first sync everything is on the tab, which made that test answer "Sheet"
	// for all of them.
	for i := range dbRows {
		if dbRows[i].Source == "" {
			dbRows[i].Source = "Web"
		}
	}
	// Anything that could not be read goes back on the end, flagged, so the
	// person who typed it can see it and correct it.
	for _, b := range unreadable {
		reason := strings.TrimSpace(b.Reason)
		if reason != "" {
			reason += " — "
		}
		dbRows = append(dbRows, dncRow{
			Phone:  b.Phone,
			Reason: reason + "NOT SAVED: not a Tanzanian mobile number",
			Source: "Needs fixing",
		})
	}
	if err := writeDNCSheet(ctx, svc, id, dbRows); err != nil {
		return imported, 0, skipped, fmt.Errorf("writing %s: %w", dncSheetTab, err)
	}

	dncSyncMu.Lock()
	dncSyncedAt = time.Now()
	dncSyncMu.Unlock()

	return imported, len(dbRows) - skipped, skipped, nil
}

// syncDNCQuietly runs a sync in the background and logs anything that goes
// wrong. Used after an add or a delete: the caller has already been told their
// change was saved, and the sheet catching up must not make them wait or see an
// error for something that is only a mirror.
func syncDNCQuietly(why string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		imported, written, skipped, err := SyncDoNotContact(ctx)
		if err != nil {
			log.Printf("[dnc] sheet sync after %s failed: %v", why, err)
			return
		}
		log.Printf("[dnc] sheet sync after %s: %d imported, %d on the tab, %d unreadable",
			why, imported, written, skipped)
	}()
}

// syncDNCIfStale pulls the sheet in before the list is used, unless it was
// already pulled a moment ago. Called on the paths that must not miss a number
// somebody typed into the spreadsheet - listing the numbers, and building a
// lead file.
func syncDNCIfStale(ctx context.Context) {
	dncSyncMu.Lock()
	fresh := time.Since(dncSyncedAt) < dncSyncTTL
	dncSyncMu.Unlock()
	if fresh {
		return
	}
	if _, _, _, err := SyncDoNotContact(ctx); err != nil {
		// The database still has the list; a sheet that cannot be reached
		// means the tab may be behind, never that a number is lost.
		log.Printf("[dnc] sheet sync skipped: %v", err)
	}
}

// SyncDoNotContactHandler - POST /api/mambu/do-not-contact/sync
func SyncDoNotContactHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	imported, written, skipped, err := SyncDoNotContact(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"imported": imported,
		"onSheet":  written,
		"skipped":  skipped,
		"tab":      dncSheetTab,
		"message": fmt.Sprintf("%d number(s) taken from the sheet, %d now on the %s tab%s",
			imported, written, dncSheetTab,
			map[bool]string{true: fmt.Sprintf(", %d row(s) could not be read and are flagged on the tab", skipped),
				false: ""}[skipped > 0]),
	})
}
