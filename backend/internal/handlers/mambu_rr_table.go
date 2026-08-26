package handlers

// A small in-memory table, the Go stand-in for the pandas DataFrame the
// original scripts used. Everything is held as strings and converted at the
// point of use — the exports are hand-produced and a single bad cell must not
// abort a run of 24,000 rows.

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

type rrTable struct {
	Cols []string
	Rows [][]string
	idx  map[string]int // lower-cased column name -> position
}

func newTable(cols []string) *rrTable {
	t := &rrTable{Cols: append([]string{}, cols...)}
	t.reindex()
	return t
}

func (t *rrTable) reindex() {
	t.idx = make(map[string]int, len(t.Cols))
	for i, c := range t.Cols {
		k := strings.ToLower(strings.TrimSpace(c))
		if _, dup := t.idx[k]; !dup {
			t.idx[k] = i
		}
	}
}

// Col returns a column's position, or -1. Matching is case- and
// space-insensitive because export headers drift ("Mobile Phone " etc).
func (t *rrTable) Col(name string) int {
	if i, ok := t.idx[strings.ToLower(strings.TrimSpace(name))]; ok {
		return i
	}
	return -1
}

func (t *rrTable) Has(name string) bool { return t.Col(name) >= 0 }

// Get reads a cell by column name, tolerating short rows.
func (t *rrTable) Get(row []string, name string) string {
	i := t.Col(name)
	if i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

// AddCol appends a column, filling existing rows with "".
func (t *rrTable) AddCol(name string) int {
	if i := t.Col(name); i >= 0 {
		return i
	}
	t.Cols = append(t.Cols, name)
	for i := range t.Rows {
		for len(t.Rows[i]) < len(t.Cols) {
			t.Rows[i] = append(t.Rows[i], "")
		}
	}
	t.reindex()
	return len(t.Cols) - 1
}

func (t *rrTable) Set(row []string, name, val string) []string {
	i := t.AddCol(name)
	for len(row) <= i {
		row = append(row, "")
	}
	row[i] = val
	return row
}

// Filter keeps the rows the predicate accepts.
func (t *rrTable) Filter(keep func(row []string) bool) *rrTable {
	out := &rrTable{Cols: append([]string{}, t.Cols...)}
	for _, r := range t.Rows {
		if keep(r) {
			out.Rows = append(out.Rows, r)
		}
	}
	out.reindex()
	return out
}

// SelectCols projects to the named columns, in order, skipping absent ones.
func (t *rrTable) SelectCols(names ...string) *rrTable {
	var keep []int
	var cols []string
	for _, n := range names {
		if i := t.Col(n); i >= 0 {
			keep = append(keep, i)
			cols = append(cols, t.Cols[i])
		}
	}
	out := newTable(cols)
	for _, r := range t.Rows {
		nr := make([]string, len(keep))
		for j, i := range keep {
			if i < len(r) {
				nr[j] = r[i]
			}
		}
		out.Rows = append(out.Rows, nr)
	}
	return out
}

func (t *rrTable) Len() int { return len(t.Rows) }

// DedupeBy keeps the FIRST row per key, matching pandas drop_duplicates(keep="first").
func (t *rrTable) DedupeBy(col string) *rrTable {
	seen := map[string]bool{}
	return t.Filter(func(r []string) bool {
		k := strings.ToUpper(t.Get(r, col))
		if k == "" {
			// A blank name is not evidence of a duplicate; keep it and let the
			// later filters decide.
			return true
		}
		if seen[k] {
			return false
		}
		seen[k] = true
		return true
	})
}

// ---------------------------------------------------------------------------
// Reading an export
// ---------------------------------------------------------------------------

// readSheetTable loads the first worksheet of an .xlsx into a table.
func readSheetTable(path string) (*rrTable, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("opening %s: %w", path, err)
	}
	defer f.Close()

	names := f.GetSheetList()
	if len(names) == 0 {
		return nil, fmt.Errorf("%s has no worksheets", path)
	}

	rows, err := f.Rows(names[0])
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var t *rrTable
	for rows.Next() {
		cells, err := rows.Columns()
		if err != nil {
			continue
		}
		if t == nil {
			var cols []string
			for _, c := range cells {
				cols = append(cols, strings.TrimSpace(c))
			}
			t = newTable(cols)
			continue
		}
		// Skip rows that are entirely blank — exports often carry trailing ones.
		blank := true
		for _, c := range cells {
			if strings.TrimSpace(c) != "" {
				blank = false
				break
			}
		}
		if blank {
			continue
		}
		for len(cells) < len(t.Cols) {
			cells = append(cells, "")
		}
		t.Rows = append(t.Rows, cells)
	}
	if t == nil {
		return nil, fmt.Errorf("%s: the first worksheet is empty", path)
	}
	return t, nil
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

var nonDigitsRR = regexp.MustCompile(`\D`)

// rrNormalisePhone mirrors the original normalize_phone_255: lenient, because
// its job is to make client numbers comparable, not to validate them. Numbers
// it cannot make sense of simply never match the do-not-contact list.
//
// The stricter NormaliseTZPhone is used where a person types a number by hand
// and deserves to be told it is wrong.
func rrNormalisePhone(v string) string {
	s := strings.TrimSpace(v)
	if s == "" {
		return ""
	}
	// Excel hands numeric cells back as "255712317849" or "2.55712317849e+11".
	if f, err := strconv.ParseFloat(s, 64); err == nil && !strings.ContainsAny(s, "eE") {
		if f == float64(int64(f)) {
			s = strconv.FormatInt(int64(f), 10)
		}
	}
	s = strings.TrimSuffix(s, ".0")
	d := nonDigitsRR.ReplaceAllString(s, "")
	switch {
	case d == "":
		return ""
	case strings.HasPrefix(d, "255") && len(d) >= 12:
		return d[:12]
	case len(d) == 10 && strings.HasPrefix(d, "0"):
		return "255" + d[1:]
	case len(d) == 9 && (d[0] == '6' || d[0] == '7'):
		return "255" + d
	case strings.HasPrefix(d, "0"):
		return "255" + strings.TrimLeft(d, "0")
	}
	return d
}

var rrDateFormats = []string{
	"2006-01-02", "2006-01-02 15:04:05", "2006-01-02T15:04:05",
	"02/01/2006", "02-01-2006", "02/01/2006 15:04", "01/02/2006",
	"2006/01/02", "2 January 2006", "02-Jan-2006",
}

// parseRRDate reads the several date shapes these exports carry, including the
// Excel serial number that appears when a column was never formatted as a date.
func parseRRDate(v string) (time.Time, bool) {
	s := strings.TrimSpace(v)
	if s == "" {
		return time.Time{}, false
	}
	for _, f := range rrDateFormats {
		if t, err := time.Parse(f, s); err == nil {
			return t, true
		}
		if len(s) >= len(f) {
			if t, err := time.Parse(f, s[:len(f)]); err == nil {
				return t, true
			}
		}
	}
	// Excel serial: days since 1899-12-30.
	if n, err := strconv.ParseFloat(s, 64); err == nil && n > 20000 && n < 80000 {
		return time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC).
			AddDate(0, 0, int(n)), true
	}
	return time.Time{}, false
}

func parseRRFloat(v string) (float64, bool) {
	s := strings.TrimSpace(strings.ReplaceAll(v, ",", ""))
	if s == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil
}

// ageOn is whole years completed — the same arithmetic the script used.
func ageOn(birth, today time.Time) int {
	y := today.Year() - birth.Year()
	if today.Month() < birth.Month() ||
		(today.Month() == birth.Month() && today.Day() < birth.Day()) {
		y--
	}
	return y
}

// monthsBetween counts whole months elapsed, not counting a partial final month.
func monthsBetween(from, today time.Time) int {
	m := (today.Year()-from.Year())*12 + int(today.Month()) - int(from.Month())
	if today.Day() < from.Day() {
		m--
	}
	if m < 0 {
		m = 0
	}
	return m
}
