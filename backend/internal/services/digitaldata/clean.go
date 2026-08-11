package digitaldata

// Cleaning engine for the DIGITAL DATA lead books.
//
// The three source workbooks were maintained by hand for 14+ months, so they
// cannot be parsed by "read row 0 as the header":
//
//   - In many tabs row 0 IS a data record (OCTOBER SHEET's header row is a
//     whole lead, complete with "Duplicated number" and a call date), or blank
//     (SEPT SHEET), so there is no header to read at all.
//   - Column order and column count drift between months (25/26/27 columns;
//     NOVEMBER and FEBRUARY 2026 carry an extra column that shifts NUMBER).
//   - The same field is spelled a dozen ways: NUMBER / NUMBERS / phone_no /
//     PHONE, STATUS / feedback / 1st FEEDBACK, Call Date / CALLING DATE / date.
//
// So mapping happens in two passes: try to find a real header row, then infer
// whatever the header did not give us from the *content* of each column
// (a column of 9-13 digit numbers is the phone column regardless of its label).
// Content inference is what makes the headerless tabs recoverable.
//
// Nothing is dropped. A row that fails validation is still emitted with codes
// in Issues so the Data Quality view can report precisely what is wrong.

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Field is a canonical output column.
type Field int

const (
	FName Field = iota
	FPhone
	FDate
	FStatus
	FComment
	FAssigned
	FPlatform
	FCheckNo
	FConverted
	FAmount
	FClientType
	FProduct
	FRegion
	fieldCount
)

// Canonical status vocabulary.
const (
	StConverted   = "CONVERTED"
	StInterested  = "INTERESTED"
	StCallback    = "CALLBACK"
	StNotReach    = "NOT_REACHABLE"
	StNotInterest = "NOT_INTERESTED"
	StNotQualif   = "NOT_QUALIFIED"
	StWrongNumber = "WRONG_NUMBER"
	StDuplicate   = "DUPLICATE"
	StExisting    = "EXISTING_CUSTOMER"
	StOutOfRegion = "OUT_OF_REGION"
	StPending     = "PENDING"
	StUnknown     = "UNKNOWN"
)

// Tab kinds. Only social_lead feeds the DIGITAL DATA lead views; the CS book's
// payroll/portfolio campaign tabs (~51.6k rows) are ingested but kept separate,
// and reference/report tabs are skipped entirely.
const (
	KindSocialLead = "social_lead"
	KindPayroll    = "payroll_campaign"
	KindReference  = "reference"
	KindReport     = "report"
	KindEmpty      = "empty"
)

// Issue codes attached to a row.
const (
	IssNoPhone      = "NO_PHONE"
	IssBadPhone     = "BAD_PHONE"
	IssNoDate       = "NO_DATE"
	IssAmbiguousDay = "AMBIGUOUS_DATE"
	IssNoName       = "NO_NAME"
	IssNoStatus     = "NO_STATUS"
	IssContaminated = "CONTAMINATED_FIELD"
	IssDateOutRange = "DATE_OUT_OF_RANGE"
)

// blockingIssues stop a lead being worked at all — without a usable number
// nobody can call it. The rest (no name, no date, no disposition) are gaps
// worth fixing at source but they do not make the lead worthless.
//
// The distinction matters: whole tabs never captured a customer name, so
// counting NO_NAME as a defect would mark 100% of them "bad" and hide the
// numbers that are genuinely unusable.
var blockingIssues = map[string]bool{
	IssNoPhone:  true,
	IssBadPhone: true,
}

// IsBlockingIssue reports whether an issue code makes the lead unworkable.
func IsBlockingIssue(code string) bool { return blockingIssues[code] }

// Lead dates outside this window are source typos ("15/04/2040"), not real. The
// books start in 2024, and a lead cannot be raised far in the future.
var (
	minLeadDate = time.Date(2015, 1, 1, 0, 0, 0, 0, time.UTC)
	maxLeadFwd  = 400 * 24 * time.Hour
)

// plausibleLeadDate rejects dates that cannot belong to a lead log.
func plausibleLeadDate(d time.Time) bool {
	return d.After(minLeadDate) && d.Before(time.Now().UTC().Add(maxLeadFwd))
}

