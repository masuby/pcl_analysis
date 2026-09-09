package handlers

// CRM distribution packs — the CRM counterpart of a MAMBU refinance run.
//
// Distributing CRM leads (crm_data.go) assigns each lead to a Team Leader. A
// pack takes those assigned leads and splits them the way the MAMBU reports
// are split: one workbook per branch, one per cluster and one per zone, plus a
// FULL file per product, zipped for download. Each workbook records who it is
// addressed to — the branch's team leaders, the cluster manager, the zone's
// manager — taken from the live Zone and Clusters roster, so the same
// Distribute buttons work here as on MAMBU DATA.
//
//	POST /api/crm/packs                 build a pack (async, poll the id)
//	GET  /api/crm/packs                 recent packs
//	GET  /api/crm/packs/:id             one pack, with per-product counts
//	GET  /api/crm/packs/:id/download    the zip
//	GET  /api/crm/packs/:id/sends       what was emailed from it
//
// Sending is in crm_pack_send.go.

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/services/crmdata"
)

var crmPackJob struct {
	mu      sync.Mutex
	running bool
	id      uuid.UUID
}

// What a branch receives — the columns the team needs to make the call, plus
// where the client sits on the roster and who owns them.
var crmPackColumns = []string{
	"#", "Client Name", "Phone", "Branch", "Cluster", "Zone", "Region", "Team",
	"CRM Assigned To", "Status", "Consent Date", "Location", "Comment",
	"Team Leader", "TL Phone", "TL Email",
}

type crmPackRow struct {
	name, phone, region, team, crmAsg, status, consent, loc, comment string
	leadBranch                                                       string

	product, branch, cluster, zone string
	tlName, tlEmail, tlPhone       string
}

type crmPackProduct struct {
	Product      string `json:"product"`
	Rows         int    `json:"rows"`
	BranchFiles  int    `json:"branchFiles"`
	ClusterFiles int    `json:"clusterFiles"`
	ZoneFiles    int    `json:"zoneFiles"`
	OffRoster    int    `json:"offRoster"` // rows whose branch is not on the roster map

	files      []rrOutFile
	fileErrors []string
}

type crmPackOutput struct {
	Products  []*crmPackProduct
	Unrouted  *rrTable // leads whose product could not be told
	LeadCount int
	Warnings  []string
}

type crmPackRequest struct {
	Products []string          `json:"products"`
	Filter   map[string]string `json:"filter"`
}

// BuildCRMPack — POST /api/crm/packs
func BuildCRMPack(c *gin.Context) {
	var req crmPackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		crmFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}
	var products []string
	seen := map[string]bool{}
	for _, p := range req.Products {
		if code := normaliseProduct(p); code != "" && code != ProdAGRI && !seen[code] {
			seen[code] = true
			products = append(products, code)
		}
	}
	if len(products) == 0 {
		products = []string{ProdCS, ProdLBF, ProdSME}
	}
	if req.Filter == nil {
		req.Filter = map[string]string{}
	}
	// The pack is built from assigned leads only; these keys would contradict that.
	delete(req.Filter, "unassigned")
	delete(req.Filter, "assigned")

	crmPackJob.mu.Lock()
	if crmPackJob.running {
		id := crmPackJob.id
		crmPackJob.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false,
			"error": "A pack is already being built.", "packId": id})
		return
	}
	id := uuid.New()
	crmPackJob.running, crmPackJob.id = true, id
	crmPackJob.mu.Unlock()

	filterJSON, _ := json.Marshal(req.Filter)
	if _, err := database.DB.Exec(
		`INSERT INTO crm_packs (id, products, filter, built_by) VALUES ($1,$2,$3,$4)`,
		id, strings.Join(products, ","), filterJSON, crmUserID(c)); err != nil {
		crmPackJob.mu.Lock()
		crmPackJob.running = false
		crmPackJob.mu.Unlock()
		crmFail(c, http.StatusInternalServerError, "create pack", err)
		return
	}

	go runCRMPackJob(id, products, req.Filter)

	c.JSON(http.StatusOK, gin.H{
		"success": true, "packId": id, "products": products,
		"message": "Building the workbooks on the server.",
	})
}

