package handlers

// DIGITAL DATA — cleaned lead warehouse API.
//
//	POST /api/digital-data/ingest           run the cleaner over all workbooks
//	GET  /api/digital-data/runs             ingest history
//	GET  /api/digital-data/summary          roll-ups for the dashboard cards
//	GET  /api/digital-data/quality          what the source data got wrong
//	GET  /api/digital-data/leads            filtered + paginated leads
//	GET  /api/digital-data/filters          distinct values for the filter bar
//	POST /api/digital-data/directory/sync   refresh people from Zone & Clusters
//	GET  /api/digital-data/directory        distribution targets
//	POST /api/digital-data/distribute       assign leads to people
//	GET  /api/digital-data/distributions    distribution history

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/services/digitaldata"
)

func ddFail(c *gin.Context, code int, msg string, err error) {
	if err != nil {
		msg = msg + ": " + err.Error()
	}
	c.JSON(code, gin.H{"success": false, "error": msg})
}

// ---------------------------------------------------------------------- ingest

// IngestDigitalData — POST /api/digital-data/ingest
//
// Body (all optional): { includePayroll: bool, dayFirst: bool }
//
// dayFirst decides how 05/06/2026 is read. It defaults to true (Tanzanian
// dd/mm); rows where the ambiguity actually mattered are flagged
// AMBIGUOUS_DATE so the Quality view can show how many were affected.
func IngestDigitalData(c *gin.Context) {
	var body struct {
		IncludePayroll bool  `json:"includePayroll"`
		DayFirst       *bool `json:"dayFirst"`
	}
	_ = c.ShouldBindJSON(&body)

	dayFirst := true
	if body.DayFirst != nil {
		dayFirst = *body.DayFirst
	}

	var uid *string
	if id, err := middleware.GetUserIDFromContext(c); err == nil && id != uuid.Nil {
		s := id.String()
		uid = &s
	}

	// The full sweep reads ~93k rows across 40 tabs; allow it room.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Minute)
	defer cancel()

	sum, err := digitaldata.Ingest(ctx, uid, body.IncludePayroll, dayFirst)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error(), "run": sum})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "run": sum})
}

// GetDigitalIngestRuns — GET /api/digital-data/runs?limit=20
func GetDigitalIngestRuns(c *gin.Context) {
	limit := ddIntQuery(c, "limit", 20, 1, 100)

	rows, err := database.DB.Query(`
		SELECT id, started_at, finished_at, status, books_scanned, tabs_scanned,
		       tabs_ingested, rows_read, rows_inserted, rows_skipped,
		       COALESCE(error,''), COALESCE(tab_report::text,'[]')
		  FROM digital_ingest_runs
		 ORDER BY started_at DESC
		 LIMIT $1`, limit)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "query runs", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var (
			id, status, errMsg, tabReport string
			started                       time.Time
			finished                      sql.NullTime
			books, tabs, ingested         int
			read, inserted, skipped       int
		)
		if err := rows.Scan(&id, &started, &finished, &status, &books, &tabs,
			&ingested, &read, &inserted, &skipped, &errMsg, &tabReport); err != nil {
			continue
		}
		var tabsJSON interface{}
		_ = json.Unmarshal([]byte(tabReport), &tabsJSON)

		item := gin.H{
			"id": id, "startedAt": started, "status": status,
			"booksScanned": books, "tabsScanned": tabs, "tabsIngested": ingested,
			"rowsRead": read, "rowsInserted": inserted, "rowsSkipped": skipped,
			"tabs": tabsJSON,
		}
		if finished.Valid {
			item["finishedAt"] = finished.Time
		}
		if errMsg != "" {
			item["error"] = errMsg
		}
		out = append(out, item)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "runs": out})
}

// --------------------------------------------------------------------- summary