// ----------------------------------------------------------------- normalising

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// normKey lowercases and strips everything but letters/digits so "1st FEEDBACK",
// "STATUS " and "status" all collapse to comparable tokens.
func normKey(s string) string {
	return nonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "")
}

var digitsOnly = regexp.MustCompile(`\D+`)

// fieldSynonyms maps a normalised header token to the field it means.
var fieldSynonyms = map[string]Field{
	// phone
	"number": FPhone, "numbers": FPhone, "phoneno": FPhone, "phone": FPhone,
	"phonenumber": FPhone, "phonenumbers": FPhone, "simu": FPhone, "mobile": FPhone,
	"contact": FPhone, "contacts": FPhone, "namba": FPhone, "nambayasimu": FPhone,
	"tel": FPhone, "telephone": FPhone, "msisdn": FPhone, "customernumber": FPhone,
	// name
	"name": FName, "names": FName, "fullname": FName, "customername": FName,
	"jina": FName, "majina": FName, "clientname": FName, "client": FName,
	"customer": FName, "jinalamteja": FName,
	// date
	"date": FDate, "calldate": FDate, "callingdate": FDate, "calldates": FDate,
	"1stcalldate": FDate, "datecalled": FDate, "tarehe": FDate, "dates": FDate,
	"leaddate": FDate, "createdtime": FDate, "datereceived": FDate,
	// status
	"status": FStatus, "feedback": FStatus, "1stfeedback": FStatus, "2ndfeedback": FStatus,
	"disposition": FStatus, "response": FStatus, "matokeo": FStatus, "majibu": FStatus,
	"callstatus": FStatus, "leadstatus": FStatus, "remark": FStatus,
	// comment
	"comment": FComment, "comments": FComment, "remarks": FComment, "maoni": FComment,
	"notes": FComment, "note": FComment, "description": FComment, "details": FComment,
	// assigned
	"assignedto": FAssigned, "agent": FAssigned, "agentname": FAssigned, "agents": FAssigned,
	"calledby": FAssigned, "assigned": FAssigned, "officer": FAssigned, "staff": FAssigned,
	"salesagent": FAssigned, "handledby": FAssigned, "dsa": FAssigned,
	// platform
	"platform": FPlatform, "channel": FPlatform, "source": FPlatform, "media": FPlatform,
	"socialmedia": FPlatform, "leadsource": FPlatform, "channels": FPlatform,
	// misc
	"checkno": FCheckNo, "checknumber": FCheckNo, "chequeno": FCheckNo, "checknumbers": FCheckNo,
	"checkno1": FCheckNo,
	"isconverted": FConverted, "converted": FConverted, "conversion": FConverted,
	"loanamount": FAmount, "amount": FAmount, "amountdisbursed": FAmount,
	"disbursedamount": FAmount, "loanamountapplied": FAmount,
	"clienttype": FClientType, "customertype": FClientType, "type": FClientType,
	"product": FProduct, "products": FProduct, "prdtleads": FProduct, "prdt": FProduct,
	"leadtype": FProduct, "adname": FProduct, "ad": FProduct, "campaign": FProduct,
	"region": FRegion, "mkoa": FRegion, "location": FRegion, "area": FRegion,
	"mkoauliyopo": FRegion, "branch": FRegion,
}

// ------------------------------------------------------------------ phone

var tzMobile = regexp.MustCompile(`^255[67]\d{8}$`)

// NormalizePhone maps the many observed spellings (658456107, 255 763 259 559,
// 0712345678, +255712345678) onto 255XXXXXXXXX. The bool reports whether the
// result is a plausible Tanzanian mobile number.
func NormalizePhone(raw string) (string, bool) {
	d := digitsOnly.ReplaceAllString(raw, "")
	if d == "" {
		return "", false
	}
	switch {
	case strings.HasPrefix(d, "255"):
		// leave as-is; may still be the wrong length (we saw 2556760087900)
	case strings.HasPrefix(d, "0"):
		d = "255" + strings.TrimLeft(d, "0")
	case len(d) == 9:
		d = "255" + d
	}
	// A 9-digit local part sometimes arrives with the leading 0 already stripped
	// by the sheet ("658456107" stored as a number).
	if len(d) == 12 && tzMobile.MatchString(d) {
		return d, true
	}
	// Invalid numbers are kept so they can be fixed at source, but the column is
	// bounded — some cells hold a whole run of concatenated digits.
	if len(d) > 30 {
		d = d[:30]
	}
	return d, false
}