func runCRMPackJob(id uuid.UUID, products []string, filter map[string]string) {
	defer func() {
		crmPackJob.mu.Lock()
		crmPackJob.running = false
		crmPackJob.mu.Unlock()
	}()
	fail := func(err error) {
		database.DB.Exec(
			`UPDATE crm_packs SET status='FAILED', error=$2, finished_at=now() WHERE id=$1`,
			id, err.Error())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	zc, err := LoadZoneClusters(ctx, true)
	if err != nil {
		fail(err)
		return
	}
	out, err := buildCRMPack(ctx, zc, products, filter)
	if err != nil {
		fail(err)
		return
	}

	zipRel, zipSize, err := writeCRMPackZip(id, out)
	if err != nil {
		fail(err)
		return
	}
	if err := saveCRMPackFiles(id, out); err != nil {
		fail(fmt.Errorf("recording the pack's files: %w", err))
		return
	}

	stats, _ := json.Marshal(gin.H{"products": out.Products})
	unrouted := 0
	if out.Unrouted != nil {
		unrouted = out.Unrouted.Len()
	}
	if _, err := database.DB.Exec(
		`UPDATE crm_packs
		    SET status='DONE', lead_count=$2, unrouted=$3, stats=$4, warnings=$5,
		        zip_path=$6, zip_size=$7, finished_at=now()
		  WHERE id=$1`,
		id, out.LeadCount, unrouted, stats, strings.Join(out.Warnings, "\n"),
		zipRel, zipSize); err != nil {
		fail(err)
	}
}

// branchGeo is where a branch sits on the roster map.
type branchGeo struct{ cluster, zone string }

// rosterGeo indexes the roster by product and branch, keyed the CRM way —
// crmdata.BranchKey strips the product prefix and the word "Branch", so the
// export's "CS Mbeya Branch" and the sheet's "Mbeya" meet on one key. The map
// tab is read first; people tabs fill in branches the map does not list.
func rosterGeo(zc *ZoneClusters) map[string]map[string]branchGeo {
	out := map[string]map[string]branchGeo{}
	put := func(product, branch, cluster, zone string) {
		p := normaliseProduct(product)
		k := crmdata.BranchKey(branch)
		if p == "" || k == "" {
			return
		}
		if out[p] == nil {
			out[p] = map[string]branchGeo{}
		}
		g := out[p][k]
		if g.cluster == "" {
			g.cluster = cluster
		}
		if g.zone == "" {
			g.zone = zone
		}
		out[p][k] = g
	}
	for _, r := range zc.Map {
		put(r.Product, r.Branch, r.Cluster, r.Zone)
	}
	for _, p := range zc.People {
		put(p.Product, p.Branch, p.Cluster, p.Zone)
	}
	return out
}

func buildCRMPack(ctx context.Context, zc *ZoneClusters, products []string,
	filter map[string]string) (*crmPackOutput, error) {

	where, args := crmFiltersFromMap(filter)
	// The filter is written against bare crm_leads columns, so it is applied in
	// a subquery where nothing else is in scope; the join to the assignment
	// happens outside it.
	rows, err := database.DB.QueryContext(ctx, `
		SELECT COALESCE(l.lead_name,''), COALESCE(l.phone_norm,''), COALESCE(l.branch,''),
		       COALESCE(l.region,''), COALESCE(l.team_name,''), COALESCE(l.assigned_to,''),
		       COALESCE(l.status,''), COALESCE(to_char(l.consent_date,'YYYY-MM-DD'),''),
		       COALESCE(l.location,''), COALESCE(l.comment,''), COALESCE(l.product_hint,''),
		       COALESCE(d.assignee_name,''), COALESCE(d.assignee_email,''),
		       COALESCE(d.assignee_phone,''),
		       COALESCE(dd.branch,''), COALESCE(dd.product,''),
		       COALESCE(dd.cluster,''), COALESCE(dd.zone,'')
		  FROM (SELECT * FROM crm_leads `+where+`) l
		  JOIN crm_distributions d ON d.lead_id = l.id
		  LEFT JOIN digital_directory dd ON dd.id = d.directory_id
		 ORDER BY l.branch, l.lead_name`, args...)
	if err != nil {
		return nil, fmt.Errorf("reading assigned leads: %w", err)
	}
	defer rows.Close()

	geo := rosterGeo(zc)
	wanted := map[string]bool{}
	for _, p := range products {
		wanted[p] = true
	}

	out := &crmPackOutput{Unrouted: newTable(crmPackColumns)}
	byProduct := map[string][]crmPackRow{}

	for rows.Next() {
		var r crmPackRow
		var hint, ddBranch, ddProduct, ddCluster, ddZone string
		if err := rows.Scan(&r.name, &r.phone, &r.leadBranch, &r.region, &r.team,
			&r.crmAsg, &r.status, &r.consent, &r.loc, &r.comment, &hint,
			&r.tlName, &r.tlEmail, &r.tlPhone,
			&ddBranch, &ddProduct, &ddCluster, &ddZone); err != nil {
			continue
		}
		out.LeadCount++

		// Product: the Team Leader's, then the branch prefix, then the one
		// product whose roster lists the lead's branch.
		r.product = normaliseProduct(ddProduct)
		if r.product == "" {
			r.product = normaliseProduct(hint)
		}
		if r.product == "" {
			var hits []string
			for p, m := range geo {
				if _, ok := m[crmdata.BranchKey(r.leadBranch)]; ok {
					hits = append(hits, p)
				}
			}
			if len(hits) == 1 {
				r.product = hits[0]
			}
		}
		if r.product == "" {
			out.Unrouted.Rows = append(out.Unrouted.Rows, crmPackCells(r, out.Unrouted.Len()+1))
			continue
		}
		if !wanted[r.product] {
			continue
		}

		// Branch as the roster spells it, so files line up with MAMBU's.
		r.branch = ddBranch
		if r.branch == "" {
			r.branch = r.leadBranch
		}
		// Cluster and zone: the map tab by branch first (roster spelling, then
		// the export's) — that is the vocabulary the cluster and zone managers
		// are listed under, so it is what makes them findable. The Team
		// Leader's own row is the fallback for a branch the map does not list;
		// people tabs spell zones loosely ("Highland Region" for "Highland
		// Zone"), so it is a fallback, not the first choice.
		for _, b := range []string{ddBranch, r.leadBranch} {
			if g, ok := geo[r.product][crmdata.BranchKey(b)]; ok {
				if r.cluster == "" {
					r.cluster = g.cluster
				}
				if r.zone == "" {
					r.zone = g.zone
				}
			}
		}
		if r.cluster == "" {
			r.cluster = ddCluster
		}
		if r.zone == "" {
			r.zone = ddZone
		}
		byProduct[r.product] = append(byProduct[r.product], r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if out.LeadCount == 0 {
		return nil, fmt.Errorf("no assigned leads match the current filters — distribute leads to Team Leaders first")
	}

	for _, p := range products {
		res := buildCRMPackProduct(zc, p, byProduct[p])
		out.Products = append(out.Products, res)
		if res.OffRoster > 0 {
			out.Warnings = append(out.Warnings, fmt.Sprintf(
				"%s: %d lead(s) sit in a branch the Zone and Clusters map does not list, "+
					"so they are in the FULL and branch files but under an Unknown cluster and zone.",
				p, res.OffRoster))
		}
		if len(res.fileErrors) > 0 {
			out.Warnings = append(out.Warnings, fmt.Sprintf(
				"%s: %d workbook(s) could not be written and are MISSING from the zip — %s.",
				p, len(res.fileErrors), strings.Join(res.fileErrors, "; ")))
		}
	}
	if n := out.Unrouted.Len(); n > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf(
			"%d lead(s) could not be given a product — their Team Leader has none on the "+
				"roster and the branch names none. They are in CRM_UNROUTED.xlsx only.", n))
	}
	return out, nil
}

func crmPackCells(r crmPackRow, n int) []string {
	num := ""
	if n > 0 {
		num = strconv.Itoa(n)
	}
	branch := r.branch
	if branch == "" {
		branch = r.leadBranch
	}
	return []string{
		num, r.name, r.phone, branch, r.cluster, r.zone, r.region, r.team,
		r.crmAsg, r.status, r.consent, r.loc, r.comment,
		r.tlName, r.tlPhone, r.tlEmail,
	}
}

func crmPackTable(rows []crmPackRow) *rrTable {
	t := newTable(crmPackColumns)
	for i, r := range rows {
		t.Rows = append(t.Rows, crmPackCells(r, i+1))
	}
	return t
}

// crmPackSummary is the workbook's first sheet: one line per Team Leader with
// their share, the recipients flagged, and anyone addressed who is not a Team
// Leader (a cluster manager, say) listed at the top so they appear at all.
func crmPackSummary(rows []crmPackRow, recipients []ZonePerson) *rrTable {
	s := newTable([]string{"Team Leader", "Branch", "Cluster", "Zone", "Email", "Phone",
		"Leads", "Email Recipient"})

	type acc struct {
		row   crmPackRow
		count int
	}
	byTL := map[string]*acc{}
	for _, r := range rows {
		k := r.tlName + "|" + strings.ToLower(r.tlEmail)
		if byTL[k] == nil {
			byTL[k] = &acc{row: r}
		}
		byTL[k].count++
	}
	want := map[string]bool{}
	for _, p := range recipients {
		if e := strings.ToLower(strings.TrimSpace(p.Email)); e != "" {
			want[e] = true
		}
	}
	covered := map[string]bool{}
	for _, k := range sortedKeys(byTL) {
		a := byTL[k]
		flag := ""
		if e := strings.ToLower(a.row.tlEmail); e != "" && want[e] {
			flag = "YES"
			covered[e] = true
		}
		s.Rows = append(s.Rows, []string{
			a.row.tlName, a.row.branch, a.row.cluster, a.row.zone,
			a.row.tlEmail, a.row.tlPhone, strconv.Itoa(a.count), flag,
		})
	}
	var extra [][]string
	for _, p := range recipients {
		e := strings.ToLower(strings.TrimSpace(p.Email))
		if e == "" || covered[e] {
			continue
		}
		covered[e] = true
		extra = append(extra, []string{p.Name + " (" + p.Role + ")", p.Branch, p.Cluster,
			p.Zone, p.Email, p.Phone, "", "YES"})
	}
	s.Rows = append(extra, s.Rows...)
	s.Rows = append(s.Rows, []string{"TOTAL", "", "", "", "", "", strconv.Itoa(len(rows)), ""})
	return s
}

// assigneeRecipients: the Team Leaders who own the rows in a file, as roster
// people so they share one summary/recipient path with the manager lookups.
func assigneeRecipients(rows []crmPackRow) []ZonePerson {
	var out []ZonePerson
	seen := map[string]bool{}
	for _, r := range rows {
		e := strings.ToLower(strings.TrimSpace(r.tlEmail))
		if e == "" || !strings.Contains(e, "@") || seen[e] {
			continue
		}
		seen[e] = true
		out = append(out, ZonePerson{Name: r.tlName, Role: "Team Leader", Branch: r.branch,
			Cluster: r.cluster, Zone: r.zone, Email: r.tlEmail, Phone: r.tlPhone})
	}
	return out
}

func (res *crmPackProduct) addWorkbook(meta rrOutFile, rows []crmPackRow, recipients []ZonePerson) {
	meta.Rows = len(rows)
	meta.Emails, meta.Names = recipientEmails(recipients)
	b, err := buildWorkbookSheets([]namedSheet{
		{"Summary", crmPackSummary(rows, recipients)},
		{"Leads", crmPackTable(rows)},
	})
	if err != nil {
		res.fileErrors = append(res.fileErrors, fmt.Sprintf("%s (%v)", meta.RelPath, err))
		return
	}
	meta.Data = b
	res.files = append(res.files, meta)
}

func buildCRMPackProduct(zc *ZoneClusters, product string, rows []crmPackRow) *crmPackProduct {
	res := &crmPackProduct{Product: product, Rows: len(rows)}
	if len(rows) == 0 {
		return res
	}
	base := "CRM_" + safeFileName(product)
	label := func(s, fallback string) string {
		if strings.TrimSpace(s) == "" {
			return fallback
		}
		return s
	}
	groupBy := func(key func(crmPackRow) string) (map[string][]crmPackRow, []string) {
		m := map[string][]crmPackRow{}
		for _, r := range rows {
			k := key(r)
			m[k] = append(m[k], r)
		}
		return m, sortedKeys(m)
	}

	// FULL — everything for the product. Addressed to nobody: it is the
	// operator's copy, not something a branch should receive.
	res.addWorkbook(rrOutFile{
		RelPath: fmt.Sprintf("%s/%s_FULL.xlsx", base, base),
		Scope:   ScopeFull, Name: product,
	}, rows, nil)

	// By branch — to the Team Leaders who own the rows; where none has an
	// email, to the branch's team leaders on the roster.
	byBranch, branches := groupBy(func(r crmPackRow) string { return label(r.branch, "Unknown branch") })
	for _, br := range branches {
		sub := byBranch[br]
		safe := safeFileName(br)
		if safe == "" {
			continue
		}
		recips := assigneeRecipients(sub)
		if len(recips) == 0 {
			bk := crmdata.BranchKey(br)
			recips = filterClass(zc.peopleWhere(func(p ZonePerson) bool {
				return p.ProductKey == zoneKey(product) && crmdata.BranchKey(p.Branch) == bk
			}), "tl", "itl", "blo")
		}
		if sub[0].cluster == "" {
			res.OffRoster += len(sub)
		}
		res.addWorkbook(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Branch/%s_%s.xlsx", base, base, safe),
			Scope:   ScopeBranch, Name: br,
			Cluster: label(sub[0].cluster, "Unknown"),
			Zone:    label(sub[0].zone, "Unknown"),
		}, sub, recips)
		res.BranchFiles++
	}

	// By cluster — to the cluster manager.
	byCluster, clusters := groupBy(func(r crmPackRow) string { return label(r.cluster, "Unknown") })
	for _, cl := range clusters {
		safe := safeFileName(cl)
		if safe == "" {
			continue
		}
		var recips []ZonePerson
		if cl != "Unknown" {
			recips = zc.ClusterRecipients(product, cl)
		}
		res.addWorkbook(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Cluster/%s_%s.xlsx", base, base, safe),
			Scope:   ScopeCluster, Name: cl,
		}, byCluster[cl], recips)
		res.ClusterFiles++
	}

	// By zone — to the zone's manager.
	byZone, zones := groupBy(func(r crmPackRow) string { return label(r.zone, "Unknown") })
	for _, z := range zones {
		safe := safeFileName(z)
		if safe == "" {
			continue
		}
		var recips []ZonePerson
		if z != "Unknown" {
			recips = zc.ZoneRecipients(product, z)
		}
		res.addWorkbook(rrOutFile{
			RelPath: fmt.Sprintf("%s/By_Zone/%s_%s.xlsx", base, base, safe),
			Scope:   ScopeZone, Name: z,
		}, byZone[z], recips)
		res.ZoneFiles++
	}
	return res
}

