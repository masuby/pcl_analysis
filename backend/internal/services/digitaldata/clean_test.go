package digitaldata

// Every literal in this file is a value actually observed in the LBF / CS / SME
// workbooks, so the tests fail if the cleaner regresses on real source data.

import "testing"

func TestNormalizePhone(t *testing.T) {
	cases := []struct {
		in    string
		want  string
		valid bool
	}{
		{"658456107", "255658456107", true},        // 9-digit, leading 0 stripped by the sheet
		{"0712345678", "255712345678", true},       // local format
		{"255 763 259 559", "255763259559", true},  // spaced
		{"+255712345678", "255712345678", true},    // international
		{"255766000788", "255766000788", true},     // already canonical
		{"2556760087900", "2556760087900", false},  // 13 digits — malformed
		{"753235319", "255753235319", true},        // header-row contamination value
		{"12345", "12345", false},                  // too short
		{"", "", false},                            // empty
		{"255812345678", "255812345678", false},    // 8xx is not a TZ mobile
	}
	for _, c := range cases {
		got, ok := NormalizePhone(c.in)
		if got != c.want || ok != c.valid {
			t.Errorf("NormalizePhone(%q) = (%q,%v), want (%q,%v)", c.in, got, ok, c.want, c.valid)
		}
	}
}

func TestParseDate(t *testing.T) {
	cases := []struct {
		in                  string
		y, m, d             int
		wantAmb, wantParsed bool
	}{
		{"22-Apr-2025", 2025, 4, 22, false, true},
		{"2/16/2026", 2026, 2, 16, false, true},   // second > 12 -> mm/dd
		{"15-09-2025", 2025, 9, 15, false, true},  // first > 12 -> dd/mm
		{"15-augut-2025", 2025, 8, 15, false, true}, // typo, resolved by 3-letter prefix
		{"2026-07-07 8:04", 2026, 7, 7, false, true},
		{"7/20/26", 2026, 7, 20, false, true},
		{"05/06/2026", 2026, 6, 5, true, true},    // ambiguous -> dd/mm, flagged
		{"15/09/2025", 2025, 9, 15, false, true},
		{"31/02/2025", 0, 0, 0, false, false},     // impossible date
		{"not a date", 0, 0, 0, false, false},
		{"", 0, 0, 0, false, false},
		{"45658", 2025, 1, 1, false, true},        // Excel serial (UNFORMATTED_VALUE)
		{"45870", 2025, 8, 1, false, true},        // serial, 212 days later
		{"255766000788", 0, 0, 0, false, false},   // a phone must never parse as a date
	}
	for _, c := range cases {
		got, amb, ok := ParseDate(c.in, true)
		if ok != c.wantParsed {
			t.Errorf("ParseDate(%q) parsed=%v, want %v", c.in, ok, c.wantParsed)
			continue
		}
		if !ok {
			continue
		}
		if got.Year() != c.y || int(got.Month()) != c.m || got.Day() != c.d {
			t.Errorf("ParseDate(%q) = %s, want %04d-%02d-%02d", c.in, got.Format("2006-01-02"), c.y, c.m, c.d)
		}
		if amb != c.wantAmb {
			t.Errorf("ParseDate(%q) ambiguous=%v, want %v", c.in, amb, c.wantAmb)
		}
	}

	// The dd/mm vs mm/dd switch must actually change the reading.
	if d, _, _ := ParseDate("05/06/2026", false); int(d.Month()) != 5 || d.Day() != 6 {
		t.Errorf("dayFirst=false should read 05/06/2026 as 6 May, got %s", d.Format("2006-01-02"))
	}
}