// ------------------------------------------------------------------- dates

var monthPrefixes = []string{
	"jan", "feb", "mar", "apr", "may", "jun",
	"jul", "aug", "sep", "oct", "nov", "dec",
}

// swahiliMonths lets "januari", "machi", "agosti" resolve too.
var swahiliMonths = map[string]int{
	"januari": 1, "februari": 2, "machi": 3, "aprili": 4, "mei": 5, "juni": 6,
	"julai": 7, "agosti": 8, "septemba": 9, "oktoba": 10, "novemba": 11, "desemba": 12,
}

var dateSplit = regexp.MustCompile(`[\/\-.\s,]+`)

// monthFromToken resolves a month name by 3-letter prefix, which tolerates the
// truncations and typos in the source data ("augut", "sept", "septemba").
func monthFromToken(tok string) int {
	t := strings.ToLower(strings.TrimSpace(tok))
	if m, ok := swahiliMonths[t]; ok {
		return m
	}
	if len(t) < 3 {
		return 0
	}
	p := t[:3]
	for i, mp := range monthPrefixes {
		if p == mp {
			return i + 1
		}
	}
	return 0
}

// excelEpoch is the serial-date origin used by Sheets/Excel. Because the API is
// read with UNFORMATTED_VALUE, real dates arrive as floats, not strings.
var excelEpoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

// ParseDate handles every format observed in the books: Excel serials,
// 22-Apr-2025, 2/16/2026, 15-09-2025, 2026-07-07 8:04, 7/20/26 and the typo
// 15-augut-2025.
//
// dayFirst controls the dd/mm vs mm/dd reading when both components are <= 12
// (e.g. 05/06/2026). Tanzania writes dd/mm, so callers pass true; the returned
// bool reports whether that ambiguity was actually hit, so the row can be
// flagged rather than silently guessed at.
func ParseDate(raw string, dayFirst bool) (t time.Time, ambiguous bool, ok bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Time{}, false, false
	}

	// Excel/Sheets serial number.
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		if f > 20000 && f < 80000 { // ~1954..2119, excludes phone numbers and amounts
			whole, frac := math.Modf(f)
			d := excelEpoch.AddDate(0, 0, int(whole)).Add(time.Duration(frac * 24 * float64(time.Hour)))
			return d.UTC().Truncate(24 * time.Hour), false, true
		}
		return time.Time{}, false, false
	}

	// Drop a trailing clock component ("2026-07-07 8:04").
	if i := strings.IndexByte(s, ':'); i > 0 {
		if j := strings.LastIndexAny(s[:i], " T"); j > 0 {
			s = s[:j]
		}
	}

	parts := dateSplit.Split(s, -1)
	cleaned := parts[:0]
	for _, p := range parts {
		if p != "" {
			cleaned = append(cleaned, p)
		}
	}
	parts = cleaned
	if len(parts) < 3 {
		return time.Time{}, false, false
	}
	parts = parts[:3]

	var day, month, year int

	// Find an alphabetic month token first ("22-Apr-2025", "15-augut-2025").
	alphaIdx := -1
	for i, p := range parts {
		if _, err := strconv.Atoi(p); err != nil {
			if m := monthFromToken(p); m > 0 {
				month, alphaIdx = m, i
				break
			}
			return time.Time{}, false, false
		}
	}

	nums := make([]int, 0, 3)
	for i, p := range parts {
		if i == alphaIdx {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			return time.Time{}, false, false
		}
		nums = append(nums, n)
	}

	switch {
	case alphaIdx >= 0:
		if len(nums) != 2 {
			return time.Time{}, false, false
		}
		day, year = nums[0], nums[1]
		if alphaIdx == 0 { // "Apr 22 2025"
			day, year = nums[0], nums[1]
		}
	case parts[0] != "" && len(parts[0]) == 4: // ISO 2026-07-07
		year, month, day = nums[0], nums[1], nums[2]
	default:
		a, b := nums[0], nums[1]
		year = nums[2]
		switch {
		case a > 12: // 15/09/2025 — unambiguous dd/mm
			day, month = a, b
		case b > 12: // 2/16/2026 — unambiguous mm/dd
			month, day = a, b
		default: // 05/06/2026 — genuinely ambiguous
			ambiguous = true
			if dayFirst {
				day, month = a, b
			} else {
				month, day = a, b
			}
		}
	}

	if year < 100 { // "7/20/26"
		year += 2000
	}
	if month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100 {
		return time.Time{}, false, false
	}
	d := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if int(d.Month()) != month || d.Day() != day { // rejects 31 Feb
		return time.Time{}, false, false
	}
	return d, ambiguous, true
}

