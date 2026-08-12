package crmdata

// Parsing an uploaded Lead_Report workbook.
//
// Columns are located by HEADER NAME, not position, because the CRM export has
// changed shape before and a positional read would silently shift every field.
// Anything the sheet does not carry is simply left empty.

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// Row is one parsed lead, already normalised.
type Row struct {
	PhoneNorm  string
	PhoneRaw   string
	PhoneValid bool

	Name                string
	CreatedBy           string
	CreatedByKey        string
	Email               string
	IDNumber            string
	EmpNumber           string
	TeamName            string
	AssignedTo          string
	ConsentType         string
	ConsentStatus       string
	ConsentDate         *time.Time
	ConsentRequestDate  *time.Time
	Status              string
	Branch              string
	BranchKey           string
	ProductHint         string
	Region              string
	Location            string
	Source              string
	AffordabilityOutcome string
	TotalAffordability  *float64
	InstallmentAmount   *float64
	AffordabilityDate   string
	AssignmentType      string
	CreatedDate         *time.Time
	Comment             string
}

// header name (normalised) -> logical field
var headerAliases = map[string]string{
	"name": "name", "clientname": "name", "fullname": "name",
	"createdby": "created_by",
	"contactnumber": "phone", "phone": "phone", "phonenumber": "phone", "mobile": "phone",
	"emailaddress": "email", "email": "email",
	"idnumber": "id_number",
	"empnumber": "emp_number", "employeenumber": "emp_number",
	"teamname": "team_name", "team": "team_name",
	"assignedto": "assigned_to",
	"consenttype": "consent_type",
	"consentstatus": "consent_status",
	"consentdate": "consent_date",
	"consentrequestdate": "consent_request_date",
	"status": "status",
	"branch": "branch",
	"region": "region",
	"location": "location",
	"source": "source",
	"affordabilityoutcome": "affordability_outcome",
	"totalaffordability": "total_affordability",
	"installmentamount": "installment_amount",
	"affordabilitydatecreated": "affordability_date",
	"assignmenttype": "assignment_type",
	"createddate": "created_date",
	"comment": "comment", "comments": "comment",
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func normHeader(s string) string {
	return nonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "")
}

var digitsOnly = regexp.MustCompile(`\D+`)
var tzMobile = regexp.MustCompile(`^255[67]\d{8}$`)

// NormalizePhone maps the many shapes in the export onto 255XXXXXXXXX.
// The sample file carries 0757920258, 27783494362, 255878984795 and even a
// 24-digit value; matching on the raw text would create duplicate clients.
func NormalizePhone(raw string) (string, bool) {
	d := digitsOnly.ReplaceAllString(raw, "")
	if d == "" {
		return "", false
	}
	switch {
	case strings.HasPrefix(d, "255"):
		// already international
	case strings.HasPrefix(d, "0"):
		d = "255" + strings.TrimLeft(d, "0")
	case len(d) == 9:
		d = "255" + d
	}
	if tzMobile.MatchString(d) {
		return d, true
	}
	if len(d) > 30 {
		d = d[:30]
	}
	// Kept as-is so the client is not lost, but flagged invalid.
	return d, false
}

var (
	branchWordBranch = regexp.MustCompile(`(?i)\bbranch\b`)
	branchCentre     = regexp.MustCompile(`(?i)centre`)
	branchPrefix     = regexp.MustCompile(`(?i)^\s*(cs|lbf|sme)\b`)
	branchStrip      = regexp.MustCompile(`[^a-z0-9]+`)
)

// BranchKey normalises a branch for matching against the Team Leader directory:
// "CS Mbeya Branch" and "Mbeya" must land on the same key.
//
// "Centre" is respelt, NOT removed. Dropping it made "CS - Call Centre" and
// "LBF - Call Centre" both reduce to "call", which would route CS leads to LBF
// team leaders. The two call centres are told apart by ProductHint instead.
//
// Must stay in step with crm_branch_key() in migration 022, which applies the
// same rules to the directory side at query time.
func BranchKey(s string) string {
	x := branchPrefix.ReplaceAllString(s, "")
	x = branchCentre.ReplaceAllString(x, "center")
	x = branchWordBranch.ReplaceAllString(x, "")
	return branchStrip.ReplaceAllString(strings.ToLower(x), "")
}

var wsRun = regexp.MustCompile(`\s+`)

// NameKey normalises a person's name for matching against the directory.
// Runs of whitespace are collapsed: the CRM export writes "ESTER  KILONGO"
// with two spaces where the Zone & Clusters workbook writes one, and that
// single difference accounted for 902 unmatched rows in the sample file.
//
// Must stay in step with crm_name_key() in migration 023.
func NameKey(s string) string {
	return strings.ToLower(strings.TrimSpace(wsRun.ReplaceAllString(s, " ")))
}