// GetDigitalDataSummary — GET /api/digital-data/summary
//
// Returns headline counts plus breakdowns by product, platform, status and
// month, all restricted to social-lead tabs unless ?kind=all.
func GetDigitalDataSummary(c *gin.Context) {
	where, args := ddLeadFilters(c)

	var totals struct {
		Total, Unique, Valid, Converted, Assigned int
	}
	err := database.DB.QueryRow(`
		SELECT COUNT(*),
		       COUNT(DISTINCT phone_e164) FILTER (WHERE phone_e164 <> ''),
		       COUNT(*) FILTER (WHERE phone_valid),
		       COUNT(*) FILTER (WHERE is_converted),
		       COUNT(*) FILTER (WHERE EXISTS (
		           SELECT 1 FROM digital_distributions dd WHERE dd.lead_id = digital_leads.id))
		  FROM digital_leads `+where, args...).
		Scan(&totals.Total, &totals.Unique, &totals.Valid, &totals.Converted, &totals.Assigned)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "summary totals", err)
		return
	}

	byProduct, err := ddGroupCount(`product`, where, args)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "by product", err)
		return
	}
	byPlatform, err := ddGroupCount(`platform`, where, args)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "by platform", err)
		return
	}
	byStatus, err := ddGroupCount(`status_canonical`, where, args)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "by status", err)
		return
	}
	byMonth, err := ddGroupCount(`COALESCE(lead_month,'unknown')`, where, args)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "by month", err)
		return
	}
	byBook, err := ddGroupCount(`source_book`, where, args)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "by book", err)
		return
	}

	dupRate := 0.0
	if totals.Total > 0 {
		dupRate = (1 - float64(totals.Unique)/float64(totals.Total)) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"totals": gin.H{
			"rows":          totals.Total,
			"uniquePhones":  totals.Unique,
			"validPhones":   totals.Valid,
			"converted":     totals.Converted,
			"assigned":      totals.Assigned,
			"unassigned":    totals.Total - totals.Assigned,
			"duplicateRate": dupRate,
		},
		"byProduct":  byProduct,
		"byPlatform": byPlatform,
		"byStatus":   byStatus,
		"byMonth":    byMonth,
		"byBook":     byBook,
	})
}