// ------------------------------------------------------------------ status

// statusRules is ordered: the first substring hit wins, so specific phrases are
// listed before the general ones ("do not need loan" before "loan").
var statusRules = []struct {
	needles []string
	code    string
}{
	{[]string{"duplicat", "imejirudia", "same no", "same number"}, StDuplicate},
	{[]string{"wrong number", "wrong no", "namba si sahihi", "sio sahihi"}, StWrongNumber},
	{[]string{"exisiting", "existing", "already a client", "ni mteja"}, StExisting},
	{[]string{"out of region", "nje ya", "outside region"}, StOutOfRegion},
	{[]string{"no affordability", "not qualified", "hajakidhi", "does not qualify", "not eligible"}, StNotQualif},
	{[]string{"convert", "disbursed", "booked", "amechukua"}, StConverted},
	{[]string{"not interested", "hahitaji", "do not need", "doesnt need", "decline", "hataki"}, StNotInterest},
	{[]string{"callback", "call back", "request more time", "followup", "follow up", "atapiga"}, StCallback},
	{[]string{"not reachable", "unreachable", "not picking", "no answer", "failed to connect",
		"switched off", "hapatikani", "haipokelewi", "haipokei", "busy", "mteja hapatikani"}, StNotReach},
	{[]string{"interested", "anahitaji", "qualified for", "wants loan", "amekubali"}, StInterested},
	{[]string{"pending", "hajathibitishwa", "not yet", "in progress", "inaendelea"}, StPending},
}

// CanonicalStatus maps the free-text, mixed-language, mixed-case dispositions
// onto the controlled vocabulary.
func CanonicalStatus(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return StUnknown
	}
	for _, r := range statusRules {
		for _, n := range r.needles {
			if strings.Contains(s, n) {
				return r.code
			}
		}
	}
	return StUnknown
}

// isStatusLike reports whether a value looks like a disposition, used by the
// content-based column inference.
func isStatusLike(s string) bool { return CanonicalStatus(s) != StUnknown }

// ---------------------------------------------------------------- platform

// CanonicalPlatform normalises the channel column (fb/ig/WhatsApp/Whatsapp/
// WebChart/Weblead form/USSD/...).
func CanonicalPlatform(raw string) string {
	s := normKey(raw)
	switch {
	case s == "":
		return "unknown"
	case strings.Contains(s, "facebook") || s == "fb" || strings.Contains(s, "meta"):
		return "facebook"
	case strings.Contains(s, "instagram") || s == "ig" || s == "insta":
		return "instagram"
	case strings.Contains(s, "tiktok") || s == "tt":
		return "tiktok"
	case strings.Contains(s, "whatsapp") || s == "wa":
		return "whatsapp"
	case strings.Contains(s, "ussd"):
		return "ussd"
	case strings.Contains(s, "web") || strings.Contains(s, "website") || strings.Contains(s, "online"):
		return "website"
	case strings.Contains(s, "walkin") || strings.Contains(s, "branch"):
		return "walk_in"
	case strings.Contains(s, "referral") || strings.Contains(s, "refer"):
		return "referral"
	case strings.Contains(s, "call") || strings.Contains(s, "phone"):
		return "call_centre"
	}
	return "other"
}

// ----------------------------------------------------------------- product

