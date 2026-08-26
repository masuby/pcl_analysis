package handlers

// Distribution and workbook writing.
//
// Every workbook has the same three sheets, which is what makes them usable
// without explanation:
//
//   Summary       who is receiving work, and how many rows each got
//   Distribution  the data with "Assigned To" / "Assigned Phone" attached
//   Data          the plain rows, for anyone who wants to sort them themselves
//
// The FULL workbook carries a fourth, Do_Not_Contact, listing rows removed
// because the client asked not to be called — so a manager asking "where did
// my client go" gets an answer instead of a silent gap.

import (
	"bytes"
	"fmt"
	"math/rand"
	"strconv"

	"github.com/xuri/excelize/v2"
)

// distributePool assigns rows across one pool, randomly but as evenly as the
// division allows: the remainder goes to randomly chosen people rather than
// always the first few, so nobody is systematically given the extra row.
func distributePool(t *rrTable, pool []ZonePerson, rng *rand.Rand) (*rrTable, *rrTable) {
	dist := t.SelectCols(t.Cols...)
	dist.AddCol("Assigned To")
	dist.AddCol("Assigned Phone")

	counts := map[string]int{}
	if len(pool) > 0 && dist.Len() > 0 {
		order := shareOut(dist.Len(), pool, rng)
		for i, p := range order {
			r := dist.Rows[i]
			r = dist.Set(r, "Assigned To", p.Name)
			r = dist.Set(r, "Assigned Phone", p.Phone)
			dist.Rows[i] = r
			counts[p.Name]++
		}
	}
	return dist, summaryTable(pool, counts)
}

// distributeByBranch assigns each row within its OWN branch, which is what the
// FULL and zone workbooks need — a team leader should only ever see clients
// belonging to their branch.
func distributeByBranch(t *rrTable, zc *ZoneClusters, product string, rng *rand.Rand) (*rrTable, *rrTable, []string) {
	dist := t.SelectCols(t.Cols...)
	dist.AddCol("Assigned To")
	dist.AddCol("Assigned Phone")

	byBranch := map[string][]int{}
	var branchOrder []string
	for i, r := range dist.Rows {
		b := dist.Get(r, "Branch")
		if _, ok := byBranch[b]; !ok {
			branchOrder = append(branchOrder, b)
		}
		byBranch[b] = append(byBranch[b], i)
	}

	var summaryRows [][]string
	var noRecipient []string
	people := map[string]ZonePerson{}
	counts := map[string]int{}

	for _, b := range branchOrder {
		idxs := byBranch[b]
		var pool []ZonePerson
		if b != "" {
			pool = zc.PeopleForBranch(product, b)
		}
		if len(pool) == 0 {
			name := b
			if name == "" {
				name = "(blank branch)"
			}
			noRecipient = append(noRecipient, name)
			summaryRows = append(summaryRows, []string{
				"(no recipients found)", "", name, "", "", strconv.Itoa(len(idxs)), "",
			})
			continue
		}
		order := shareOut(len(idxs), pool, rng)
		for j, i := range idxs {
			p := order[j]
			r := dist.Rows[i]
			r = dist.Set(r, "Assigned To", p.Name)
			r = dist.Set(r, "Assigned Phone", p.Phone)
			dist.Rows[i] = r
			counts[p.Name]++
			people[p.Name] = p
		}
	}

	summary := newTable([]string{"Name", "Role", "Branch", "Phone", "Email", "Assigned Rows", "Email Recipient"})
	for _, name := range sortedKeys(people) {
		p := people[name]
		summary.Rows = append(summary.Rows, []string{
			p.Name, p.Role, p.Branch, p.Phone, p.Email, strconv.Itoa(counts[p.Name]), "",
		})
	}
	summary.Rows = append(summary.Rows, summaryRows...)
	summary = withTotalRow(summary)
	return dist, summary, noRecipient
}

// shareOut builds the assignment order: base rows each, the remainder to
// randomly picked people, then the whole order shuffled so the assignment is
// not correlated with the sheet's row order.
func shareOut(n int, pool []ZonePerson, rng *rand.Rand) []ZonePerson {
	k := len(pool)
	base, rem := n/k, n%k
	sizes := make([]int, k)
	for i := range sizes {
		sizes[i] = base
	}
	for _, i := range rng.Perm(k)[:rem] {
		sizes[i]++
	}
	order := make([]ZonePerson, 0, n)
	for i, p := range pool {
		for j := 0; j < sizes[i]; j++ {
			order = append(order, p)
		}
	}
	rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
	return order
}

func summaryTable(pool []ZonePerson, counts map[string]int) *rrTable {
	s := newTable([]string{"Name", "Role", "Branch", "Phone", "Email", "Assigned Rows", "Email Recipient"})
	if len(pool) == 0 {
		s.Rows = append(s.Rows, []string{
			"(nobody on the roster for this group)", "", "", "", "", "0", "",
		})
		return s
	}
	for _, p := range pool {
		s.Rows = append(s.Rows, []string{
			p.Name, p.Role, p.Branch, p.Phone, p.Email, strconv.Itoa(counts[p.Name]), "",
		})
	}
	return withTotalRow(s)
}