func writeCRMPackZip(id uuid.UUID, out *crmPackOutput) (string, int64, error) {
	dir := filepath.Join(mambuRoot(), "crm", "packs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	name := fmt.Sprintf("CRM_Pack_%s_%s.zip", time.Now().Format("2006-01-02"), id.String()[:8])
	rel := filepath.Join("crm", "packs", name)
	full := filepath.Join(mambuRoot(), rel)

	f, err := os.Create(full)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	add := func(relPath string, data []byte) error {
		w, err := zw.Create(relPath)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	for _, p := range out.Products {
		for _, file := range p.files {
			if err := add(file.RelPath, file.Data); err != nil {
				zw.Close()
				return "", 0, err
			}
		}
	}
	if out.Unrouted != nil && out.Unrouted.Len() > 0 {
		if b, err := buildWorkbookSheets([]namedSheet{{"Leads", out.Unrouted}}); err == nil {
			if err := add("CRM_UNROUTED.xlsx", b); err != nil {
				zw.Close()
				return "", 0, err
			}
		}
	}
	if err := add("README.txt", []byte(crmPackReadme(out))); err != nil {
		zw.Close()
		return "", 0, err
	}
	if err := zw.Close(); err != nil {
		return "", 0, err
	}
	info, _ := os.Stat(full)
	var size int64
	if info != nil {
		size = info.Size()
	}
	return rel, size, nil
}

func crmPackReadme(out *crmPackOutput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "CRM distribution pack — %s\r\n\r\n", time.Now().Format("2 January 2006 15:04"))
	fmt.Fprintf(&b, "Assigned leads in the pack   %d\r\n\r\n", out.LeadCount)
	b.WriteString("Per product\r\n")
	for _, p := range out.Products {
		fmt.Fprintf(&b, "  %-6s %d leads — %d branch, %d cluster, %d zone workbooks\r\n",
			p.Product, p.Rows, p.BranchFiles, p.ClusterFiles, p.ZoneFiles)
	}
	b.WriteString("\r\nWhat is in each folder\r\n" +
		"  FULL          every lead for the product, with its Team Leader.\r\n" +
		"  By_Branch     one workbook per branch, addressed to its Team Leaders.\r\n" +
		"  By_Cluster    one per cluster, addressed to the cluster manager.\r\n" +
		"  By_Zone       one per zone, addressed to the zone manager.\r\n" +
		"  CRM_UNROUTED  leads whose product could not be told (when present).\r\n\r\n" +
		"Every workbook has Summary (each Team Leader's share, and who the file\r\n" +
		"is addressed to) and Leads (the rows).\r\n")
	if len(out.Warnings) > 0 {
		b.WriteString("\r\nWorth knowing\r\n")
		for _, w := range out.Warnings {
			fmt.Fprintf(&b, "  - %s\r\n", w)
		}
	}
	return b.String()
}

func saveCRMPackFiles(id uuid.UUID, out *crmPackOutput) error {
	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(
		`INSERT INTO crm_pack_files
		   (id, pack_id, product, scope, name, cluster, zone, rel_path, rows, emails, names)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, p := range out.Products {
		for _, f := range p.files {
			if _, err := stmt.Exec(uuid.New(), id, p.Product, f.Scope, f.Name, f.Cluster, f.Zone,
				f.RelPath, f.Rows, strings.Join(f.Emails, ","), strings.Join(f.Names, ",")); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// ----------------------------------------------------------------- reading

func crmPackJSON(id string) (gin.H, bool) {
	var (
		products, status  string
		errText, warnings *string
		leads, unrouted   int
		zipPath           *string
		zipSize           *int64
		statsRaw, filtRaw []byte
		started           time.Time
		finished          *time.Time
		by                string
	)
	err := database.DB.QueryRow(
		`SELECT p.products, p.status, p.error, p.warnings, p.lead_count, p.unrouted,
		        p.zip_path, p.zip_size, p.stats, p.filter, p.started_at, p.finished_at,
		        COALESCE(u.display_name,'')
		   FROM crm_packs p LEFT JOIN users u ON u.id = p.built_by
		  WHERE p.id = $1`, id).
		Scan(&products, &status, &errText, &warnings, &leads, &unrouted,
			&zipPath, &zipSize, &statsRaw, &filtRaw, &started, &finished, &by)
	if err != nil {
		return nil, false
	}
	resp := gin.H{
		"id": id, "products": strings.Split(products, ","), "status": status,
		"leadCount": leads, "unrouted": unrouted, "startedAt": started, "builtBy": by,
	}
	if errText != nil {
		resp["error"] = *errText
	}
	if warnings != nil && *warnings != "" {
		resp["warnings"] = strings.Split(*warnings, "\n")
	}
	if finished != nil {
		resp["finishedAt"] = *finished
	}
	if zipSize != nil {
		resp["zipSize"] = *zipSize
	}
	if zipPath != nil && *zipPath != "" {
		resp["downloadUrl"] = "/api/crm/packs/" + id + "/download"
	}
	if len(statsRaw) > 0 {
		var s interface{}
		if json.Unmarshal(statsRaw, &s) == nil {
			resp["stats"] = s
		}
	}
	if len(filtRaw) > 0 {
		var f interface{}
		if json.Unmarshal(filtRaw, &f) == nil {
			resp["filter"] = f
		}
	}
	return resp, true
}

// GetCRMPack — GET /api/crm/packs/:id
func GetCRMPack(c *gin.Context) {
	resp, ok := crmPackJSON(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Pack not found"})
		return
	}
	resp["success"] = true
	c.JSON(http.StatusOK, resp)
}

// ListCRMPacks — GET /api/crm/packs
func ListCRMPacks(c *gin.Context) {
	rows, err := database.DB.Query(`SELECT id FROM crm_packs ORDER BY started_at DESC LIMIT 20`)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query packs", err)
		return
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	out := []gin.H{}
	for _, id := range ids {
		if p, ok := crmPackJSON(id); ok {
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "packs": out})
}

// DownloadCRMPack — GET /api/crm/packs/:id/download
func DownloadCRMPack(c *gin.Context) {
	id := c.Param("id")
	var rel string
	var started time.Time
	if err := database.DB.QueryRow(
		`SELECT COALESCE(zip_path,''), started_at FROM crm_packs WHERE id=$1`, id).
		Scan(&rel, &started); err != nil || rel == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "No file for that pack"})
		return
	}
	full := filepath.Join(mambuRoot(), rel)
	if _, err := os.Stat(full); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false,
			"error": "The file for that pack is no longer on the server"})
		return
	}
	c.FileAttachment(full, fmt.Sprintf("CRM_Distribution_%s.zip", started.Format("2006-01-02")))
}