// CanonicalProduct derives the product from a product/ad-name cell, falling
// back to the workbook. The "LBF" book also carries MIF ads (MIF Ad 1/2) and
// SME leads, so the book alone is not authoritative.
func CanonicalProduct(raw, bookDefault string) string {
	s := normKey(raw)
	switch {
	case strings.Contains(s, "mif"):
		return "MIF"
	case strings.Contains(s, "lbf") || strings.Contains(s, "logbook"):
		return "LBF"
	case strings.Contains(s, "sme"):
		return "SME"
	case strings.Contains(s, "cs") || strings.Contains(s, "civilservant"):
		return "CS"
	}
	if bookDefault != "" {
		return bookDefault
	}
	return "UNKNOWN"
}

// ------------------------------------------------------- misc value parsing

var truthy = map[string]bool{"yes": true, "y": true, "true": true, "1": true, "ndio": true, "converted": true}

// ParseBool reads the loose yes/no/ndio/1 conventions in the sheets.
func ParseBool(raw string) bool {
	return truthy[strings.ToLower(strings.TrimSpace(raw))]
}

var moneyStrip = regexp.MustCompile(`[^0-9.\-]`)

// maxLoanAmount bounds a plausible loan in TZS (10 billion). Above this the
// value is junk — a concatenated digit run, or a phone number (~2.5e11) that
// would otherwise make a phone column look like a money column to the content
// inference, and overflow the numeric column on insert.
const maxLoanAmount = 1e10