// GetDigitalDataQuality — GET /api/digital-data/quality
//
// Counts each issue code, so the UI can show exactly how much of the source
// data is unusable and why.
func GetDigitalDataQuality(c *gin.Context) {
	where, args := ddLeadFilters(c)

	rows, err := database.DB.Query(`
		SELECT code, COUNT(*)
		  FROM digital_leads, LATERAL jsonb_array_elements_text(issues) AS code
		  `+ddAndWhere(where)+`
		 GROUP BY code ORDER BY 2 DESC`, args...)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "quality counts", err)
		return
	}
	defer rows.Close()

	issues := []gin.H{}
	for rows.Next() {
		var code string
		var n int
		if err := rows.Scan(&code, &n); err == nil {
			issues = append(issues, gin.H{
				"code": code, "count": n, "blocking": digitaldata.IsBlockingIssue(code),
			})
		}
	}

	// `usable` is the number that can actually be called — the metric that
	// decides whether a lead is worth distributing. `clean` (no issues at all)
	// is reported too, but whole tabs never captured a customer name, so it is
	// near zero for them and is not a fair measure of the data's worth.
	var clean, total, usable int
	_ = database.DB.QueryRow(`
		SELECT COUNT(*) FILTER (WHERE jsonb_array_length(issues) = 0),
		       COUNT(*),
		       COUNT(*) FILTER (WHERE phone_valid)
		  FROM digital_leads `+where, args...).Scan(&clean, &total, &usable)

	// Per-tab health, so a bad month is easy to spot.
	tabRows, err := database.DB.Query(`
		SELECT source_book, source_tab, COUNT(*),
		       COUNT(*) FILTER (WHERE jsonb_array_length(issues) = 0),
		       COUNT(*) FILTER (WHERE phone_valid)
		  FROM digital_leads `+where+`
		 GROUP BY source_book, source_tab
		 ORDER BY source_book, source_tab`, args...)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "per-tab quality", err)
		return
	}
	defer tabRows.Close()

	tabs := []gin.H{}
	for tabRows.Next() {
		var book, tab string
		var n, ok, valid int
		if err := tabRows.Scan(&book, &tab, &n, &ok, &valid); err == nil {
			tabs = append(tabs, gin.H{
				"book": book, "tab": tab, "rows": n, "clean": ok, "validPhones": valid,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "issues": issues,
		"clean": clean, "total": total, "usable": usable, "tabs": tabs,
	})
}

// ----------------------------------------------------------------------- leads

// GetDigitalLeads — GET /api/digital-data/leads
//
// Filters: product, platform, status, month, book, search, unique=1,
// unassigned=1, validOnly=1, kind. Paginated with page/pageSize.
func GetDigitalLeads(c *gin.Context) {
	where, args := ddLeadFilters(c)

	page := ddIntQuery(c, "page", 1, 1, 100000)
	// Up to 2000 per page so a full-scope Excel export (~37k rows) is ~19
	// round-trips rather than 74.
	size := ddIntQuery(c, "pageSize", 50, 1, 2000)
	offset := (page - 1) * size

	var total int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM digital_leads `+where, args...).Scan(&total); err != nil {
		ddFail(c, http.StatusInternalServerError, "count leads", err)
		return
	}

	// Assignee comes from correlated subqueries rather than a JOIN, so the
	// shared (unqualified) filter clause stays unambiguous.
	q := `
		SELECT id, product, platform, COALESCE(lead_name,''), lead_date,
		       COALESCE(assigned_to,''), COALESCE(phone_e164,''), phone_valid,
		       COALESCE(status_raw,''), status_canonical, COALESCE(comment,''),
		       is_converted, loan_amount, COALESCE(client_type,''),
		       COALESCE(region,''), source_book, source_tab, source_row,
		       COALESCE(issues::text,'[]'), is_primary,
		       COALESCE((SELECT d.assignee_name  FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.assignee_email FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.status         FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.assignee_role  FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.assignee_phone FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.branch         FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.cluster        FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       COALESCE((SELECT d.zone           FROM digital_distributions d WHERE d.lead_id = digital_leads.id),''),
		       (SELECT d.assigned_at FROM digital_distributions d WHERE d.lead_id = digital_leads.id)
		  FROM digital_leads ` + where + `
		 ORDER BY lead_date DESC NULLS LAST, created_at DESC
		 LIMIT $` + strconv.Itoa(len(args)+1) + ` OFFSET $` + strconv.Itoa(len(args)+2)

	args = append(args, size, offset)

	rows, err := database.DB.Query(q, args...)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "query leads", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var (
			id, product, platform, name, assignedTo, phone      string
			statusRaw, statusCanon, comment, clientType, region string
			book, tab, issuesJSON, asgName, asgEmail, asgStatus string
			asgRole, asgPhone, asgBranch, asgCluster, asgZone   string
			leadDate, assignedAt                                sql.NullTime
			amount                                              sql.NullFloat64
			srcRow                                              int
			phoneValid, converted, isPrimary                    bool
		)
		if err := rows.Scan(&id, &product, &platform, &name, &leadDate, &assignedTo,
			&phone, &phoneValid, &statusRaw, &statusCanon, &comment, &converted,
			&amount, &clientType, &region, &book, &tab, &srcRow, &issuesJSON,
			&isPrimary, &asgName, &asgEmail, &asgStatus,
			&asgRole, &asgPhone, &asgBranch, &asgCluster, &asgZone, &assignedAt); err != nil {
			continue
		}
		var issues []string
		_ = json.Unmarshal([]byte(issuesJSON), &issues)

		item := gin.H{
			"id": id, "product": product, "platform": platform, "name": name,
			"assignedTo": assignedTo, "phone": phone, "phoneValid": phoneValid,
			"statusRaw": statusRaw, "status": statusCanon, "comment": comment,
			"isConverted": converted, "clientType": clientType, "region": region,
			"sourceBook": book, "sourceTab": tab, "sourceRow": srcRow,
			"issues": issues, "isPrimary": isPrimary,
		}
		if leadDate.Valid {
			item["date"] = leadDate.Time.Format("2006-01-02")
		}
		if amount.Valid {
			item["loanAmount"] = amount.Float64
		}
		if asgName != "" {
			a := gin.H{
				"name": asgName, "email": asgEmail, "status": asgStatus,
				"role": asgRole, "phone": asgPhone,
				"branch": asgBranch, "cluster": asgCluster, "zone": asgZone,
			}
			if assignedAt.Valid {
				a["assignedAt"] = assignedAt.Time.Format("2006-01-02 15:04")
			}
			item["assignee"] = a
		}
		out = append(out, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "leads": out,
		"page": page, "pageSize": size, "total": total,
	})
}

// GetDigitalDataFilters — GET /api/digital-data/filters
func GetDigitalDataFilters(c *gin.Context) {
	get := func(col string) []string {
		rows, err := database.DB.Query(
			`SELECT DISTINCT ` + col + ` FROM digital_leads WHERE ` + col + ` IS NOT NULL AND ` + col + ` <> '' ORDER BY 1`)
		if err != nil {
			return []string{}
		}
		defer rows.Close()
		out := []string{}
		for rows.Next() {
			var v string
			if rows.Scan(&v) == nil {
				out = append(out, v)
			}
		}
		return out
	}
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"products":  get("product"),
		"platforms": get("platform"),
		"statuses":  get("status_canonical"),
		"months":    get("lead_month"),
		"books":     get("source_book"),
	})
}

// ------------------------------------------------------------------- directory

// SyncDigitalDirectory — POST /api/digital-data/directory/sync
func SyncDigitalDirectory(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Minute)
	defer cancel()

	n, err := digitaldata.SyncDirectory(ctx)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "sync directory", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "people": n})
}

// distributionRule returns the SQL predicate identifying who may receive a
// given product's digital leads. This is the routing policy and it lives here,
// not in the client, so every caller gets the same answer:
//
//	LBF -> the LBF call centre
//	CS  -> the CS call centre
//	SME -> SME branch managers only
//	MIF -> the call centre (MIF ads run through the same team as LBF)
//
// Branch staff (LBF_Branches, CS_Mainland, CS_Zanzibar) never receive digital
// leads, so they must not appear as assignees.
func distributionRule(product string) string {
	switch strings.ToUpper(product) {
	case "SME":
		return "(product = 'SME' AND lower(role) LIKE '%manager%')"
	case "LBF", "CS", "MIF":
		p := "LBF"
		if strings.ToUpper(product) == "CS" {
			p = "CS"
		}
		return "(product = '" + p + "' AND channel = 'CC')"
	default:
		// No product chosen — the union of every eligible group, NOT everybody.
		return "(channel = 'CC' OR (product = 'SME' AND lower(role) LIKE '%manager%'))"
	}
}

// GetDigitalDirectory — GET /api/digital-data/directory?product=LBF&forDistribution=1
//
// With forDistribution=1 the result is restricted to the people who may
// actually receive that product's leads (see distributionRule). Without it the
// whole synced directory is returned, which is only useful for browsing.
func GetDigitalDirectory(c *gin.Context) {
	var conds []string
	var args []interface{}
	add := func(cond string, v interface{}) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}

	conds = append(conds, "is_active = true")

	product := strings.TrimSpace(c.Query("product"))
	if c.Query("forDistribution") == "1" {
		conds = append(conds, distributionRule(product))
	} else if product != "" {
		add("product = $%d", strings.ToUpper(product))
	}

	if v := strings.TrimSpace(c.Query("channel")); v != "" {
		add("channel = $%d", strings.ToUpper(v))
	}
	if v := strings.TrimSpace(c.Query("role")); v != "" {
		add("lower(role) LIKE '%%' || lower($%d) || '%%'", v)
	}
	if v := strings.TrimSpace(c.Query("cluster")); v != "" {
		add("cluster = $%d", v)
	}

	// The workbook lists a person once per branch they cover — the SME branch
	// manager appears three times (Arusha, Moshi, Tanga). For distribution they
	// must collapse to one assignee, or round-robin would "spread" leads across
	// three copies of the same human. Their branches are joined into one label
	// and their existing load is summed across every row they own.
	query := `
		SELECT d.id::text, COALESCE(d.zone,''), COALESCE(d.branch,''), d.full_name,
		       COALESCE(d.role,''), COALESCE(d.phone,''), COALESCE(d.email,''),
		       COALESCE(d.cluster,''), COALESCE(d.product,''), COALESCE(d.channel,''),
		       d.source_tab,
		       (SELECT COUNT(*) FROM digital_distributions x WHERE x.directory_id = d.id)
		  FROM digital_directory d
		 WHERE ` + strings.Join(conds, " AND ") + `
		 ORDER BY d.product, d.branch, d.full_name`

	if c.Query("forDistribution") == "1" {
		query = `
			WITH eligible AS (
			  SELECT * FROM digital_directory d WHERE ` + strings.Join(conds, " AND ") + `
			), person AS (
			  SELECT COALESCE(NULLIF(lower(email),''), lower(full_name)) AS pkey,
			         MIN(id::text)                                       AS id,
			         MIN(full_name)                                      AS full_name,
			         MIN(role)                                           AS role,
			         MIN(phone)                                          AS phone,
			         MIN(email)                                          AS email,
			         MIN(zone)                                           AS zone,
			         MIN(cluster)                                        AS cluster,
			         MIN(product)                                        AS product,
			         MIN(channel)                                        AS channel,
			         MIN(source_tab)                                     AS source_tab,
			         string_agg(DISTINCT branch, ', ' ORDER BY branch)   AS branches,
			         array_agg(id)                                       AS ids
			    FROM eligible GROUP BY 1
			)
			SELECT p.id, COALESCE(p.zone,''), COALESCE(p.branches,''), p.full_name,
			       COALESCE(p.role,''), COALESCE(p.phone,''), COALESCE(p.email,''),
			       COALESCE(p.cluster,''), COALESCE(p.product,''), COALESCE(p.channel,''),
			       p.source_tab,
			       (SELECT COUNT(*) FROM digital_distributions x WHERE x.directory_id = ANY(p.ids))
			  FROM person p
			 ORDER BY p.product, p.full_name`
	}

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "query directory", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var id, zone, branch, name, role, phone, email, cluster, product, channel, tab string
		var load int
		if err := rows.Scan(&id, &zone, &branch, &name, &role, &phone, &email,
			&cluster, &product, &channel, &tab, &load); err == nil {
			out = append(out, gin.H{
				"id": id, "zone": zone, "branch": branch, "name": name, "role": role,
				"phone": phone, "email": email, "cluster": cluster, "product": product,
				"channel": channel, "sourceTab": tab, "currentLoad": load,
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "people": out})
}

// ---------------------------------------------------------------- distribution

type distributeRequest struct {
	// Either an explicit list of leads (per-lead control) …
	LeadIDs []string `json:"leadIds"`
	// … or a filter describing the scope, resolved server-side. This is how
	// "distribute everything the dropdowns select" works without POSTing tens
	// of thousands of ids.
	Filter map[string]string `json:"filter"`

	AssigneeIDs []string `json:"assigneeIds"` // digital_directory ids
	Method      string   `json:"method"`      // ROUND_ROBIN | MANUAL
	Note        string   `json:"note"`
	Product     string   `json:"product"`
}

// maxDistributionSize bounds a single distribution action. The whole cleaned
// set is ~37k leads; this stops a mis-click assigning far more than intended
// while still being well above any realistic batch.
const maxDistributionSize = 100000

// DistributeDigitalLeads — POST /api/digital-data/distribute
//
// Spreads the chosen leads across the chosen people round-robin and records the
// batch. A lead that already has an owner MOVES to the new one — that is how
// "update distribution" works, there is no separate endpoint for it.
func DistributeDigitalLeads(c *gin.Context) {
	var req distributeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ddFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}
	if len(req.AssigneeIDs) == 0 {
		ddFail(c, http.StatusBadRequest, "no assignees selected", nil)
		return
	}
	if req.Method != "MANUAL" {
		req.Method = "ROUND_ROBIN"
	}

	// Resolve the scope when no explicit selection was given.
	leadIDs := req.LeadIDs
	if len(leadIDs) == 0 {
		if req.Filter == nil {
			ddFail(c, http.StatusBadRequest, "no leads selected and no filter given", nil)
			return
		}
		where, args := ddFiltersFromMap(req.Filter)
		args = append(args, maxDistributionSize)
		rows, err := database.DB.Query(`
			SELECT id FROM digital_leads `+where+`
			 ORDER BY lead_date DESC NULLS LAST, created_at DESC
			 LIMIT $`+strconv.Itoa(len(args)), args...)
		if err != nil {
			ddFail(c, http.StatusInternalServerError, "resolve lead scope", err)
			return
		}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				leadIDs = append(leadIDs, id)
			}
		}
		rows.Close()
	}
	if len(leadIDs) == 0 {
		ddFail(c, http.StatusBadRequest, "no leads match the current selection", nil)
		return
	}

	// Load the chosen people. The routing rule is re-applied here so an
	// ineligible assignee (branch staff, say) cannot be slipped in by posting
	// their id directly — the UI filter is a convenience, not the control.
	type person struct {
		id, name, email, phone, role, branch, cluster, zone string
	}
	people := make([]person, 0, len(req.AssigneeIDs))
	rejected := 0
	for _, id := range req.AssigneeIDs {
		var p person
		err := database.DB.QueryRow(`
			SELECT id, full_name, COALESCE(email,''), COALESCE(phone,''), COALESCE(role,''),
			       COALESCE(branch,''), COALESCE(cluster,''), COALESCE(zone,'')
			  FROM digital_directory
			 WHERE id = $1 AND is_active = true AND `+distributionRule(req.Product), id).
			Scan(&p.id, &p.name, &p.email, &p.phone, &p.role, &p.branch, &p.cluster, &p.zone)
		if err != nil {
			rejected++
			continue
		}
		people = append(people, p)
	}
	if len(people) == 0 {
		ddFail(c, http.StatusBadRequest,
			"none of the selected assignees may receive these leads "+
				"(digital leads go to the LBF/CS call centres and SME branch managers only)", nil)
		return
	}

	var uid interface{}
	if id, err := middleware.GetUserIDFromContext(c); err == nil && id != uuid.Nil {
		uid = id.String()
	}

	tx, err := database.DB.Begin()
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "begin", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var batchID string
	err = tx.QueryRow(`
		INSERT INTO digital_distribution_batches
		  (created_by, product, method, note, lead_count, assignee_count)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		uid, nullIfEmpty(strings.ToUpper(req.Product)), req.Method,
		nullIfEmpty(req.Note), len(leadIDs), len(people)).Scan(&batchID)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "create batch", err)
		return
	}

	// How many of these already had an owner — i.e. this action is an update
	// for them, not a first assignment.
	reassigned := 0
	_ = tx.QueryRow(`SELECT COUNT(*) FROM digital_distributions WHERE lead_id = ANY($1)`,
		pq.Array(leadIDs)).Scan(&reassigned)

	assigned := 0
	for i, leadID := range leadIDs {
		p := people[i%len(people)]
		_, err := tx.Exec(`
			INSERT INTO digital_distributions
			  (batch_id, lead_id, directory_id, assignee_name, assignee_email,
			   assignee_phone, assignee_role, branch, cluster, zone)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (lead_id) DO UPDATE SET
			  batch_id = EXCLUDED.batch_id, directory_id = EXCLUDED.directory_id,
			  assignee_name = EXCLUDED.assignee_name, assignee_email = EXCLUDED.assignee_email,
			  assignee_phone = EXCLUDED.assignee_phone, assignee_role = EXCLUDED.assignee_role,
			  branch = EXCLUDED.branch, cluster = EXCLUDED.cluster, zone = EXCLUDED.zone,
			  -- a re-assigned lead has not been sent to its NEW owner yet
			  status = 'ASSIGNED', assigned_at = NOW(),
			  sent_at = NULL, sent_to = NULL, send_error = NULL`,
			batchID, leadID, p.id, p.name, nullIfEmpty(p.email), nullIfEmpty(p.phone),
			nullIfEmpty(p.role), nullIfEmpty(p.branch), nullIfEmpty(p.cluster), nullIfEmpty(p.zone))
		if err != nil {
			ddFail(c, http.StatusInternalServerError, "assign lead "+leadID, err)
			return
		}
		assigned++
	}

	if _, err := tx.Exec(`UPDATE digital_distribution_batches SET lead_count = $2 WHERE id = $1`,
		batchID, assigned); err != nil {
		ddFail(c, http.StatusInternalServerError, "update batch", err)
		return
	}

	if err := tx.Commit(); err != nil {
		ddFail(c, http.StatusInternalServerError, "commit", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "batchId": batchID,
		"assigned": assigned, "assignees": len(people),
		"rejectedAssignees": rejected,
		"reassigned":        reassigned, // of `assigned`, how many changed owner
	})
}

