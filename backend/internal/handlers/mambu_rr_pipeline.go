package handlers

// Refinance and reactivation — the Go port of process_refinance.py and
// process_reactivation.py.
//
// REFINANCE reads the Loan Accounts export and asks: who is far enough through
// their current loan to be worth topping up? One row per person (deduped on
// Account Holder Name), under 64, and at least 30% of the way through their
// installments.
//
// REACTIVATION reads the Clients export and asks: who left and could come back?
// Clients created in a chosen window, deduped on Full Name, under 64, with
// anyone in Collections dropped.
//
// Both then enrich each row with its Cluster, Team Leader and TL contact from
// the live roster, drop anyone on the do-not-contact list, and split the result
// into workbooks by branch, cluster and zone.

import (
	"fmt"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Product codes. AGRI is new: the old scripts had no Agrifinance path, so its
// rows fell into CS and a "Tukuyu" folder was written by hand alongside.
const (
	ProdCS   = "CS"
	ProdLBF  = "LBF"
	ProdSME  = "SME"
	ProdAGRI = "Agrifinance"
)

// rrFunnel records what each filter removed, so the operator can see where the
// rows went rather than just the final count.
type rrFunnel struct {
	Loaded          int `json:"loaded"`
	AfterDateFilter int `json:"afterDateFilter,omitempty"`
	AfterDedupe     int `json:"afterDedupe"`
	AfterAge        int `json:"afterAge"`
	AfterTenure     int `json:"afterTenure,omitempty"`
	AfterCollection int `json:"afterCollections,omitempty"`
}

// rrProductResult is one product's outcome.
type rrProductResult struct {
	Product     string   `json:"product"`
	Rows        int      `json:"rows"`
	Allocated   int      `json:"allocated"`
	Unallocated int      `json:"unallocated"`
	DNCRemoved  int      `json:"dncRemoved"`
	BranchFiles int      `json:"branchFiles"`
	ClusterFile int      `json:"clusterFiles"`
	ZoneFiles   int      `json:"zoneFiles"`
	NoRecipient []string `json:"branchesWithNoRecipient,omitempty"`

	files      []rrOutFile // built workbooks, for zipping
	fileErrors []string    // workbooks that could not be written, with the reason
}

// Scopes a built workbook can have. These decide which Distribute button
// picks the file up.
const (
	ScopeFull          = "FULL"
	ScopeUnallocated   = "UNALLOCATED"    // one file, to the call centre
	ScopeUnallocBranch = "UNALLOC_BRANCH" // no call centre: split back to branches
	ScopeBranch        = "BRANCH"
	ScopeCluster       = "CLUSTER"
	ScopeZone          = "ZONE"
)

// rrOutFile is one built workbook plus everything needed to send it later.
//
// Recipients are resolved HERE, at build time, and stored — not recomputed
// when somebody presses Distribute. The roster can change between building a
// report and sending it, and the file that goes out must match the file that
// was reviewed.
type rrOutFile struct {
	RelPath string // path inside the zip
	Data    []byte

	Scope   string
	Name    string // branch / cluster / zone name
	Cluster string // for BRANCH files: the cluster it rolls up into
	Rows    int
	Emails  []string
	Names   []string
}

// recipientEmails pulls the deliverable addresses out of a roster pool.
func recipientEmails(pool []ZonePerson) ([]string, []string) {
	var emails, names []string
	seenE, seenN := map[string]bool{}, map[string]bool{}
	for _, p := range pool {
		e := strings.TrimSpace(p.Email)
		if e != "" && strings.Contains(e, "@") && !seenE[strings.ToLower(e)] {
			seenE[strings.ToLower(e)] = true
			emails = append(emails, e)
		}
		if p.Name != "" && !seenN[p.Name] {
			seenN[p.Name] = true
			names = append(names, p.Name)
		}
	}
	return emails, names
}

// lbfLoanPattern — the LBF loan products, as the original regex had them.
var lbfLoanNames = []string{"v4-lbf", "v5-lbf", "v6-lbf", "v7-lbf", "v8-lbf"}

func containsAnyFold(hay string, needles []string) bool {
	h := strings.ToLower(hay)
	for _, n := range needles {
		if strings.Contains(h, n) {
			return true
		}
	}
	return false
}

func containsFold(hay, needle string) bool {
	return strings.Contains(strings.ToLower(hay), strings.ToLower(needle))
}

// classifyRefinance decides a loan row's product.
//
// Order matters and is deliberate. LBF wins first (an LBF loan or an LBF
// branch). Agrifinance is next: in the export every Agri loan sits in the
// Tukuyu branch and every Tukuyu loan is an Agri loan, so either test alone
// would do — both are checked so a new Agri branch or a Tukuyu non-Agri loan
// still lands somewhere sensible. SME follows, and CS takes the remainder.
//
// This is the one behavioural change from the Python: Agri rows used to fall
// into CS, so CS totals drop by however many Agri rows the export holds.
func classifyRefinance(loanName, branch string) string {
	isLBF := containsAnyFold(loanName, lbfLoanNames) || containsFold(branch, "lbf")
	if isLBF {
		return ProdLBF
	}
	if containsFold(loanName, "agri") || zoneKey(branch) == "TUKUYU" {
		return ProdAGRI
	}
	if containsFold(loanName, "sme") || containsFold(branch, "sme") {
		return ProdSME
	}
	return ProdCS
}

// classifyReactivation has only the branch to go on — the Clients export
// carries no loan product.
func classifyReactivation(branch string) string {
	if containsFold(branch, "lbf") {
		return ProdLBF
	}
	if zoneKey(branch) == "TUKUYU" {
		return ProdAGRI
	}
	if containsFold(branch, "sme") {
		return ProdSME
	}
	return ProdCS
}

// isUnallocated — nobody owns this client. The export writes the sales rep as
// "UNALLOCATED GEITA" and similar, so a prefix match on "unallo" is what the
// original used and what the data still looks like.
func isUnallocatedRow(t *rrTable, row []string) bool {
	for _, c := range []string{"Sales Reps", "Sales Reps (Client)", "Team Leader"} {
		if v := t.Get(row, c); v != "" && containsFold(v, "unallo") {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Refinance
// ---------------------------------------------------------------------------

type rrRunInput struct {
	Mode     string // REFINANCE | REACTIVATION
	Products []string
	DateFrom time.Time
	DateTo   time.Time
	Today    time.Time
	DNC      map[string]bool
	ZC       *ZoneClusters
}

type rrRunOutput struct {
	Funnel   rrFunnel
	Products []*rrProductResult
	Warnings []string
}

func buildRefinance(t *rrTable, in rrRunInput) (*rrRunOutput, error) {
	for _, need := range []string{"Account Holder Name", "Branch", "Birth Date (Client)"} {
		if !t.Has(need) {
			return nil, fmt.Errorf("the Loan file has no %q column — is this a Loan Accounts export?", need)
		}
	}

	out := &rrRunOutput{}
	out.Funnel.Loaded = t.Len()

	// Step 1 — one row per person.
	t = t.DedupeBy("Account Holder Name")
	out.Funnel.AfterDedupe = t.Len()

	// Step 2 — Age, Active Month, Tenure of Completion, then the two filters.
	t.AddCol("Age")
	t.AddCol("Active Month")
	t.AddCol("Tenure of Completion")

	for i, r := range t.Rows {
		if b, ok := parseRRDate(t.Get(r, "Birth Date (Client)")); ok {
			r = t.Set(r, "Age", strconv.Itoa(ageOn(b, in.Today)))
		}
		months := -1
		if a, ok := parseRRDate(t.Get(r, "Activation Date")); ok {
			months = monthsBetween(a, in.Today)
			r = t.Set(r, "Active Month", strconv.Itoa(months))
		}
		if inst, ok := parseRRFloat(t.Get(r, "Number of Installments")); ok && inst > 0 && months >= 0 {
			r = t.Set(r, "Tenure of Completion",
				strconv.FormatFloat(float64(months)/inst, 'f', 4, 64))
		}
		t.Rows[i] = r
	}

	// Age must be present AND under 64 — a missing birth date is not a pass.
	t = t.Filter(func(r []string) bool {
		a, ok := parseRRFloat(t.Get(r, "Age"))
		return ok && a < 64
	})
	out.Funnel.AfterAge = t.Len()

	// Tenure: blank passes (the original kept unknowns), otherwise >= 30%.
	t = t.Filter(func(r []string) bool {
		v := t.Get(r, "Tenure of Completion")
		if v == "" {
			return true
		}
		f, ok := parseRRFloat(v)
		return !ok || f >= 0.30
	})
	out.Funnel.AfterTenure = t.Len()

	// Step 3 — split by product.
	byProduct := map[string]*rrTable{}
	for _, code := range []string{ProdCS, ProdLBF, ProdSME, ProdAGRI} {
		byProduct[code] = newTable(t.Cols)
	}
	for _, r := range t.Rows {
		code := classifyRefinance(t.Get(r, "Loan Name"), t.Get(r, "Branch"))
		byProduct[code].Rows = append(byProduct[code].Rows, r)
	}

	// SME drops anything Credit has marked not recommended.
	if sme := byProduct[ProdSME]; sme.Has("SME Refinance Remarks") {
		byProduct[ProdSME] = sme.Filter(func(r []string) bool {
			return !containsFold(sme.Get(r, "SME Refinance Remarks"), "not recommended")
		})
	}

	cols := []string{"Account Holder Name", "Branch", "Cluster", "Team Leader",
		"Sales Reps", "Mobile Phone (Client)", "TL_Contact"}
	smeCols := []string{"Account Holder Name", "Branch", "Cluster", "Team Leader",
		"Sales Reps", "SME Refinance Remarks", "Mobile Phone (Client)", "TL_Contact"}

	for _, code := range in.Products {
		src := byProduct[code]
		if src == nil {
			continue
		}
		want := cols
		if code == ProdSME {
			want = smeCols
		}
		res, warns := finalizeProduct(src, code, "Refinance", "Mobile Phone (Client)", want, in)
		out.Products = append(out.Products, res)
		out.Warnings = append(out.Warnings, warns...)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Reactivation
// ---------------------------------------------------------------------------

func buildReactivation(t *rrTable, in rrRunInput) (*rrRunOutput, error) {
	for _, need := range []string{"Full Name", "Branch", "Birth Date", "Created"} {
		if !t.Has(need) {
			return nil, fmt.Errorf("the Client file has no %q column — is this a Clients export?", need)
		}
	}

	out := &rrRunOutput{}
	out.Funnel.Loaded = t.Len()

	// Step 1 — the Created window, then one row per person.
	t = t.Filter(func(r []string) bool {
		d, ok := parseRRDate(t.Get(r, "Created"))
		if !ok {
			return false
		}
		day := d.Truncate(24 * time.Hour)
		return !day.Before(in.DateFrom) && !day.After(in.DateTo)
	})
	out.Funnel.AfterDateFilter = t.Len()

	t = t.DedupeBy("Full Name")
	out.Funnel.AfterDedupe = t.Len()

	// Step 2 — age.
	t.AddCol("Age")
	for i, r := range t.Rows {
		if b, ok := parseRRDate(t.Get(r, "Birth Date")); ok {
			r = t.Set(r, "Age", strconv.Itoa(ageOn(b, in.Today)))
		}
		t.Rows[i] = r
	}
	t = t.Filter(func(r []string) bool {
		a, ok := parseRRFloat(t.Get(r, "Age"))
		return ok && a < 64
	})
	out.Funnel.AfterAge = t.Len()

	// Step 3 — split by product, then drop anyone in Collections.
	byProduct := map[string]*rrTable{}
	for _, code := range []string{ProdCS, ProdLBF, ProdSME, ProdAGRI} {
		byProduct[code] = newTable(t.Cols)
	}
	for _, r := range t.Rows {
		code := classifyReactivation(t.Get(r, "Branch"))
		byProduct[code].Rows = append(byProduct[code].Rows, r)
	}

	// "Collections" can appear in any column, so the original scanned the whole
	// row. Kept as-is: a client in collections must not be called for a new loan.
	total := 0
	for code, tab := range byProduct {
		byProduct[code] = tab.Filter(func(r []string) bool {
			for _, v := range r {
				if containsFold(v, "collections") {
					return false
				}
			}
			return true
		})
		total += byProduct[code].Len()
	}
	out.Funnel.AfterCollection = total

	cols := []string{"Full Name", "Created", "Branch", "Cluster", "Team Leader",
		"Sales Reps", "Mobile Phone", "TL_Contact"}

	for _, code := range in.Products {
		src := byProduct[code]
		if src == nil {
			continue
		}
		res, warns := finalizeProduct(src, code, "Reactivation", "Mobile Phone", cols, in)
		out.Products = append(out.Products, res)
		out.Warnings = append(out.Warnings, warns...)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Shared: enrich, drop do-not-contact, distribute, write workbooks
// ---------------------------------------------------------------------------

func finalizeProduct(src *rrTable, product, label, phoneCol string,
	wantCols []string, in rrRunInput) (*rrProductResult, []string) {

	res := &rrProductResult{Product: product}
	var warnings []string
	zc := in.ZC

	// Enrich: Cluster from the branch map, Team Leader and TL contact from the
	// roster. Done before the column projection so the projection can keep them.
	clusterOf := zc.ClusterForBranch(product)
	tlOf := zc.TeamLeadersByBranch(product)
	contactOf := zc.TLContactByBranch(product)

	src.AddCol("Cluster")
	src.AddCol("Team Leader")
	src.AddCol("TL_Contact")
	for i, r := range src.Rows {
		b := src.Get(r, "Branch")
		r = src.Set(r, "Cluster", clusterOf[zoneKey(b)])
		r = src.Set(r, "Team Leader", tlOf[zoneKey(b)])
		r = src.Set(r, "TL_Contact", contactOf(b))
		src.Rows[i] = r
	}

	t := src.SelectCols(wantCols...)

	// Normalise client phones so the do-not-contact match is like-for-like.
	if pi := t.Col(phoneCol); pi >= 0 {
		for i, r := range t.Rows {
			if pi < len(r) {
				r[pi] = rrNormalisePhone(r[pi])
				t.Rows[i] = r
			}
		}
	}

	// Drop the do-not-contact numbers, keeping them for the FULL workbook's
	// audit sheet — being able to show WHY somebody was dropped matters when
	// a manager asks where their client went.
	removed := newTable(t.Cols)
	if len(in.DNC) > 0 && t.Has(phoneCol) {
		kept := newTable(t.Cols)
		for _, r := range t.Rows {
			if in.DNC[t.Get(r, phoneCol)] {
				removed.Rows = append(removed.Rows, r)
			} else {
				kept.Rows = append(kept.Rows, r)
			}
		}
		t = kept
	}
	res.DNCRemoved = removed.Len()
	res.Rows = t.Len()

	if t.Len() == 0 {
		warnings = append(warnings, fmt.Sprintf("%s: no rows survived the filters — no files written.", product))
		return res, warnings
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	base := fmt.Sprintf("%s_%s", label, product)

	// FULL — every row assigned within its own branch.
	fullDist, fullSummary, noRecip := distributeByBranch(t, zc, product, rng)
	res.NoRecipient = noRecip
	res.addWorkbook(rrOutFile{
		RelPath: fmt.Sprintf("%s/%s_FULL.xlsx", base, base),
		Scope:   ScopeFull, Name: product, Rows: t.Len(),
	}, fullSummary, fullDist, t, removed)

	// UNALLOCATED — nobody owns these, so they go to the call centre. They stay
	// in FULL but are excluded from the branch/cluster/zone splits, so a branch
	// is never handed a client it does not own.
	unalloc := t.Filter(func(r []string) bool { return isUnallocatedRow(t, r) })
	alloc := t.Filter(func(r []string) bool { return !isUnallocatedRow(t, r) })
	res.Unallocated, res.Allocated = unalloc.Len(), alloc.Len()

	// Where the product HAS a call centre (LBF has LBF_CC, CS has CS_CC) the
	// unallocated clients go there as one file. Where it does not (SME,
	// Agrifinance) there is nobody central to call them, so they are split back
	// to the branch each client actually belongs to.
	hasCallCentre := len(filterClass(zc.peopleWhere(func(p ZonePerson) bool {
		return p.ProductKey == zoneKey(product)
	}), "agent")) > 0

	uDist, uSummary := distributePool(unalloc, zc.CallCentrePeople(product), rng)
	uRecips := zc.UnallocatedRecipients(product)
	uSummary = markRecipients(uSummary, uRecips)
	uEmails, uNames := recipientEmails(uRecips)
	uMeta := rrOutFile{
		RelPath: fmt.Sprintf("%s/%s_UNALLOCATED.xlsx", base, base),
		Scope:   ScopeUnallocated, Name: product + " unallocated",
		Rows: unalloc.Len(), Emails: uEmails, Names: uNames,
	}
	if !hasCallCentre {
		// Still written for download and review, but not something to send as
		// one lump — the per-branch files below are what gets distributed.
		uMeta.Scope = ScopeFull
		uMeta.Emails, uMeta.Names = nil, nil
	}
	res.addWorkbook(uMeta, uSummary, uDist, unalloc, nil)

	if !hasCallCentre && unalloc.Len() > 0 {
		for _, br := range distinctValues(unalloc, "Branch") {
			sub := unalloc.Filter(func(r []string) bool { return unalloc.Get(r, "Branch") == br })
			name := br
			if name == "" {
				name = "Unknown branch"
			}
			safe := safeFileName(name)
			if safe == "" {
				continue
			}
			pool := zc.PeopleForBranch(product, br)
			d, sm := distributePool(sub, pool, rng)
			sm = markRecipients(sm, pool)
			emails, names := recipientEmails(pool)
			res.addWorkbook(rrOutFile{
				RelPath: fmt.Sprintf("%s/Unallocated_By_Branch/%s_Unallocated_%s.xlsx", base, label, safe),
				Scope:   ScopeUnallocBranch, Name: name, Rows: sub.Len(),
				Emails: emails, Names: names,
			}, sm, d, sub, nil)
		}
	}

	// By branch.
	for _, br := range distinctValues(alloc, "Branch") {
		sub := alloc.Filter(func(r []string) bool { return alloc.Get(r, "Branch") == br })
		safe := safeFileName(br)
		if safe == "" {
			continue
		}
		pool := zc.PeopleForBranch(product, br)
		d, s := distributePool(sub, pool, rng)
		s = markRecipients(s, pool)
		emails, names := recipientEmails(pool)
		res.addWorkbook(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Branch/%s_%s.xlsx", base, label, safe),
			Scope:   ScopeBranch, Name: br, Cluster: clusterOf[zoneKey(br)],
			Rows: sub.Len(), Emails: emails, Names: names,
		}, s, d, sub, nil)
		res.BranchFiles++
	}

	// By cluster.
	for _, cl := range distinctValues(alloc, "Cluster") {
		name := cl
		if name == "" {
			name = "Unknown"
		}
		sub := alloc.Filter(func(r []string) bool { return alloc.Get(r, "Cluster") == cl })
		safe := safeFileName(name)
		if safe == "" {
			continue
		}
		var pool, recips []ZonePerson
		if cl != "" {
			pool = zc.PeopleForCluster(product, cl)
			recips = zc.ClusterRecipients(product, cl)
		}
		d, s := distributePool(sub, pool, rng)
		s = markRecipients(s, recips)
		emails, names := recipientEmails(recips)
		res.addWorkbook(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Cluster/%s_%s.xlsx", base, label, safe),
			Scope:   ScopeCluster, Name: name, Rows: sub.Len(),
			Emails: emails, Names: names,
		}, s, d, sub, nil)
		res.ClusterFile++
	}

	// By zone — rows still assigned per-branch inside the zone, addressed to
	// the zone's manager.
	zoneOf := zc.ZoneForBranch(product)
	zoneRows := map[string]*rrTable{}
	for _, r := range alloc.Rows {
		z := zoneOf[zoneKey(alloc.Get(r, "Branch"))]
		if z == "" {
			z = "Unknown"
		}
		if zoneRows[z] == nil {
			zoneRows[z] = newTable(alloc.Cols)
		}
		zoneRows[z].Rows = append(zoneRows[z].Rows, r)
	}
	for _, z := range sortedKeys(zoneRows) {
		sub := zoneRows[z]
		safe := safeFileName(z)
		if safe == "" {
			continue
		}
		d, s, _ := distributeByBranch(sub, zc, product, rng)
		var zEmails, zNames []string
		if z != "Unknown" {
			zr := zc.ZoneRecipients(product, z)
			s = markRecipients(s, zr)
			zEmails, zNames = recipientEmails(zr)
		}
		res.addWorkbook(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Zone/%s_%s.xlsx", base, label, safe),
			Scope:   ScopeZone, Name: z, Rows: sub.Len(),
			Emails: zEmails, Names: zNames,
		}, s, d, sub, nil)
		res.ZoneFiles++
	}

	if len(noRecip) > 0 {
		warnings = append(warnings, fmt.Sprintf(
			"%s: %d branch(es) have nobody on the roster to assign to — %s.",
			product, len(noRecip), strings.Join(noRecip, ", ")))
	}
	if len(res.fileErrors) > 0 {
		warnings = append(warnings, fmt.Sprintf(
			"%s: %d workbook(s) could not be written and are MISSING from the zip — %s.",
			product, len(res.fileErrors), strings.Join(res.fileErrors, "; ")))
	}
	return res, warnings
}

func distinctValues(t *rrTable, col string) []string {
	seen := map[string]bool{}
	var out []string
	for _, r := range t.Rows {
		v := t.Get(r, col)
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}

func sortedKeys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func safeFileName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == ' ', r == '-', r == '_':
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}