func withTotalRow(s *rrTable) *rrTable {
	total := 0
	for _, r := range s.Rows {
		if n, err := strconv.Atoi(s.Get(r, "Assigned Rows")); err == nil {
			total += n
		}
	}
	s.Rows = append(s.Rows, []string{"TOTAL", "", "", "", "", strconv.Itoa(total), ""})
	return s
}

// markRecipients flags who the workbook is addressed to. Anyone who is a
// recipient but not an assignee (a manager, say) is added at the top so they
// appear at all.
func markRecipients(summary *rrTable, recipients []ZonePerson) *rrTable {
	if len(recipients) == 0 {
		return summary
	}
	want := map[string]bool{}
	for _, r := range recipients {
		want[r.Name+"|"+r.Phone] = true
	}
	covered := map[string]bool{}
	for i, r := range summary.Rows {
		k := summary.Get(r, "Name") + "|" + summary.Get(r, "Phone")
		if want[k] {
			summary.Rows[i] = summary.Set(r, "Email Recipient", "YES")
			covered[k] = true
		}
	}
	var extra [][]string
	for _, p := range recipients {
		if !covered[p.Name+"|"+p.Phone] {
			extra = append(extra, []string{p.Name, p.Role, p.Branch, p.Phone, p.Email, "", "YES"})
		}
	}
	if len(extra) > 0 {
		summary.Rows = append(extra, summary.Rows...)
	}
	return summary
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

// addWorkbook builds one workbook and attaches it to the result.
//
// A single failure must not sink a run of hundreds of files, but it must never
// be silent either: writing the error text into a file still named .xlsx just
// produces something Excel refuses to open with no explanation. Instead the
// file is dropped and the reason recorded, so it surfaces on the run.
func (res *rrProductResult) addWorkbook(relPath string, summary, dist, data, dnc *rrTable) {
	b, err := buildWorkbook(summary, dist, data, dnc)
	if err != nil {
		res.fileErrors = append(res.fileErrors, fmt.Sprintf("%s (%v)", relPath, err))
		return
	}
	res.files = append(res.files, rrOutFile{RelPath: relPath, Data: b})
}

func buildWorkbook(summary, dist, data, dnc *rrTable) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	header, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF", Size: 11},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"1E3A8A"}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border: []excelize.Border{
			{Type: "bottom", Color: "D0D7E2", Style: 1},
		},
	})
	cell, _ := f.NewStyle(&excelize.Style{
		Border: []excelize.Border{
			{Type: "left", Color: "E2E8F0", Style: 1},
			{Type: "right", Color: "E2E8F0", Style: 1},
			{Type: "top", Color: "E2E8F0", Style: 1},
			{Type: "bottom", Color: "E2E8F0", Style: 1},
		},
	})

	sheets := []struct {
		name string
		t    *rrTable
	}{
		{"Summary", summary},
		{"Distribution", dist},
		{"Data", data},
	}
	if dnc != nil && dnc.Len() > 0 {
		sheets = append(sheets, struct {
			name string
			t    *rrTable
		}{"Do_Not_Contact", dnc})
	}

	for i, s := range sheets {
		if i == 0 {
			f.SetSheetName("Sheet1", s.name)
		} else {
			if _, err := f.NewSheet(s.name); err != nil {
				return nil, err
			}
		}
		if err := writeSheet(f, s.name, s.t, header, cell); err != nil {
			return nil, err
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeSheet(f *excelize.File, sheet string, t *rrTable, headerStyle, cellStyle int) error {
	if t == nil {
		return nil
	}
	sw, err := f.NewStreamWriter(sheet)
	if err != nil {
		return err
	}

	// Freeze the header so a 3,000-row branch file stays readable. excelize
	// requires this BEFORE the first SetRow — called later it returns an error,
	// and called after Flush it is silently discarded.
	if err := sw.SetPanes(&excelize.Panes{
		Freeze: true, Split: false, XSplit: 0, YSplit: 1,
		TopLeftCell: "A2", ActivePane: "bottomLeft",
	}); err != nil {
		return err
	}

	head := make([]interface{}, len(t.Cols))
	widths := make([]int, len(t.Cols))
	for i, c := range t.Cols {
		head[i] = excelize.Cell{Value: c, StyleID: headerStyle}
		widths[i] = len(c) + 4
	}
	if err := sw.SetRow("A1", head, excelize.RowOpts{Height: 20}); err != nil {
		return err
	}

	for r, row := range t.Rows {
		vals := make([]interface{}, len(t.Cols))
		for i := range t.Cols {
			v := ""
			if i < len(row) {
				v = row[i]
			}
			if l := len(v); l+2 > widths[i] && widths[i] < 48 {
				widths[i] = l + 2
			}
			vals[i] = excelize.Cell{Value: v, StyleID: cellStyle}
		}
		axis, _ := excelize.CoordinatesToCellName(1, r+2)
		if err := sw.SetRow(axis, vals); err != nil {
			return err
		}
	}

	for i, w := range widths {
		if w > 48 {
			w = 48
		}
		_ = sw.SetColWidth(i+1, i+1, float64(w))
	}

	return sw.Flush()
}