// GetDigitalDistributions — GET /api/digital-data/distributions?limit=20
//
// Batch history, each with its per-assignee breakdown.
func GetDigitalDistributions(c *gin.Context) {
	limit := ddIntQuery(c, "limit", 20, 1, 100)

	rows, err := database.DB.Query(`
		SELECT b.id, b.created_at, COALESCE(b.product,''), b.method,
		       COALESCE(b.note,''), b.lead_count, b.assignee_count,
		       COALESCE(u.full_name, '')
		  FROM digital_distribution_batches b
		  LEFT JOIN users u ON u.id = b.created_by
		 ORDER BY b.created_at DESC LIMIT $1`, limit)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "query batches", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var id, product, method, note, by string
		var created time.Time
		var leads, assignees int
		if err := rows.Scan(&id, &created, &product, &method, &note, &leads, &assignees, &by); err != nil {
			continue
		}

		brk := []gin.H{}
		bRows, err := database.DB.Query(`
			SELECT assignee_name, COALESCE(assignee_email,''), COALESCE(branch,''), COUNT(*)
			  FROM digital_distributions WHERE batch_id = $1
			 GROUP BY assignee_name, assignee_email, branch ORDER BY 4 DESC`, id)
		if err == nil {
			for bRows.Next() {
				var n, e, br string
				var cnt int
				if bRows.Scan(&n, &e, &br, &cnt) == nil {
					brk = append(brk, gin.H{"name": n, "email": e, "branch": br, "leads": cnt})
				}
			}
			bRows.Close()
		}

		out = append(out, gin.H{
			"id": id, "createdAt": created, "product": product, "method": method,
			"note": note, "leadCount": leads, "assigneeCount": assignees,
			"createdBy": by, "breakdown": brk,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "batches": out})
}