func TestCanonicalStatus(t *testing.T) {
	cases := map[string]string{
		"Not reachable":       StNotReach,
		"not picking":         StNotReach,
		"Failed to connect":   StNotReach,
		"hapatikani":          StNotReach,
		"haipokelewi":         StNotReach,
		"Busy":                StNotReach,
		"Not interested":      StNotInterest,
		"Do not need loan":    StNotInterest,
		"Decline sale":        StNotInterest,
		"Duplicated number":   StDuplicate,
		"namba imejirudia":    StDuplicate,
		"Wrong number":        StWrongNumber,
		"Exisiting Customer":  StExisting, // source typo
		"Existing Customer":   StExisting,
		"No Affordability":    StNotQualif,
		"Out of Region":       StOutOfRegion,
		"Request callback":    StCallback,
		"Need followup":       StCallback,
		"Request more time":   StCallback,
		"Converted":           StConverted,
		"Qualified for LBF":   StInterested,
		"hajathibitishwa":     StPending,
		"":                    StUnknown,
		"asdfgh":              StUnknown,
	}
	for in, want := range cases {
		if got := CanonicalStatus(in); got != want {
			t.Errorf("CanonicalStatus(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestCanonicalPlatform(t *testing.T) {
	cases := map[string]string{
		"fb": "facebook", "FB": "facebook", "Facebook": "facebook",
		"ig": "instagram", "Instagram": "instagram",
		"tiktok": "tiktok", "Tik Tok": "tiktok",
		"WhatsApp": "whatsapp", "Whatsapp": "whatsapp",
		"WebChart": "website", "Weblead form": "website", "Weblead": "website",
		"USSD": "ussd", "": "unknown", "zzz": "other",
	}
	for in, want := range cases {
		if got := CanonicalPlatform(in); got != want {
			t.Errorf("CanonicalPlatform(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestCanonicalProduct(t *testing.T) {
	cases := []struct{ in, book, want string }{
		{"LBF", "LBF", "LBF"},
		{"LBF ", "LBF", "LBF"},
		{"MIF Ad 1", "LBF", "MIF"},         // MIF ads live in the LBF book
		{"MIF Ad 2", "LBF", "MIF"},
		{"LBF Leads Ad 2", "LBF", "LBF"},
		{"LBF Leads Ad 1 - Copy", "LBF", "LBF"},
		{"", "CS", "CS"},                   // falls back to the workbook
		{"SME Ad", "LBF", "SME"},
	}
	for _, c := range cases {
		if got := CanonicalProduct(c.in, c.book); got != c.want {
			t.Errorf("CanonicalProduct(%q, %q) = %s, want %s", c.in, c.book, got, c.want)
		}
	}
}

func TestClassifyTab(t *testing.T) {
	cases := map[string]string{
		"MAY 2026 SHEET":    KindSocialLead,
		"SOCIAL MEDIA 03":   KindSocialLead,
		"USSD 03":           KindSocialLead,
		"JULY 2026 SHEET":   KindSocialLead,
		"BUY OFF":           KindPayroll,
		"REACTIVATION":      KindPayroll,
		"REFINANCE":         KindPayroll,
		"NEW HIRE(Jan-Apr)": KindPayroll,
		"PROMOTED CUST.":    KindPayroll,
		"NEW DATA (FEB)":    KindPayroll,
		"NEW":               KindPayroll,
		"BAK&EZEK HIST DATA": KindPayroll,
		"FX":                KindReference,
		"BRANCH LOCATION":   KindReference,
		"WEEKLY REPORT":     KindReport,
	}
	for in, want := range cases {
		if got := ClassifyTab(in, 100); got != want {
			t.Errorf("ClassifyTab(%q) = %s, want %s", in, got, want)
		}
	}
	if got := ClassifyTab("AUGUST", 0); got != KindEmpty {
		t.Errorf("ClassifyTab with 0 rows = %s, want %s", got, KindEmpty)
	}
}

// TestBuildColumnMapCleanHeader covers the newer schema the team converged on.
func TestBuildColumnMapCleanHeader(t *testing.T) {
	rows := [][]string{
		{"Platform", "name", "check_no", "date", "assigned_to", "phone_no", "status", "comment", "is_converted?", "loan_amount", "client_type"},
		{"fb", "John Mwita", "C123", "2026-05-04", "Asha", "255712345678", "Converted", "ok", "yes", "1500000", "new"},
	}
	cm := BuildColumnMap(rows)
	if cm.HeaderRow != 0 {
		t.Fatalf("HeaderRow = %d, want 0", cm.HeaderRow)
	}
	if cm.Headerless {
		t.Fatal("should not be headerless")
	}
	for _, f := range []Field{FPlatform, FName, FDate, FAssigned, FPhone, FStatus, FComment} {
		if !cm.Has(f) {
			t.Errorf("field %d not mapped", f)
		}
	}
	if got := cm.Get(rows[1], FPhone); got != "255712345678" {
		t.Errorf("phone = %q", got)
	}
}

// TestBuildColumnMapHeaderlessTab is the OCTOBER SHEET case: row 0 is a data
// record, not a header. Content inference must still find the columns, and
// row 0 must be retained as data rather than eaten.
func TestBuildColumnMapHeaderlessTab(t *testing.T) {
	rows := [][]string{
		{"-", "Whatsapp", "", "255712345671", "Duplicated number", "15/10/2025"},
		{"-", "fb", "", "255712345672", "Not reachable", "16/10/2025"},
		{"-", "fb", "", "255712345673", "Not interested", "17/10/2025"},
		{"-", "ig", "", "255712345674", "Converted", "18/10/2025"},
		{"-", "ig", "", "255712345675", "Not picking", "19/10/2025"},
	}
	cm := BuildColumnMap(rows)
	if !cm.Headerless {
		t.Fatal("expected headerless detection")
	}
	if cm.HeaderRow != -1 {
		t.Fatalf("HeaderRow = %d, want -1 so row 0 stays data", cm.HeaderRow)
	}
	if !cm.Has(FPhone) {
		t.Fatal("phone column not inferred from content")
	}
	if cm.Idx[FPhone] != 3 {
		t.Errorf("phone column = %d, want 3", cm.Idx[FPhone])
	}
	if !cm.Has(FDate) || cm.Idx[FDate] != 5 {
		t.Errorf("date column = %d, want 5", cm.Idx[FDate])
	}
	if !cm.Has(FStatus) || cm.Idx[FStatus] != 4 {
		t.Errorf("status column = %d, want 4", cm.Idx[FStatus])
	}
}

// TestBuildColumnMapPoisonedHeader is the APRIL SHEET case: the header row
// carries a real field name AND a stray data value ("Not reachable").
func TestBuildColumnMapPoisonedHeader(t *testing.T) {
	rows := [][]string{
		{".", "CHANNEL", "NAMES", "NUMBER", "", "Not reachable", "CALLING DATE"},
		{"1", "fb", "Asha Juma", "255712345671", "", "Not reachable", "15/10/2025"},
	}
	cm := BuildColumnMap(rows)
	if cm.HeaderRow != 0 {
		t.Fatalf("HeaderRow = %d, want 0", cm.HeaderRow)
	}
	if cm.Idx[FPhone] != 3 {
		t.Errorf("phone col = %d, want 3", cm.Idx[FPhone])
	}
	if cm.Idx[FName] != 2 {
		t.Errorf("name col = %d, want 2", cm.Idx[FName])
	}
	if cm.Idx[FDate] != 6 {
		t.Errorf("date col = %d, want 6", cm.Idx[FDate])
	}
}

func TestCleanRowIssues(t *testing.T) {
	rows := [][]string{
		{"Platform", "name", "date", "phone_no", "status"},
		{"fb", "", "not a date", "12345", ""}, // bad everything
	}
	cm := BuildColumnMap(rows)
	cr, keep := CleanRowFrom(rows[1], cm, 2, CleanOpts{Book: "LBF", Tab: "T", TabKind: KindSocialLead, DayFirst: true})
	if !keep {
		t.Fatal("row should be kept, not dropped")
	}
	has := func(code string) bool {
		for _, i := range cr.Issues {
			if i == code {
				return true
			}
		}
		return false
	}
	for _, code := range []string{IssBadPhone, IssNoDate, IssNoName, IssNoStatus} {
		if !has(code) {
			t.Errorf("missing issue %s in %v", code, cr.Issues)
		}
	}
	if cr.PhoneValid {
		t.Error("phone should be invalid")
	}

	// A completely blank row is padding and must be dropped.
	if _, keep := CleanRowFrom([]string{"", "", "", "", ""}, cm, 3,
		CleanOpts{Book: "LBF", Tab: "T", TabKind: KindSocialLead}); keep {
		t.Error("blank row should not be kept")
	}
}

// A phone number sitting in the CALLBACK DATE column must be flagged, not
// silently swallowed.
func TestCleanRowContamination(t *testing.T) {
	rows := [][]string{
		{"name", "date", "phone_no", "status"},
		{"Asha Juma", "654448964", "255712345678", "Converted"},
	}
	cm := BuildColumnMap(rows)
	cr, _ := CleanRowFrom(rows[1], cm, 2, CleanOpts{Book: "LBF", Tab: "T", TabKind: KindSocialLead, DayFirst: true})
	found := false
	for _, i := range cr.Issues {
		if i == IssContaminated {
			found = true
		}
	}
	if !found {
		t.Errorf("expected CONTAMINATED_FIELD, got %v", cr.Issues)
	}
	if !cr.IsConverted {
		t.Error("status Converted should set IsConverted")
	}
}

// Re-reading the same source cell must produce the same hash so re-ingest is a
// no-op, and a changed cell must produce a different one.
func TestRowHashStability(t *testing.T) {
	a := rowHash("LBF", "MAY 2026 SHEET", 5, []string{"fb", "Asha", "255712345678"})
	b := rowHash("LBF", "MAY 2026 SHEET", 5, []string{"fb", "Asha", "255712345678"})
	c := rowHash("LBF", "MAY 2026 SHEET", 5, []string{"fb", "Asha", "255712345679"})
	if a != b {
		t.Error("same content must hash the same")
	}
	if a == c {
		t.Error("different content must hash differently")
	}
}
