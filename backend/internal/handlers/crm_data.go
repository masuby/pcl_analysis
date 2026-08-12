package handlers

// CRM — accumulating lead store, distributed to branch Team Leaders.
//
//	POST /api/crm/upload           merge a Lead_Report into the store
//	GET  /api/crm/uploads          upload history
//	GET  /api/crm/summary          headline counts + breakdowns
//	GET  /api/crm/leads            filtered + paginated
//	GET  /api/crm/filters          distinct values for the filter bar
//	GET  /api/crm/team-leaders     TLs, with the branches and lead counts they cover
//	POST /api/crm/distribute       assign leads to Team Leaders
//	GET  /api/crm/distributions    distribution history
//
// Sending is in crm_data_send.go.

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/services/crmdata"
)

func crmFail(c *gin.Context, code int, msg string, err error) {
	if err != nil {
		msg = msg + ": " + err.Error()
	}
	c.JSON(code, gin.H{"success": false, "error": msg})
}

func crmUserID(c *gin.Context) interface{} {
	if id, err := middleware.GetUserIDFromContext(c); err == nil && id != uuid.Nil {
		return id.String()
	}
	return nil
}

// ---------------------------------------------------------------------- upload

// UploadCRMLeads — POST /api/crm/upload  (multipart, field "file")
//
// Merges the workbook into crm_leads: unseen phone numbers are appended,
// numbers already held are updated in place.
func UploadCRMLeads(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		crmFail(c, http.StatusBadRequest, "no file uploaded", err)
		return
	}
	if !strings.HasSuffix(strings.ToLower(fileHeader.Filename), ".xlsx") {
		crmFail(c, http.StatusBadRequest, "expected an .xlsx Lead_Report file", nil)
		return
	}

	// uploadPath is the package-level storage root, set from config at startup.
	dir := filepath.Join(uploadPath, "crm")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		crmFail(c, http.StatusInternalServerError, "cannot create upload dir", err)
		return
	}
	// Timestamped so each upload is retained for audit rather than overwritten.
	stamp := time.Now().Format("20060102_150405")
	safe := strings.ReplaceAll(filepath.Base(fileHeader.Filename), " ", "_")
	path := filepath.Join(dir, stamp+"_"+safe)
	if err := c.SaveUploadedFile(fileHeader, path); err != nil {
		crmFail(c, http.StatusInternalServerError, "cannot save upload", err)
		return
	}

	var uploadID string
	err = database.DB.QueryRow(`
		INSERT INTO crm_uploads (file_name, file_size, uploaded_by)
		VALUES ($1,$2,$3) RETURNING id`,
		fileHeader.Filename, fileHeader.Size, crmUserID(c)).Scan(&uploadID)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "cannot record upload", err)
		return
	}

	failUpload := func(cause error) {
		_, _ = database.DB.Exec(`
			UPDATE crm_uploads SET status='FAILED', error=$2, finished_at=NOW()
			 WHERE id=$1`, uploadID, cause.Error())
	}

	rows, skipped, err := crmdata.ParseWorkbook(path)
	if err != nil {
		failUpload(err)
		crmFail(c, http.StatusBadRequest, "could not read the workbook", err)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Minute)
	defer cancel()

	res, err := crmdata.Merge(ctx, uploadID, rows, skipped)
	if err != nil {
		failUpload(err)
		crmFail(c, http.StatusInternalServerError, "merge failed", err)
		return
	}

	_, _ = database.DB.Exec(`
		UPDATE crm_uploads
		   SET status='SUCCESS', finished_at=NOW(), rows_read=$2, rows_inserted=$3,
		       rows_updated=$4, rows_skipped=$5, bad_phones=$6
		 WHERE id=$1`,
		uploadID, res.RowsRead, res.Inserted, res.Updated, res.Skipped, res.BadPhones)

	c.JSON(http.StatusOK, gin.H{"success": true, "result": res})
}