// ------------------------------------------------------------------- helpers

func ddIntQuery(c *gin.Context, key string, def, lo, hi int) int {
	v, err := strconv.Atoi(c.Query(key))
	if err != nil || v < lo || v > hi {
		return def
	}
	return v
}

func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// ddLeadFilters builds the shared WHERE clause from the request's query string.
func ddLeadFilters(c *gin.Context) (string, []interface{}) {
	return ddBuildLeadFilters(c.Query)
}

// ddFiltersFromMap builds the same clause from a JSON filter object, so a
// distribution can be scoped by "everything the dropdowns select" without the
// client having to POST tens of thousands of lead ids.
func ddFiltersFromMap(m map[string]string) (string, []interface{}) {
	return ddBuildLeadFilters(func(k string) string { return m[k] })
}

// ddBuildLeadFilters is the single definition of what the lead filters mean.
// `get` supplies a value for a filter name, whatever its source.
func ddBuildLeadFilters(get func(string) string) (string, []interface{}) {
	var conds []string
	var args []interface{}
	add := func(tmpl string, v interface{}) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(tmpl, len(args)))
	}
	c := struct{ Query func(string) string }{Query: get}

	// Default to inbound digital leads only; the CS payroll tabs are separate.
	switch strings.ToLower(c.Query("kind")) {
	case "all":
		// no constraint
	case "payroll":
		conds = append(conds, "tab_kind = 'payroll_campaign'")
	default:
		conds = append(conds, "tab_kind = 'social_lead'")
	}

	if v := strings.TrimSpace(c.Query("product")); v != "" {
		add("product = $%d", strings.ToUpper(v))
	}
	if v := strings.TrimSpace(c.Query("platform")); v != "" {
		add("platform = $%d", strings.ToLower(v))
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		add("status_canonical = $%d", strings.ToUpper(v))
	}
	if v := strings.TrimSpace(c.Query("month")); v != "" {
		add("lead_month = $%d", v)
	}
	if v := strings.TrimSpace(c.Query("book")); v != "" {
		add("source_book = $%d", strings.ToUpper(v))
	}
	if v := strings.TrimSpace(c.Query("search")); v != "" {
		// One bound value referenced twice — match on either phone or name.
		args = append(args, v)
		n := len(args)
		conds = append(conds, fmt.Sprintf(
			"(phone_e164 LIKE '%%' || $%d || '%%' OR lower(lead_name) LIKE '%%' || lower($%d) || '%%')", n, n))
	}
	if c.Query("unique") == "1" {
		conds = append(conds, "is_primary = true")
	}
	if c.Query("validOnly") == "1" {
		conds = append(conds, "phone_valid = true")
	}
	if c.Query("unassigned") == "1" {
		conds = append(conds, "NOT EXISTS (SELECT 1 FROM digital_distributions dd WHERE dd.lead_id = digital_leads.id)")
	}
	if c.Query("assigned") == "1" {
		conds = append(conds, "EXISTS (SELECT 1 FROM digital_distributions dd WHERE dd.lead_id = digital_leads.id)")
	}
	if v := strings.TrimSpace(c.Query("batchId")); v != "" {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM digital_distributions dd WHERE dd.lead_id = digital_leads.id AND dd.batch_id = $%d)", len(args)))
	}

	if len(conds) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conds, " AND "), args
}

// ddAndWhere adapts the shared clause for queries that already have a FROM
// with a lateral join.
func ddAndWhere(where string) string {
	if where == "" {
		return ""
	}
	return where
}

// ddGroupCount returns [{key,count}] for a grouping expression.
func ddGroupCount(expr, where string, args []interface{}) ([]gin.H, error) {
	rows, err := database.DB.Query(
		`SELECT `+expr+` AS k, COUNT(*) FROM digital_leads `+where+
			` GROUP BY 1 ORDER BY 2 DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var k string
		var n int
		if rows.Scan(&k, &n) == nil {
			out = append(out, gin.H{"key": k, "count": n})
		}
	}
	return out, nil
}