// ProductHint returns CS / LBF / SME when the branch string names one, else "".
func ProductHint(s string) string {
	m := branchPrefix.FindStringSubmatch(s)
	if len(m) < 2 {
		return ""
	}
	return strings.ToUpper(m[1])
}

// dateLayouts covers what the CRM export emits ("12-08-2026 08:55") plus the
// usual fallbacks. Day-first: the export is dd-mm-yyyy.
var dateLayouts = []string{
	"02-01-2006 15:04", "02-01-2006 15:04:05", "02-01-2006",
	"2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02",
	"02/01/2006 15:04", "02/01/2006",
}

var excelEpoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

// ParseDate reads the export's dd-mm-yyyy stamps and Excel serial numbers.
// Returns nil for blanks and for the literal "NOT SET" the export uses.
func ParseDate(raw string) *time.Time {
	s := strings.TrimSpace(raw)
	if s == "" || strings.EqualFold(s, "not set") || strings.EqualFold(s, "null") {
		return nil
	}
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && f > 20000 && f < 80000 {
		t := excelEpoch.AddDate(0, 0, int(f))
		return &t
	}
	return nil
}

// ParseAmount reads "1,500,000" / "0" / blank.
func ParseAmount(raw string) *float64 {
	s := strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &f
}

// ParseWorkbook reads the first sheet of an uploaded Lead_Report.
// Returns the parsed rows plus the number skipped for having no phone at all.
func ParseWorkbook(path string) ([]Row, int, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, 0, fmt.Errorf("open workbook: %w", err)
	}
	defer f.Close()

	sheet := ""
	for _, name := range f.GetSheetList() {
		if strings.Contains(strings.ToLower(name), "lead") {
			sheet = name
			break
		}
	}
	if sheet == "" {
		list := f.GetSheetList()
		if len(list) == 0 {
			return nil, 0, fmt.Errorf("workbook has no sheets")
		}
		sheet = list[0]
	}

	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, 0, fmt.Errorf("read sheet %q: %w", sheet, err)
	}
	if len(rows) < 2 {
		return nil, 0, fmt.Errorf("sheet %q has no data rows", sheet)
	}

	// Map logical field -> column index, by header name.
	col := map[string]int{}
	for i, h := range rows[0] {
		if field, ok := headerAliases[normHeader(h)]; ok {
			if _, dup := col[field]; !dup {
				col[field] = i
			}
		}
	}
	if _, ok := col["phone"]; !ok {
		return nil, 0, fmt.Errorf(
			"no phone column found in %q — expected a 'Contact_Number' header", sheet)
	}

	get := func(r []string, field string) string {
		i, ok := col[field]
		if !ok || i >= len(r) {
			return ""
		}
		return strings.TrimSpace(r[i])
	}

	out := make([]Row, 0, len(rows)-1)
	skipped := 0

	for _, r := range rows[1:] {
		rawPhone := get(r, "phone")
		if strings.TrimSpace(strings.Join(r, "")) == "" {
			continue // padding row
		}
		norm, valid := NormalizePhone(rawPhone)
		if norm == "" {
			// Without a number there is no identity to upsert on.
			skipped++
			continue
		}

		branch := get(r, "branch")
		out = append(out, Row{
			PhoneNorm: norm, PhoneRaw: rawPhone, PhoneValid: valid,
			Name:                 get(r, "name"),
			CreatedBy:            get(r, "created_by"),
			CreatedByKey:         NameKey(get(r, "created_by")),
			Email:                get(r, "email"),
			IDNumber:             get(r, "id_number"),
			EmpNumber:            get(r, "emp_number"),
			TeamName:             get(r, "team_name"),
			AssignedTo:           get(r, "assigned_to"),
			ConsentType:          get(r, "consent_type"),
			ConsentStatus:        get(r, "consent_status"),
			ConsentDate:          ParseDate(get(r, "consent_date")),
			ConsentRequestDate:   ParseDate(get(r, "consent_request_date")),
			Status:               get(r, "status"),
			Branch:               branch,
			BranchKey:            BranchKey(branch),
			ProductHint:          ProductHint(branch),
			Region:               get(r, "region"),
			Location:             get(r, "location"),
			Source:               get(r, "source"),
			AffordabilityOutcome: get(r, "affordability_outcome"),
			TotalAffordability:   ParseAmount(get(r, "total_affordability")),
			InstallmentAmount:    ParseAmount(get(r, "installment_amount")),
			AffordabilityDate:    get(r, "affordability_date"),
			AssignmentType:       get(r, "assignment_type"),
			CreatedDate:          ParseDate(get(r, "created_date")),
			Comment:              get(r, "comment"),
		})
	}
	return out, skipped, nil
}