// GetCRMUploads — GET /api/crm/uploads?limit=20
func GetCRMUploads(c *gin.Context) {
	limit := ddIntQuery(c, "limit", 20, 1, 100)
	rows, err := database.DB.Query(`
		SELECT u.id, u.file_name, u.rows_read, u.rows_inserted, u.rows_updated,
		       u.rows_skipped, u.bad_phones, u.status, COALESCE(u.error,''),
		       u.created_at, COALESCE(x.display_name,'')
		  FROM crm_uploads u
		  LEFT JOIN users x ON x.id = u.uploaded_by
		 ORDER BY u.created_at DESC LIMIT $1`, limit)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query uploads", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var id, name, status, errMsg, by string
		var read, ins, upd, skip, bad int
		var at time.Time
		if rows.Scan(&id, &name, &read, &ins, &upd, &skip, &bad, &status, &errMsg, &at, &by) == nil {
			e := gin.H{"id": id, "fileName": name, "rowsRead": read,
				"inserted": ins, "updated": upd, "skipped": skip, "badPhones": bad,
				"status": status, "createdAt": at, "uploadedBy": by}
			if errMsg != "" {
				e["error"] = errMsg
			}
			out = append(out, e)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "uploads": out})
}

// --------------------------------------------------------------------- filters

// crmFilters builds the shared WHERE clause for the lead queries.
func crmFilters(c *gin.Context) (string, []interface{}) {
	var conds []string
	var args []interface{}
	add := func(tmpl string, v interface{}) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(tmpl, len(args)))
	}

	if v := strings.TrimSpace(c.Query("status")); v != "" {
		add("status = $%d", v)
	}
	if v := strings.TrimSpace(c.Query("branch")); v != "" {
		add("branch = $%d", v)
	}
	if v := strings.TrimSpace(c.Query("region")); v != "" {
		add("region = $%d", v)
	}
	if v := strings.TrimSpace(c.Query("team")); v != "" {
		add("team_name = $%d", v)
	}
	if v := strings.TrimSpace(c.Query("assignedTo")); v != "" {
		add("assigned_to = $%d", v)
	}
	if v := strings.TrimSpace(c.Query("search")); v != "" {
		args = append(args, v)
		n := len(args)
		conds = append(conds, fmt.Sprintf(
			"(phone_norm LIKE '%%' || $%d || '%%' OR lower(lead_name) LIKE '%%' || lower($%d) || '%%')", n, n))
	}
	if c.Query("validOnly") == "1" {
		conds = append(conds, "phone_valid = true")
	}
	if c.Query("unassigned") == "1" {
		conds = append(conds, "NOT EXISTS (SELECT 1 FROM crm_distributions d WHERE d.lead_id = crm_leads.id)")
	}
	if c.Query("assigned") == "1" {
		conds = append(conds, "EXISTS (SELECT 1 FROM crm_distributions d WHERE d.lead_id = crm_leads.id)")
	}
	// Only leads whose branch maps to a Team Leader — the distributable set.
	if c.Query("routable") == "1" {
		conds = append(conds, `COALESCE(branch_key,'') <> '' AND EXISTS (
			SELECT 1 FROM digital_directory dd
			 WHERE dd.is_active AND lower(dd.role) LIKE '%team leader%'
			   AND crm_branch_key(dd.branch) = crm_leads.branch_key
			   -- product must agree when the branch names one, so a CS call
			   -- centre lead never reaches an LBF team leader
			   AND (crm_leads.product_hint = '' OR dd.product = crm_leads.product_hint))`)
	}

	if len(conds) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conds, " AND "), args
}