// ParseAmount reads "1,500,000", "TZS 500000", "500000.00".
func ParseAmount(raw string) (float64, bool) {
	s := moneyStrip.ReplaceAllString(raw, "")
	if s == "" || s == "-" || s == "." {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f <= 0 || f > maxLoanAmount {
		return 0, false
	}
	return f, true
}

// --------------------------------------------------- tab classification

var payrollTabs = []string{
	"buy off", "buyoff", "reactivation", "refinance", "new hire",
	"promoted", "new data", "hist data", "historical",
}
var referenceTabs = []string{"branch location", "fx", "lookup", "dropdown"}
var reportTabs = []string{"weekly report", "monthly report", "summary", "dashboard"}

// ClassifyTab decides what a tab actually contains. This is what stops the CS
// book's 51.6k rows of payroll campaign lists (BUY OFF, REACTIVATION, NEW HIRE,
// ...) being counted as inbound social-media leads.
func ClassifyTab(title string, rowCount int) string {
	t := strings.ToLower(strings.TrimSpace(title))
	if rowCount <= 0 {
		return KindEmpty
	}
	for _, k := range reportTabs {
		if strings.Contains(t, k) {
			return KindReport
		}
	}
	for _, k := range referenceTabs {
		if strings.Contains(t, k) {
			return KindReference
		}
	}
	for _, k := range payrollTabs {
		if strings.Contains(t, k) {
			return KindPayroll
		}
	}
	if t == "new" { // CS "NEW" tab is a payroll list, not a social lead log
		return KindPayroll
	}
	return KindSocialLead
}

// ------------------------------------------------------- column mapping

// ColumnMap records where each canonical field lives, plus how it was found.
type ColumnMap struct {
	Idx        [fieldCount]int
	HeaderRow  int  // -1 when the tab has no usable header
	FromHeader int  // fields resolved from header text
	FromData   int  // fields resolved by content inference
	Headerless bool // true when row 0 was a data row / blank
}

func newColumnMap() *ColumnMap {
	cm := &ColumnMap{HeaderRow: -1}
	for i := range cm.Idx {
		cm.Idx[i] = -1
	}
	return cm
}

// Has reports whether a field was located.
func (c *ColumnMap) Has(f Field) bool { return c.Idx[f] >= 0 }

// Get returns the trimmed cell for a field, or "".
func (c *ColumnMap) Get(row []string, f Field) string {
	i := c.Idx[f]
	if i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

// scoreHeaderRow counts how many distinct fields a candidate header row names.
func scoreHeaderRow(row []string) (int, map[Field]int) {
	found := map[Field]int{}
	for i, cell := range row {
		k := normKey(cell)
		if k == "" {
			continue
		}
		if f, ok := fieldSynonyms[k]; ok {
			if _, dup := found[f]; !dup {
				found[f] = i
			}
		}
	}
	return len(found), found
}

// BuildColumnMap locates the header row (scanning the first 10 rows, because
// several tabs carry a title or a stray record above the real header) and then
// fills any field the header did not name by inspecting column content.
func BuildColumnMap(rows [][]string) *ColumnMap {
	cm := newColumnMap()

	bestScore, bestRow := 0, -1
	var bestFound map[Field]int
	limit := 10
	if len(rows) < limit {
		limit = len(rows)
	}
	for r := 0; r < limit; r++ {
		s, found := scoreHeaderRow(rows[r])
		if s > bestScore {
			bestScore, bestRow, bestFound = s, r, found
		}
	}

	// Two or fewer recognised names is not a header — it is a data row that
	// happens to contain a word we know (e.g. "Not reachable").
	if bestScore >= 3 {
		cm.HeaderRow = bestRow
		cm.FromHeader = bestScore
		for f, i := range bestFound {
			cm.Idx[f] = i
		}
	} else {
		cm.Headerless = true
	}

	dataStart := cm.HeaderRow + 1 // 0 when headerless, so row 0 is kept as data
	inferColumnsFromContent(rows, dataStart, cm)
	resolveAgentVsCustomer(rows, dataStart, cm)
	return cm
}

// agentCardinalityRatio is the distinct/total threshold below which a "name"
// column is the call-centre agent rather than the customer.
const agentCardinalityRatio = 0.10

// resolveAgentVsCustomer fixes a mislabelling that runs through the whole CS
// book: its `Names` column holds the AGENT ("YUSTINA", "ROSE", "BAKARI"
// repeated across hundreds of different customers), not the customer. The tell
// is cardinality — a real customer-name column is nearly all distinct values,
// an agent column has a handful repeated thousands of times.
//
// It also recovers the agent from columns the header does not name at all
// (the LBF book's trailing "Column 1" holding "ezekiel" / "anita").
func resolveAgentVsCustomer(rows [][]string, start int, cm *ColumnMap) {
	if start >= len(rows) {
		return
	}
	sample := rows[start:]
	if len(sample) > 500 {
		sample = sample[:500]
	}

	// distinctRatio reports how varied a column is, and how many values it had.
	distinctRatio := func(col int) (float64, int) {
		if col < 0 {
			return 1, 0
		}
		seen := map[string]struct{}{}
		n := 0
		for _, r := range sample {
			if col >= len(r) {
				continue
			}
			v := strings.ToLower(strings.TrimSpace(r[col]))
			if v == "" {
				continue
			}
			seen[v] = struct{}{}
			n++
		}
		if n == 0 {
			return 1, 0
		}
		return float64(len(seen)) / float64(n), n
	}

	if cm.Has(FName) {
		if ratio, n := distinctRatio(cm.Idx[FName]); n >= 20 && ratio < agentCardinalityRatio {
			// It is an agent column, not a customer name.
			if !cm.Has(FAssigned) {
				cm.Idx[FAssigned] = cm.Idx[FName]
			}
			cm.Idx[FName] = -1
		}
	}

	if cm.Has(FAssigned) {
		return
	}

	// Look for an unclaimed, low-cardinality, mostly-alphabetic column — the
	// unlabelled agent column at the end of several LBF tabs.
	taken := map[int]bool{}
	for f := Field(0); f < fieldCount; f++ {
		if cm.Idx[f] >= 0 {
			taken[cm.Idx[f]] = true
		}
	}
	width := 0
	for _, r := range sample {
		if len(r) > width {
			width = len(r)
		}
	}
	for c := 0; c < width; c++ {
		if taken[c] {
			continue
		}
		ratio, n := distinctRatio(c)
		if n < 20 || ratio >= agentCardinalityRatio {
			continue
		}
		alpha := 0
		for _, r := range sample {
			if c < len(r) {
				v := strings.TrimSpace(r[c])
				if v != "" && !strings.ContainsAny(v, "0123456789") {
					alpha++
				}
			}
		}
		if float64(alpha)/float64(n) > 0.8 {
			cm.Idx[FAssigned] = c
			cm.FromData++
			return
		}
	}
}

// inferColumnsFromContent assigns the still-unmapped fields by looking at what
// the values in each column actually are. A column of 9-13 digit numbers is the
// phone column whatever its label says; a column that parses as dates is the
// date column. This is what recovers the tabs with no header at all.
func inferColumnsFromContent(rows [][]string, start int, cm *ColumnMap) {
	if start >= len(rows) {
		return
	}
	sample := rows[start:]
	if len(sample) > 200 {
		sample = sample[:200]
	}

	width := 0
	for _, r := range sample {
		if len(r) > width {
			width = len(r)
		}
	}

	taken := map[int]bool{}
	for f := Field(0); f < fieldCount; f++ {
		if cm.Idx[f] >= 0 {
			taken[cm.Idx[f]] = true
		}
	}

	type score struct{ phone, date, status, money, name int }
	cols := make([]score, width)
	nonEmpty := make([]int, width)

	for _, row := range sample {
		for c := 0; c < width && c < len(row); c++ {
			v := strings.TrimSpace(row[c])
			if v == "" {
				continue
			}
			nonEmpty[c]++
			if _, ok := NormalizePhone(v); ok {
				cols[c].phone++
			}
			if _, _, ok := ParseDate(v, true); ok {
				cols[c].date++
			}
			if isStatusLike(v) {
				cols[c].status++
			}
			if amt, ok := ParseAmount(v); ok && amt >= 10000 {
				cols[c].money++
			}
			if looksLikeName(v) {
				cols[c].name++
			}
		}
	}

	// assign picks the unused column with the best hit-ratio for a field.
	assign := func(f Field, pick func(score) int, minRatio float64) {
		if cm.Idx[f] >= 0 {
			return
		}
		bestC, bestRatio := -1, minRatio
		for c := 0; c < width; c++ {
			if taken[c] || nonEmpty[c] < 3 {
				continue
			}
			ratio := float64(pick(cols[c])) / float64(nonEmpty[c])
			if ratio > bestRatio {
				bestC, bestRatio = c, ratio
			}
		}
		if bestC >= 0 {
			cm.Idx[f] = bestC
			taken[bestC] = true
			cm.FromData++
		}
	}

	// Most-specific first so the phone column is claimed before "name".
	assign(FPhone, func(s score) int { return s.phone }, 0.5)
	assign(FDate, func(s score) int { return s.date }, 0.5)
	assign(FStatus, func(s score) int { return s.status }, 0.35)
	assign(FAmount, func(s score) int { return s.money }, 0.5)
	assign(FName, func(s score) int { return s.name }, 0.5)
}

// isAllDigits reports whether a value is nothing but digits and spacing, which
// is how a stray phone number shows up in the customer-name column.
func isAllDigits(s string) bool {
	hasDigit := false
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			hasDigit = true
		case r == ' ' || r == '-' || r == '+':
			// separators are fine
		default:
			return false
		}
	}
	return hasDigit
}

