package handlers

// Running the CS affordability report.
//
// Produces one folder per group (Refinance / Reactivation / New), each with the
// full list, the qualified subset, the whitelist subset, and a workbook per
// branch and per cluster. The per-branch and per-cluster files carry only
// qualified rows — a branch is given people it can actually lend to.
//
// The run is recorded in the same tables as the LBF/SME refinance runs, so the
// existing Distribute to Branch / Cluster buttons work on it unchanged.

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

type csRunRequest struct {
	Groups []string `json:"groups"` // Refinance | Reactivation | New
}

func normaliseCSGroup(s string) string {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "REFINANCE":
		return GroupRefinance
	case "REACTIVATION":
		return GroupReactivation
	case "NEW":
		return GroupNew
	}
	return ""
}

// RunCSAffordability — POST /api/mambu/cs/run
func RunCSAffordability(c *gin.Context) {
	var req csRunRequest
	_ = c.ShouldBindJSON(&req)

	groups := []string{}
	seen := map[string]bool{}
	for _, g := range req.Groups {
		if code := normaliseCSGroup(g); code != "" && !seen[code] {
			seen[code] = true
			groups = append(groups, code)
		}
	}
	if len(groups) == 0 {
		groups = []string{GroupRefinance, GroupReactivation, GroupNew}
	}

	// The register is the one thing without which nothing can be computed.
	var employees int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM mambu_employees`).Scan(&employees); err != nil || employees == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "The employee register is empty — upload an employee extract first."})
		return
	}

	instBatch, err := activeCSBatch("INST")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	loanBatch, err := activeCSBatch("CS_LOAN")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if !loanBatch.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "No CS loan batch is active. Without it nobody can be told apart as " +
				"Refinance, Reactivation or New — everyone would come out as New."})
		return
	}

	rrJob.mu.Lock()
	if rrJob.running {
		id := rrJob.runID
		rrJob.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false,
			"error": "A run is already in progress.", "runId": id})
		return
	}
	runID := uuid.New()
	rrJob.running, rrJob.runID = true, runID
	rrJob.mu.Unlock()

	var runBy interface{}
	if v, ok := c.Get("userID"); ok {
		runBy = v
	}
	if _, err := database.DB.Exec(
		`INSERT INTO mambu_rr_runs (id, mode, products, run_by)
		 VALUES ($1,'CS_AFFORDABILITY',$2,$3)`,
		runID, strings.Join(groups, ","), runBy); err != nil {
		rrJob.mu.Lock()
		rrJob.running = false
		rrJob.mu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	go runCSJob(runID, groups, instBatch, loanBatch)

	warn := ""
	if !instBatch.Valid {
		warn = " No deductions batch is active, so nobody's existing deductions are " +
			"being counted and affordability will be overstated."
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "runId": runID, "groups": groups,
		"message": "Run started. The register is large, so this takes a few minutes." + warn,
	})
}

func runCSJob(runID uuid.UUID, groups []string, instBatch, loanBatch sql.NullString) {
	defer func() {
		rrJob.mu.Lock()
		rrJob.running = false
		rrJob.mu.Unlock()
	}()

	fail := func(err error) {
		database.DB.Exec(
			`UPDATE mambu_rr_runs SET status='FAILED', error=$2, finished_at=now() WHERE id=$1`,
			runID, err.Error())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	zc, err := LoadZoneClusters(ctx, true)
	if err != nil {
		fail(err)
		return
	}

	today := time.Now()
	people, counts, err := loadCSPeople(csRunInputs{
		InstBatch: instBatch, LoanBatch: loanBatch, Today: today, ZC: zc,
	})
	if err != nil {
		fail(err)
		return
	}
	if len(people) == 0 {
		fail(fmt.Errorf("the employee register produced no rows"))
		return
	}

	branchStats := assignBranches(people, zc)
	for _, p := range people {
		computeAffordability(p, today)
	}

	// Split into the requested groups.
	wanted := map[string]bool{}
	for _, g := range groups {
		wanted[g] = true
	}
	byGroup := map[string][]*csPerson{}
	for _, p := range people {
		if wanted[p.Group] {
			byGroup[p.Group] = append(byGroup[p.Group], p)
		}
	}

	out := &rrRunOutput{}
	out.Funnel.Loaded = len(people)
	for _, g := range groups {
		res := buildCSGroup(g, byGroup[g], zc)
		out.Products = append(out.Products, res)
		if len(res.NoRecipient) > 0 {
			out.Warnings = append(out.Warnings, fmt.Sprintf(
				"%s: %d branch(es) have nobody on the CS roster to send to.",
				g, len(res.NoRecipient)))
		}
		if len(res.fileErrors) > 0 {
			out.Warnings = append(out.Warnings, fmt.Sprintf(
				"%s: %d workbook(s) could not be written and are MISSING from the zip — %s.",
				g, len(res.fileErrors), strings.Join(res.fileErrors, "; ")))
		}
	}

	if !instBatch.Valid {
		out.Warnings = append(out.Warnings,
			"No deductions batch was active, so existing salary deductions were not "+
				"counted. Affordability is overstated — activate an Inst batch and run again.")
	}
	if n := branchStats["branchUnknown"]; n > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf(
			"%s people have no branch and are grouped under \"Unknown branch\" — they "+
				"cannot be distributed until their employer appears in the loan file.",
			formatThousands(n)))
	}

	zipRel, zipSize, err := writeCSZip(runID, out, counts, branchStats)
	if err != nil {
		fail(err)
		return
	}
	if err := saveRunFiles(runID, out); err != nil {
		fail(fmt.Errorf("recording the run's files: %w", err))
		return
	}

	rowsOut := 0
	for _, p := range out.Products {
		rowsOut += p.Allocated
	}
	stats, _ := json.Marshal(gin.H{
		"funnel": out.Funnel, "products": out.Products,
		"groupCounts": counts, "branches": branchStats,
	})

	if _, err := database.DB.Exec(
		`UPDATE mambu_rr_runs
		    SET status='DONE', rows_in=$2, rows_out=$3, stats=$4, warnings=$5,
		        zip_path=$6, zip_size=$7, finished_at=now()
		  WHERE id=$1`,
		runID, len(people), rowsOut, stats,
		strings.Join(out.Warnings, "\n"), zipRel, zipSize); err != nil {
		fail(err)
	}
}

func writeCSZip(runID uuid.UUID, out *rrRunOutput, counts map[string]int,
	branchStats map[string]int) (string, int64, error) {

	dir := filepath.Join(mambuRoot(), "mambu", "runs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	name := fmt.Sprintf("CS_Affordability_%s_%s.zip",
		time.Now().Format("2006-01-02"), runID.String()[:8])
	rel := filepath.Join("mambu", "runs", name)

	f, err := os.Create(filepath.Join(mambuRoot(), rel))
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	for _, p := range out.Products {
		for _, file := range p.files {
			w, err := zw.Create(file.RelPath)
			if err != nil {
				zw.Close()
				return "", 0, err
			}
			if _, err := w.Write(file.Data); err != nil {
				zw.Close()
				return "", 0, err
			}
		}
	}
	if w, err := zw.Create("README.txt"); err == nil {
		w.Write([]byte(csReadme(counts, out.Products, branchStats)))
	}
	if err := zw.Close(); err != nil {
		return "", 0, err
	}

	info, _ := os.Stat(filepath.Join(mambuRoot(), rel))
	var size int64
	if info != nil {
		size = info.Size()
	}
	return rel, size, nil
}

// csGroupFolder is the folder each group's files sit in.
func csGroupFolder(group string) string { return "CS_" + group }

// The columns each group's main workbook carries, in the master files' order.
func csMainCols(group string) []string {
	base := []string{"Vote Name", "Check Number", "Full Name", "Confirmation Date",
		"Phone", "Job Title", "Branch", "Cluster"}
	if group == GroupRefinance {
		return append(base, "Current Installment", "Loan Balance",
			"Net Loan Before Refinance", "Net Loan After Refinance")
	}
	return append(base, "Loan Amount")
}

func csRowFor(p *csPerson, group string) []string {
	money := func(f float64) string {
		return strconv.FormatFloat(math.Round(f*100)/100, 'f', 2, 64)
	}
	row := []string{p.VoteName, p.CheckNumber, p.FullName, p.ConfirDate,
		p.Phone, p.JobTitle, p.Branch, p.Cluster}
	if group == GroupRefinance {
		return append(row, money(p.CurrentInstallment), money(p.LoanBalance),
			money(p.NetLoanBefore), money(p.NetLoanAfter))
	}
	return append(row, money(p.LoanAmount))
}

// The four-column layout the branch and cluster files use — what a team leader
// needs to make the call and nothing else.
func csSplitCols(group string) []string {
	amount := "Loan Amount"
	if group == GroupRefinance {
		amount = "Net Loan After Refinance"
	}
	return []string{"Full Name", "Branch", "Cluster", "Phone", amount}
}

func csSplitRow(p *csPerson, group string) []string {
	v, _ := p.Qualifying()
	return []string{p.FullName, p.Branch, p.Cluster, p.Phone,
		strconv.FormatFloat(math.Round(v*100)/100, 'f', 2, 64)}
}

// buildCSGroup writes every workbook for one group.
func buildCSGroup(group string, people []*csPerson, zc *ZoneClusters) *rrProductResult {
	res := &rrProductResult{Product: group}
	base := csGroupFolder(group)

	// Cheapest first: the list is worked from the bottom up, so the people who
	// only just qualify are called before the big-ticket ones are chased.
	sort.SliceStable(people, func(i, j int) bool {
		a, _ := people[i].Qualifying()
		b, _ := people[j].Qualifying()
		return a < b
	})

	mainCols := csMainCols(group)
	all := newTable(mainCols)
	qualified := newTable(mainCols)
	whitelist := newTable(mainCols)

	for _, p := range people {
		row := csRowFor(p, group)
		all.Rows = append(all.Rows, row)
		if p.Qualifies() {
			qualified.Rows = append(qualified.Rows, row)
			if p.Whitelisted() {
				whitelist.Rows = append(whitelist.Rows, row)
			}
		}
	}

	res.Rows = all.Len()
	res.Allocated = qualified.Len()

	// Named for what they actually hold. "Qualified" is the list to work;
	// "Everyone" is the whole group for reference; "Whitelisted" is the
	// qualified subset payroll will accept a deduction for.
	res.addSheets(rrOutFile{
		RelPath: fmt.Sprintf("%s/%s_FULL.xlsx", base, base),
		Scope:   ScopeFull, Name: group, Rows: all.Len(),
	}, []namedSheet{
		{"Summary", summaryForCS(group, all.Len(), qualified.Len(), whitelist.Len())},
		{"Qualified", qualified},
		{"Everyone", all},
		{"Whitelisted", whitelist},
	})

	// Only qualified rows go out to branches and clusters.
	splitCols := csSplitCols(group)
	byBranch := map[string]*rrTable{}
	byCluster := map[string]*rrTable{}
	for _, p := range people {
		if !p.Qualifies() {
			continue
		}
		row := csSplitRow(p, group)
		b := p.Branch
		if b == "" {
			b = "Unknown branch"
		}
		if byBranch[b] == nil {
			byBranch[b] = newTable(splitCols)
		}
		byBranch[b].Rows = append(byBranch[b].Rows, row)

		cl := p.Cluster
		if cl == "" {
			cl = "Unknown"
		}
		if byCluster[cl] == nil {
			byCluster[cl] = newTable(splitCols)
		}
		byCluster[cl].Rows = append(byCluster[cl].Rows, row)
	}

	clusterOf := zc.ClusterForBranch(ProdCS)
	for _, b := range sortedKeys(byBranch) {
		t := byBranch[b]
		safe := safeFileName(b)
		if safe == "" {
			continue
		}
		pool := zc.PeopleForBranch(ProdCS, b)
		emails, names := recipientEmails(pool)
		res.addSheets(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Branch/%s_%s.xlsx", base, group, safe),
			Scope:   ScopeBranch, Name: b, Cluster: clusterOf[zoneKey(b)],
			Rows: t.Len(), Emails: emails, Names: names,
		}, []namedSheet{{"Clients", t}, {"Sent to", listSummary(pool)}})
		res.BranchFiles++
		if len(emails) == 0 {
			res.NoRecipient = append(res.NoRecipient, b)
		}
	}

	for _, cl := range sortedKeys(byCluster) {
		t := byCluster[cl]
		safe := safeFileName(cl)
		if safe == "" {
			continue
		}
		var recips []ZonePerson
		if cl != "Unknown" {
			recips = zc.ClusterRecipients(ProdCS, cl)
		}
		emails, names := recipientEmails(recips)
		res.addSheets(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Cluster/%s_%s.xlsx", base, group, safe),
			Scope:   ScopeCluster, Name: cl, Rows: t.Len(),
			Emails: emails, Names: names,
		}, []namedSheet{{"Clients", t}, {"Sent to", listSummary(recips)}})
		res.ClusterFile++
	}

	return res
}

// summaryForCS is the front sheet of a group's main workbook: the counts that
// tell somebody at a glance how many of these people are worth calling.
func summaryForCS(group string, total, qualified, whitelisted int) *rrTable {
	t := newTable([]string{"Figure", "Count", "What it means"})
	threshold := "500,000 loan"
	if group == GroupRefinance {
		threshold = "200,000 left after settling what they owe"
	}
	t.Rows = append(t.Rows,
		[]string{"People in this group", strconv.Itoa(total),
			"Everyone on the register who falls into " + group},
		[]string{"Qualified", strconv.Itoa(qualified),
			"Reach the threshold of " + threshold},
		[]string{"Qualified and whitelisted", strconv.Itoa(whitelisted),
			"Qualified AND on a check number payroll accepts (1130–1134)"},
	)
	return t
}

// listSummary names who a branch or cluster file is addressed to.
func listSummary(pool []ZonePerson) *rrTable {
	t := newTable([]string{"Name", "Role", "Branch", "Phone", "Email"})
	if len(pool) == 0 {
		t.Rows = append(t.Rows, []string{"(nobody on the roster for this group)", "", "", "", ""})
		return t
	}
	for _, p := range pool {
		t.Rows = append(t.Rows, []string{p.Name, p.Role, p.Branch, p.Phone, p.Email})
	}
	return t
}

// csReadme explains the run inside the zip.
func csReadme(counts map[string]int, results []*rrProductResult, branchStats map[string]int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "CS affordability run — %s\r\n\r\n", time.Now().Format("2 January 2006 15:04"))

	b.WriteString("Who is in which group\r\n" +
		"  Refinance     they have a live loan running now.\r\n" +
		"  Reactivation  they had one and have finished paying it off.\r\n" +
		"  New           they are not in the loan file at all.\r\n\r\n")

	b.WriteString("How much they can borrow\r\n" +
		"  1. Allowances = gross pay minus basic pay. Not dependable income.\r\n" +
		"  2. What they can afford each month = net pay, minus a third of basic\r\n" +
		"     pay (protected by law), minus allowances. Never below zero.\r\n" +
		"     For a refinance their current installment is added back, because\r\n" +
		"     the new loan swallows the old one and frees that money up.\r\n" +
		"  3. How long they can borrow for = months until they turn 59 and a\r\n" +
		"     half, capped at 96 months. No date of birth means no loan.\r\n" +
		"  4. Biggest loan that monthly figure can carry, at 3.5% monthly\r\n" +
		"     interest plus a 0.4% monthly admin fee.\r\n" +
		"  5. Cash before fees = that amount divided by 1.118 (10% processing\r\n" +
		"     fee plus 18% VAT).\r\n" +
		"  6. For a refinance, cash in hand = that figure minus what they still\r\n" +
		"     owe. If the new loan is smaller than the balance it is zero.\r\n\r\n" +
		"  Qualifies at 200,000 for refinance, 500,000 for new and reactivation.\r\n\r\n")

	b.WriteString("Per group\r\n")
	for _, r := range results {
		fmt.Fprintf(&b, "  %-14s %s people, %s qualified — %d branch and %d cluster workbooks\r\n",
			r.Product, formatThousands(r.Rows), formatThousands(r.Allocated),
			r.BranchFiles, r.ClusterFile)
	}

	fmt.Fprintf(&b, "\r\nBranches\r\n"+
		"  %s people got their branch from the loan file.\r\n"+
		"  %s took it from a colleague at the same employer.\r\n"+
		"  %s still have no branch and are grouped under \"Unknown branch\".\r\n",
		formatThousands(branchStats["branchFromLoanFile"]),
		formatThousands(branchStats["branchFromColleague"]),
		formatThousands(branchStats["branchUnknown"]))

	b.WriteString("\r\nWhat is in each folder\r\n" +
		"  FULL          three sheets: a Summary of the counts, the Qualified\r\n" +
		"                list, everyone in the group, and the whitelist subset.\r\n" +
		"  By_Branch     one workbook per branch, QUALIFIED people only.\r\n" +
		"  By_Cluster    the same, grouped by cluster.\r\n")
	return b.String()
}

// GetCSRunStats — GET /api/mambu/cs/summary
// What the CS tab shows before anything is run.
func GetCSRunStats(c *gin.Context) {
	var employees, inst, loans int
	database.DB.QueryRow(`SELECT COUNT(*) FROM mambu_employees`).Scan(&employees)

	instBatch, _ := activeCSBatch("INST")
	loanBatch, _ := activeCSBatch("CS_LOAN")
	if instBatch.Valid {
		database.DB.QueryRow(
			`SELECT COUNT(*) FROM mambu_installments WHERE batch_id::text=$1`,
			instBatch.String).Scan(&inst)
	}
	if loanBatch.Valid {
		database.DB.QueryRow(
			`SELECT COUNT(*) FROM mambu_cs_loans WHERE batch_id::text=$1`,
			loanBatch.String).Scan(&loans)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"employees": employees, "installments": inst, "loanRows": loans,
		"instReady": instBatch.Valid, "loanReady": loanBatch.Valid,
		"ready": employees > 0 && loanBatch.Valid,
	})
}