// GetCRMSummary — GET /api/crm/summary
func GetCRMSummary(c *gin.Context) {
	where, args := crmFilters(c)

	var total, valid, assigned, routable, converted int
	err := database.DB.QueryRow(`
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE phone_valid),
		       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_distributions d WHERE d.lead_id = crm_leads.id)),
		       COUNT(*) FILTER (WHERE COALESCE(branch_key,'') <> '' AND EXISTS (
		           SELECT 1 FROM digital_directory dd
		            WHERE dd.is_active AND lower(dd.role) LIKE '%team leader%'
		              AND crm_branch_key(dd.branch) = crm_leads.branch_key
		              AND (crm_leads.product_hint = '' OR dd.product = crm_leads.product_hint))),
		       COUNT(*) FILTER (WHERE lower(status) = 'converted')
		  FROM crm_leads `+where, args...).
		Scan(&total, &valid, &assigned, &routable, &converted)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "summary totals", err)
		return
	}

	group := func(expr string) []gin.H {
		rows, err := database.DB.Query(
			`SELECT COALESCE(NULLIF(`+expr+`,''),'—') k, COUNT(*) FROM crm_leads `+where+
				` GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, args...)
		if err != nil {
			return []gin.H{}
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
		return out
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"totals": gin.H{
			"leads": total, "validPhones": valid, "assigned": assigned,
			"unassigned": total - assigned, "routable": routable,
			"unroutable": total - routable, "converted": converted,
		},
		"byStatus": group("status"),
		"byBranch": group("branch"),
		"byRegion": group("region"),
		"byTeam":   group("team_name"),
	})
}

// GetCRMFilters — GET /api/crm/filters
func GetCRMFilters(c *gin.Context) {
	get := func(col string) []string {
		rows, err := database.DB.Query(
			`SELECT DISTINCT ` + col + ` FROM crm_leads
			  WHERE ` + col + ` IS NOT NULL AND ` + col + ` <> '' ORDER BY 1 LIMIT 300`)
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
		"success":  true,
		"statuses": get("status"),
		"branches": get("branch"),
		"regions":  get("region"),
		"teams":    get("team_name"),
	})
}

// ----------------------------------------------------------------------- leads

// GetCRMLeads — GET /api/crm/leads
func GetCRMLeads(c *gin.Context) {
	where, args := crmFilters(c)

	page := ddIntQuery(c, "page", 1, 1, 100000)
	size := ddIntQuery(c, "pageSize", 50, 1, 2000)
	offset := (page - 1) * size

	var total int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM crm_leads `+where, args...).Scan(&total); err != nil {
		crmFail(c, http.StatusInternalServerError, "count leads", err)
		return
	}

	q := `
		SELECT id, phone_norm, COALESCE(phone_raw,''), phone_valid,
		       COALESCE(lead_name,''), COALESCE(email_address,''),
		       COALESCE(team_name,''), COALESCE(assigned_to,''),
		       COALESCE(status,''), COALESCE(branch,''), COALESCE(region,''),
		       COALESCE(location,''), COALESCE(consent_status,''),
		       consent_date, created_date, COALESCE(comment,''),
		       COALESCE(total_affordability,0), update_count,
		       COALESCE((SELECT d.assignee_name  FROM crm_distributions d WHERE d.lead_id = crm_leads.id),''),
		       COALESCE((SELECT d.assignee_email FROM crm_distributions d WHERE d.lead_id = crm_leads.id),''),
		       COALESCE((SELECT d.status         FROM crm_distributions d WHERE d.lead_id = crm_leads.id),''),
		       (SELECT d.sent_at FROM crm_distributions d WHERE d.lead_id = crm_leads.id)
		  FROM crm_leads ` + where + `
		 ORDER BY created_date DESC NULLS LAST, updated_at DESC
		 LIMIT $` + strconv.Itoa(len(args)+1) + ` OFFSET $` + strconv.Itoa(len(args)+2)
	args = append(args, size, offset)

	rows, err := database.DB.Query(q, args...)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query leads", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var (
			id, phone, phoneRaw, name, email, team, assignedTo string
			status, branch, region, location, consentStatus    string
			comment, asgName, asgEmail, asgStatus              string
			consentDate, createdDate, sentAt                   interface{}
			afford                                             float64
			updateCount                                        int
			phoneValid                                         bool
		)
		if err := rows.Scan(&id, &phone, &phoneRaw, &phoneValid, &name, &email,
			&team, &assignedTo, &status, &branch, &region, &location,
			&consentStatus, &consentDate, &createdDate, &comment, &afford,
			&updateCount, &asgName, &asgEmail, &asgStatus, &sentAt); err != nil {
			continue
		}
		item := gin.H{
			"id": id, "phone": phone, "phoneRaw": phoneRaw, "phoneValid": phoneValid,
			"name": name, "email": email, "team": team, "crmAssignedTo": assignedTo,
			"status": status, "branch": branch, "region": region, "location": location,
			"consentStatus": consentStatus, "comment": comment,
			"affordability": afford, "updateCount": updateCount,
		}
		if t, ok := consentDate.(time.Time); ok {
			item["consentDate"] = t.Format("2006-01-02")
		}
		if t, ok := createdDate.(time.Time); ok {
			item["createdDate"] = t.Format("2006-01-02")
		}
		if asgName != "" {
			a := gin.H{"name": asgName, "email": asgEmail, "status": asgStatus}
			if t, ok := sentAt.(time.Time); ok {
				a["sentAt"] = t.Format("2006-01-02 15:04")
			}
			item["assignee"] = a
		}
		out = append(out, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "leads": out, "page": page, "pageSize": size, "total": total,
	})
}

// ---------------------------------------------------------------- team leaders