var nameWord = regexp.MustCompile(`^[\p{L}][\p{L}'.\-]*$`)

// looksLikeName accepts 2-4 alphabetic words, which is how people are recorded
// in these books, and rejects the numeric junk that contaminates some columns.
func looksLikeName(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 4 || len(s) > 60 {
		return false
	}
	if digitsOnly.ReplaceAllString(s, "") != "" && strings.ContainsAny(s, "0123456789") {
		return false
	}
	words := strings.Fields(s)
	if len(words) < 2 || len(words) > 4 {
		return false
	}
	for _, w := range words {
		if !nameWord.MatchString(w) {
			return false
		}
	}
	return true
}

// ------------------------------------------------------------ row cleaning

// CleanRow is one cleaned lead ready for insert.
type CleanRow struct {
	Product     string
	Platform    string
	TabKind     string
	Name        string
	CheckNo     string
	Date        *time.Time
	Month       string
	AssignedTo  string
	PhoneE164   string
	PhoneRaw    string
	PhoneValid  bool
	StatusRaw   string
	StatusCanon string
	Comment     string
	IsConverted bool
	Amount      *float64
	ClientType  string
	Region      string
	SourceBook  string
	SourceTab   string
	SourceRow   int
	RowHash     string
	Issues      []string
}

// CleanOpts controls parsing decisions the data itself cannot settle.
type CleanOpts struct {
	Book     string // LBF | CS | SME
	Tab      string
	TabKind  string
	DayFirst bool // dd/mm reading for ambiguous dates (Tanzanian convention)
}