// GetCRMTeamLeaders — GET /api/crm/team-leaders
//
// The distribution targets: Team Leaders from the Zone & Clusters directory,
// each with the number of CRM leads whose branch maps to theirs. A TL covering
// no leads is still listed, so it is obvious when a branch has nobody.
func GetCRMTeamLeaders(c *gin.Context) {
	rows, err := database.DB.Query(`
		WITH tl AS (
		  SELECT COALESCE(NULLIF(lower(email),''), lower(full_name)) AS pkey,
		         MIN(id::text)                                     AS id,
		         MIN(full_name)                                    AS full_name,
		         MIN(role)                                         AS role,
		         MIN(email)                                        AS email,
		         MIN(phone)                                        AS phone,
		         MIN(zone)                                         AS zone,
		         MIN(product)                                      AS product,
		         string_agg(DISTINCT branch, ', ' ORDER BY branch) AS branches,
		         array_agg(DISTINCT crm_branch_key(branch))        AS branch_keys,
		         array_agg(id)                                     AS ids
		    FROM digital_directory
		   WHERE is_active AND lower(role) LIKE '%team leader%'
		     AND branch IS NOT NULL AND branch <> ''
		   GROUP BY 1
		)
		SELECT tl.id, tl.full_name, COALESCE(tl.role,''), COALESCE(tl.email,''),
		       COALESCE(tl.phone,''), COALESCE(tl.zone,''), COALESCE(tl.branches,''),
		       (SELECT COUNT(*) FROM crm_leads l
		         WHERE l.branch_key = ANY(tl.branch_keys)
		           AND (l.product_hint = '' OR l.product_hint = tl.product)),
		       (SELECT COUNT(*) FROM crm_distributions d WHERE d.directory_id = ANY(tl.ids))
		  FROM tl ORDER BY tl.full_name`)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query team leaders", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var id, name, role, email, phone, zone, branches string
		var leadsInBranch, currentLoad int
		if rows.Scan(&id, &name, &role, &email, &phone, &zone, &branches,
			&leadsInBranch, &currentLoad) == nil {
			out = append(out, gin.H{
				"id": id, "name": name, "role": role, "email": email, "phone": phone,
				"zone": zone, "branches": branches,
				"leadsInBranch": leadsInBranch, "currentLoad": currentLoad,
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "teamLeaders": out})
}

// ---------------------------------------------------------------- distribution

type crmDistributeRequest struct {
	LeadIDs     []string          `json:"leadIds"`
	Filter      map[string]string `json:"filter"`
	AssigneeIDs []string          `json:"assigneeIds"` // empty = route each lead by its branch
	Method      string            `json:"method"`      // BY_BRANCH | ROUND_ROBIN | MANUAL
	Note        string            `json:"note"`
}

const crmMaxDistribution = 200000

// DistributeCRMLeads — POST /api/crm/distribute
//
// Default (BY_BRANCH) gives each lead to a Team Leader of its own branch, which
// is the point of the CRM flow. ROUND_ROBIN spreads the selection evenly across
// explicitly chosen TLs instead.
func DistributeCRMLeads(c *gin.Context) {
	var req crmDistributeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		crmFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}
	if req.Method == "" {
		req.Method = "BY_BRANCH"
	}
	if req.Method != "BY_BRANCH" && req.Method != "ROUND_ROBIN" && req.Method != "MANUAL" {
		crmFail(c, http.StatusBadRequest, "method must be BY_BRANCH, ROUND_ROBIN or MANUAL", nil)
		return
	}
	if req.Method != "BY_BRANCH" && len(req.AssigneeIDs) == 0 {
		crmFail(c, http.StatusBadRequest, "no team leaders selected", nil)
		return
	}

	// Resolve the lead scope.
	leadIDs := req.LeadIDs
	if len(leadIDs) == 0 {
		if req.Filter == nil {
			crmFail(c, http.StatusBadRequest, "no leads selected and no filter given", nil)
			return
		}
		where, args := crmFiltersFromMap(req.Filter)
		args = append(args, crmMaxDistribution)
		rows, err := database.DB.Query(`
			SELECT id FROM crm_leads `+where+`
			 ORDER BY created_date DESC NULLS LAST
			 LIMIT $`+strconv.Itoa(len(args)), args...)
		if err != nil {
			crmFail(c, http.StatusInternalServerError, "resolve lead scope", err)
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
		crmFail(c, http.StatusBadRequest, "no leads match the current selection", nil)
		return
	}

	tx, err := database.DB.Begin()
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "begin", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var batchID string
	if err := tx.QueryRow(`
		INSERT INTO crm_distribution_batches (created_by, method, note, lead_count, assignee_count)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		crmUserID(c), req.Method, nullIfEmpty(req.Note),
		len(leadIDs), len(req.AssigneeIDs)).Scan(&batchID); err != nil {
		crmFail(c, http.StatusInternalServerError, "create batch", err)
		return
	}

	var assigned, unroutable int

	if req.Method == "BY_BRANCH" {
		// One statement: join each lead to a Team Leader of its own branch.
		// DISTINCT ON keeps a single TL per lead when a branch has several.
		res, err := tx.Exec(`
			INSERT INTO crm_distributions
			  (batch_id, lead_id, directory_id, assignee_name, assignee_email,
			   assignee_phone, assignee_role, branch, region)
			SELECT DISTINCT ON (l.id)
			       $1, l.id, d.id, d.full_name, d.email, d.phone, d.role, l.branch, l.region
			  FROM crm_leads l
			  JOIN digital_directory d
			    ON d.is_active
			   AND lower(d.role) LIKE '%team leader%'
			   AND crm_branch_key(d.branch) = l.branch_key
			   AND (l.product_hint = '' OR d.product = l.product_hint)
			 WHERE l.id = ANY($2::uuid[]) AND COALESCE(l.branch_key,'') <> ''
			 ORDER BY l.id, d.full_name
			ON CONFLICT (lead_id) DO UPDATE SET
			  batch_id = EXCLUDED.batch_id, directory_id = EXCLUDED.directory_id,
			  assignee_name = EXCLUDED.assignee_name, assignee_email = EXCLUDED.assignee_email,
			  assignee_phone = EXCLUDED.assignee_phone, assignee_role = EXCLUDED.assignee_role,
			  branch = EXCLUDED.branch, region = EXCLUDED.region,
			  status = 'ASSIGNED', assigned_at = NOW(),
			  sent_at = NULL, sent_to = NULL, send_error = NULL`,
			batchID, pq.Array(leadIDs))
		if err != nil {
			crmFail(c, http.StatusInternalServerError, "assign by branch", err)
			return
		}
		n, _ := res.RowsAffected()
		assigned = int(n)
		unroutable = len(leadIDs) - assigned
	} else {
		people, err := crmLoadTeamLeaders(tx, req.AssigneeIDs)
		if err != nil {
			crmFail(c, http.StatusInternalServerError, "load team leaders", err)
			return
		}
		if len(people) == 0 {
			crmFail(c, http.StatusBadRequest, "none of the selected people are active Team Leaders", nil)
			return
		}
		for i, leadID := range leadIDs {
			p := people[i%len(people)]
			if _, err := tx.Exec(`
				INSERT INTO crm_distributions
				  (batch_id, lead_id, directory_id, assignee_name, assignee_email,
				   assignee_phone, assignee_role, branch, region)
				SELECT $1, l.id, $3, $4, $5, $6, $7, l.branch, l.region
				  FROM crm_leads l WHERE l.id = $2
				ON CONFLICT (lead_id) DO UPDATE SET
				  batch_id = EXCLUDED.batch_id, directory_id = EXCLUDED.directory_id,
				  assignee_name = EXCLUDED.assignee_name, assignee_email = EXCLUDED.assignee_email,
				  assignee_phone = EXCLUDED.assignee_phone, assignee_role = EXCLUDED.assignee_role,
				  status = 'ASSIGNED', assigned_at = NOW(),
				  sent_at = NULL, sent_to = NULL, send_error = NULL`,
				batchID, leadID, p.id, p.name, nullIfEmpty(p.email),
				nullIfEmpty(p.phone), nullIfEmpty(p.role)); err != nil {
				crmFail(c, http.StatusInternalServerError, "assign lead "+leadID, err)
				return
			}
			assigned++
		}
	}

	if _, err := tx.Exec(`UPDATE crm_distribution_batches SET lead_count=$2 WHERE id=$1`,
		batchID, assigned); err != nil {
		crmFail(c, http.StatusInternalServerError, "update batch", err)
		return
	}
	if err := tx.Commit(); err != nil {
		crmFail(c, http.StatusInternalServerError, "commit", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true, "batchId": batchID, "method": req.Method,
		"assigned": assigned, "unroutable": unroutable, "requested": len(leadIDs),
	})
}

type crmPerson struct{ id, name, email, phone, role string }

// crmLoadTeamLeaders resolves the chosen directory ids, re-applying the
// Team-Leader rule so an ineligible person cannot be slipped in by posting
// their id directly. The UI filter is a convenience, not the control.
func crmLoadTeamLeaders(tx *sql.Tx, ids []string) ([]crmPerson, error) {
	rows, err := tx.Query(`
		SELECT id::text, full_name, COALESCE(email,''), COALESCE(phone,''), COALESCE(role,'')
		  FROM digital_directory
		 WHERE id = ANY($1::uuid[]) AND is_active AND lower(role) LIKE '%team leader%'
		 ORDER BY full_name`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []crmPerson{}
	for rows.Next() {
		var p crmPerson
		if rows.Scan(&p.id, &p.name, &p.email, &p.phone, &p.role) == nil {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}

// GetCRMDistributions — GET /api/crm/distributions?limit=20
func GetCRMDistributions(c *gin.Context) {
	limit := ddIntQuery(c, "limit", 20, 1, 100)
	rows, err := database.DB.Query(`
		SELECT b.id, b.created_at, b.method, COALESCE(b.note,''),
		       b.lead_count, COALESCE(u.display_name,''),
		       (SELECT COUNT(DISTINCT assignee_name) FROM crm_distributions d WHERE d.batch_id = b.id),
		       (SELECT COUNT(*) FROM crm_distributions d WHERE d.batch_id = b.id AND d.sent_at IS NOT NULL)
		  FROM crm_distribution_batches b
		  LEFT JOIN users u ON u.id = b.created_by
		 ORDER BY b.created_at DESC LIMIT $1`, limit)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query batches", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var id, method, note, by string
		var created time.Time
		var leads, people, sent int
		if rows.Scan(&id, &created, &method, &note, &leads, &by, &people, &sent) != nil {
			continue
		}
		brk := []gin.H{}
		if b, err := database.DB.Query(`
			SELECT assignee_name, COALESCE(assignee_email,''), COALESCE(branch,''), COUNT(*)
			  FROM crm_distributions WHERE batch_id=$1
			 GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 60`, id); err == nil {
			for b.Next() {
				var n, e, br string
				var cnt int
				if b.Scan(&n, &e, &br, &cnt) == nil {
					brk = append(brk, gin.H{"name": n, "email": e, "branch": br, "leads": cnt})
				}
			}
			b.Close()
		}
		out = append(out, gin.H{
			"id": id, "createdAt": created, "method": method, "note": note,
			"leadCount": leads, "assigneeCount": people, "sentCount": sent,
			"createdBy": by, "breakdown": brk,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "batches": out})
}

// crmFiltersFromMap mirrors crmFilters for a JSON filter object.
func crmFiltersFromMap(m map[string]string) (string, []interface{}) {
	var conds []string
	var args []interface{}
	add := func(tmpl string, v interface{}) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(tmpl, len(args)))
	}
	if v := strings.TrimSpace(m["status"]); v != "" {
		add("status = $%d", v)
	}
	if v := strings.TrimSpace(m["branch"]); v != "" {
		add("branch = $%d", v)
	}
	if v := strings.TrimSpace(m["region"]); v != "" {
		add("region = $%d", v)
	}
	if v := strings.TrimSpace(m["team"]); v != "" {
		add("team_name = $%d", v)
	}
	if v := strings.TrimSpace(m["search"]); v != "" {
		args = append(args, v)
		n := len(args)
		conds = append(conds, fmt.Sprintf(
			"(phone_norm LIKE '%%' || $%d || '%%' OR lower(lead_name) LIKE '%%' || lower($%d) || '%%')", n, n))
	}
	if m["validOnly"] == "1" {
		conds = append(conds, "phone_valid = true")
	}
	if m["unassigned"] == "1" {
		conds = append(conds, "NOT EXISTS (SELECT 1 FROM crm_distributions d WHERE d.lead_id = crm_leads.id)")
	}
	if m["assigned"] == "1" {
		conds = append(conds, "EXISTS (SELECT 1 FROM crm_distributions d WHERE d.lead_id = crm_leads.id)")
	}
	if m["routable"] == "1" {
		conds = append(conds, `COALESCE(branch_key,'') <> '' AND EXISTS (
			SELECT 1 FROM digital_directory dd
			 WHERE dd.is_active AND lower(dd.role) LIKE '%team leader%'
			   AND crm_branch_key(dd.branch) = crm_leads.branch_key
			   -- product must agree when the branch names one, so a CS call
			   -- centre lead never reaches an LBF team leader
			   AND (crm_leads.product_hint = '' OR dd.product = crm_leads.product_hint))`)
	}
	if len(conds) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conds, " AND "), args
}