// CleanRowFrom converts one raw sheet row into a CleanRow. rowNum is 1-based.
// The row is always returned; problems are reported in Issues rather than by
// rejecting the record.
func CleanRowFrom(row []string, cm *ColumnMap, rowNum int, opt CleanOpts) (CleanRow, bool) {
	out := CleanRow{
		TabKind:    opt.TabKind,
		SourceBook: opt.Book,
		SourceTab:  opt.Tab,
		SourceRow:  rowNum,
		Issues:     []string{},
	}

	out.Name = cm.Get(row, FName)
	out.CheckNo = cm.Get(row, FCheckNo)
	out.AssignedTo = cm.Get(row, FAssigned)
	out.Comment = cm.Get(row, FComment)
	out.ClientType = cm.Get(row, FClientType)
	out.StatusRaw = cm.Get(row, FStatus)
	out.PhoneRaw = cm.Get(row, FPhone)

	// A row with nothing in any meaningful column is padding, not a lead.
	if strings.TrimSpace(strings.Join(row, "")) == "" {
		return out, false
	}

	// phone
	if out.PhoneRaw == "" {
		out.Issues = append(out.Issues, IssNoPhone)
	} else if e164, ok := NormalizePhone(out.PhoneRaw); ok {
		out.PhoneE164, out.PhoneValid = e164, true
	} else {
		out.PhoneE164 = e164
		out.Issues = append(out.Issues, IssBadPhone)
	}

	// date
	if raw := cm.Get(row, FDate); raw != "" {
		if d, amb, ok := ParseDate(raw, opt.DayFirst); ok {
			if plausibleLeadDate(d) {
				out.Date = &d
				out.Month = d.Format("2006-01")
				if amb {
					out.Issues = append(out.Issues, IssAmbiguousDay)
				}
			} else {
				// Parsed cleanly but cannot be real (e.g. 2040) — a source typo.
				out.Issues = append(out.Issues, IssDateOutRange)
			}
		} else {
			out.Issues = append(out.Issues, IssNoDate)
			// A phone number sitting in a date column is the contamination we
			// saw in CALLBACK DATE.
			if _, ok := NormalizePhone(raw); ok {
				out.Issues = append(out.Issues, IssContaminated)
			}
		}
	} else {
		out.Issues = append(out.Issues, IssNoDate)
	}

	// status
	out.StatusCanon = CanonicalStatus(out.StatusRaw)
	if out.StatusRaw == "" {
		out.Issues = append(out.Issues, IssNoStatus)
	} else if out.StatusCanon == StUnknown && out.Comment != "" {
		// Several months put the disposition only in the Swahili comment.
		out.StatusCanon = CanonicalStatus(out.Comment)
	}

	// A phone number sitting in the name column is contamination, not a name.
	if out.Name != "" && isAllDigits(out.Name) {
		out.Issues = append(out.Issues, IssContaminated)
		out.Name = ""
	}
	if out.Name == "" {
		out.Issues = append(out.Issues, IssNoName)
	}

	out.Platform = CanonicalPlatform(cm.Get(row, FPlatform))
	out.Product = CanonicalProduct(cm.Get(row, FProduct), opt.Book)

	// region — reject the contamination seen in mkoa_uliyopo (numbers, names)
	if reg := cm.Get(row, FRegion); reg != "" {
		if _, isNum := ParseAmount(reg); isNum {
			out.Issues = append(out.Issues, IssContaminated)
		} else {
			out.Region = reg
		}
	}

	out.IsConverted = ParseBool(cm.Get(row, FConverted)) || out.StatusCanon == StConverted
	if amt, ok := ParseAmount(cm.Get(row, FAmount)); ok {
		out.Amount = &amt
	}

	out.RowHash = rowHash(opt.Book, opt.Tab, rowNum, row)
	return out, true
}

// rowHash makes re-ingesting idempotent: the same source cell content in the
// same place produces the same hash, and the unique index absorbs the repeat.
func rowHash(book, tab string, rowNum int, row []string) string {
	h := sha256sum(fmt.Sprintf("%s|%s|%d|%s", book, tab, rowNum, strings.Join(row, "")))
	return h
}
