package handlers

// Emailing a CRM pack — the same two-step as MAMBU: a preview that sends
// nothing and says exactly who would get which file, then an explicit send.
//
//   BRANCH   each branch workbook to that branch's Team Leaders.
//   CLUSTER  each cluster manager gets one zip: the cluster workbook plus
//            every branch workbook in the cluster.
//   ZONE     each zone manager gets one zip: the zone workbook plus every
//            branch workbook in the zone.
//
// The operator can add Cc addresses to a send — a manager who should see the
// distribution without being on the roster for it. They go on every email of
// that send and are recorded with it.
//
//	POST /api/crm/pack-send/preview
//	POST /api/crm/pack-send
//	GET  /api/crm/packs/:id/sends

import (
	"archive/zip"
	"fmt"
	"net/http"
	"net/smtp"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

type crmPackSendRequest struct {
	PackID   string   `json:"packId"`
	Mode     string   `json:"mode"`    // branch | cluster | zone
	Product  string   `json:"product"` // optional filter
	CC       []string `json:"cc"`
	TestMode bool     `json:"testMode"`
	Confirm  bool     `json:"confirm"`
}

func normaliseCRMPackMode(s string) string {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "BRANCH":
		return "BRANCH"
	case "CLUSTER":
		return "CLUSTER"
	case "ZONE":
		return "ZONE"
	}
	return ""
}

var emailShape = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// cleanEmailList trims, lower-cases and dedupes operator-typed addresses, and
// returns the ones that do not look like an address at all so the UI can say
// which one is wrong instead of failing the whole send.
func cleanEmailList(in []string) (ok []string, bad []string) {
	seen := map[string]bool{}
	for _, raw := range in {
		for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
			return r == ',' || r == ';' || r == ' ' || r == '\n'
		}) {
			e := strings.ToLower(strings.TrimSpace(part))
			if e == "" || seen[e] {
				continue
			}
			seen[e] = true
			if emailShape.MatchString(e) {
				ok = append(ok, e)
			} else {
				bad = append(bad, part)
			}
		}
	}
	return ok, bad
}

type crmPackFile struct {
	ID                                           uuid.UUID
	Product, Scope, Name, Cluster, Zone, RelPath string
	Rows                                         int
	Emails, Names                                []string
}

func loadCRMPackFiles(packID string, scopes ...string) ([]crmPackFile, error) {
	rows, err := database.DB.Query(
		`SELECT id, product, scope, name, COALESCE(cluster,''), COALESCE(zone,''), rel_path,
		        rows, COALESCE(emails,''), COALESCE(names,'')
		   FROM crm_pack_files
		  WHERE pack_id = $1 AND scope = ANY($2)
		  ORDER BY product, name`, packID, pqTextArray(scopes))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []crmPackFile
	for rows.Next() {
		var f crmPackFile
		var em, nm string
		if err := rows.Scan(&f.ID, &f.Product, &f.Scope, &f.Name, &f.Cluster, &f.Zone,
			&f.RelPath, &f.Rows, &em, &nm); err != nil {
			continue
		}
		f.Emails, f.Names = splitNonEmpty(em), splitNonEmpty(nm)
		out = append(out, f)
	}
	return out, rows.Err()
}

// buildCRMPackDistribution works out what a mode would send for a pack.
func buildCRMPackDistribution(packID, mode, product string) ([]distTarget, error) {
	branchFiles, err := loadCRMPackFiles(packID, ScopeBranch)
	if err != nil {
		return nil, err
	}
	keep := func(p string) bool { return product == "" || p == product }

	if mode == "BRANCH" {
		var out []distTarget
		for _, f := range branchFiles {
			if !keep(f.Product) || f.Rows == 0 {
				continue
			}
			out = append(out, distTarget{
				Product: f.Product, Target: f.Name, Rows: f.Rows,
				Emails: f.Emails, Names: f.Names,
				Files:    []string{filepath.Base(f.RelPath)},
				relPaths: []string{f.RelPath}, fileIDs: []uuid.UUID{f.ID},
			})
		}
		return out, nil
	}

	// CLUSTER and ZONE: the rollup file, then the branch files under it.
	scope := ScopeCluster
	under := func(f crmPackFile) string { return f.Cluster }
	if mode == "ZONE" {
		scope = ScopeZone
		under = func(f crmPackFile) string { return f.Zone }
	}
	tops, err := loadCRMPackFiles(packID, scope)
	if err != nil {
		return nil, err
	}
	type acc struct {
		t        distTarget
		branches int
	}
	byKey := map[string]*acc{}
	var order []string
	for _, f := range tops {
		if !keep(f.Product) {
			continue
		}
		k := f.Product + "|" + zoneKey(f.Name)
		byKey[k] = &acc{t: distTarget{
			Product: f.Product, Target: f.Name, Rows: f.Rows,
			Emails: f.Emails, Names: f.Names,
			relPaths: []string{f.RelPath}, fileIDs: []uuid.UUID{f.ID},
		}}
		order = append(order, k)
	}
	for _, f := range branchFiles {
		if !keep(f.Product) {
			continue
		}
		k := f.Product + "|" + zoneKey(under(f))
		a := byKey[k]
		if a == nil {
			continue // a branch under an Unknown cluster/zone has no rollup file
		}
		a.t.relPaths = append(a.t.relPaths, f.RelPath)
		a.t.fileIDs = append(a.t.fileIDs, f.ID)
		a.branches++
	}
	var out []distTarget
	for _, k := range order {
		a := byKey[k]
		if a.t.Rows == 0 {
			continue
		}
		for _, p := range a.t.relPaths {
			a.t.Files = append(a.t.Files, filepath.Base(p))
		}
		out = append(out, a.t)
	}
	return out, nil
}

// PreviewCRMPackDistribution — POST /api/crm/pack-send/preview
func PreviewCRMPackDistribution(c *gin.Context) {
	var req crmPackSendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		crmFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}
	mode := normaliseCRMPackMode(req.Mode)
	if mode == "" || req.PackID == "" {
		crmFail(c, http.StatusBadRequest, "a pack and a mode (branch, cluster or zone) are required", nil)
		return
	}
	cc, bad := cleanEmailList(req.CC)
	targets, err := buildCRMPackDistribution(req.PackID, mode, normaliseProduct(req.Product))
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "build preview", err)
		return
	}

	// Empty lists, not nulls — the UI iterates them.
	ready, blocked := []distTarget{}, []distTarget{}
	totalRows, totalEmails := 0, 0
	for _, t := range targets {
		if len(t.Emails) == 0 {
			blocked = append(blocked, t)
			continue
		}
		ready = append(ready, t)
		totalRows += t.Rows
		totalEmails += len(t.Emails)
	}
	notes := []string{}
	if mode != "BRANCH" {
		notes = append(notes, "Branches whose cluster or zone is not on the Zone and Clusters map "+
			"are not included here — send those by branch.")
	}
	if len(bad) > 0 {
		notes = append(notes, "Not an email address, ignored: "+strings.Join(bad, ", "))
	}

	sender, _ := emailCreds()
	c.JSON(http.StatusOK, gin.H{
		"success": true, "mode": mode, "packId": req.PackID,
		"willSend": ready, "cannotSend": blocked,
		"emailCount": len(ready), "addressCount": totalEmails, "rowCount": totalRows,
		"cc": cc, "invalidCc": bad, "notes": notes,
		"sender": sender, "emailReady": sender != "", "testRecipient": operatorEmail(),
	})
}

// SendCRMPackDistribution — POST /api/crm/pack-send
func SendCRMPackDistribution(c *gin.Context) {
	var req crmPackSendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		crmFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}
	mode := normaliseCRMPackMode(req.Mode)
	if mode == "" || req.PackID == "" {
		crmFail(c, http.StatusBadRequest, "a pack and a mode are required", nil)
		return
	}
	if !req.Confirm {
		crmFail(c, http.StatusBadRequest,
			"this sends real email to branch staff and cannot be undone — review the preview and confirm", nil)
		return
	}
	cc, bad := cleanEmailList(req.CC)
	if len(bad) > 0 {
		crmFail(c, http.StatusBadRequest, "not an email address: "+strings.Join(bad, ", "), nil)
		return
	}
	sender, password := emailCreds()
	if sender == "" || password == "" {
		crmFail(c, http.StatusBadRequest,
			"no email account is configured on the server (EMAIL_SENDER / EMAIL_APP_PASSWORD)", nil)
		return
	}

	distJob.mu.Lock()
	if distJob.running {
		distJob.mu.Unlock()
		crmFail(c, http.StatusConflict, "a distribution is already running", nil)
		return
	}
	distJob.running = true
	distJob.mu.Unlock()
	defer func() {
		distJob.mu.Lock()
		distJob.running = false
		distJob.mu.Unlock()
	}()

	targets, err := buildCRMPackDistribution(req.PackID, mode, normaliseProduct(req.Product))
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "build distribution", err)
		return
	}
	if len(targets) == 0 {
		crmFail(c, http.StatusBadRequest, "there is nothing to send for that pack and mode", nil)
		return
	}

	var zipRel string
	if err := database.DB.QueryRow(
		`SELECT COALESCE(zip_path,'') FROM crm_packs WHERE id=$1`, req.PackID).
		Scan(&zipRel); err != nil || zipRel == "" {
		crmFail(c, http.StatusNotFound, "that pack has no files on the server any more", nil)
		return
	}
	zr, err := zip.OpenReader(filepath.Join(mambuRoot(), zipRel))
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "open the pack's files", err)
		return
	}
	defer zr.Close()

	uid := crmUserID(c)
	auth := smtp.PlainAuth("", extractEmailAddress(sender), password, "smtp.gmail.com")
	sent, failed, skipped := 0, 0, 0
	var results []gin.H

	for _, t := range targets {
		to, copyTo := t.Emails, cc
		if req.TestMode {
			// A rehearsal reaches nobody but the operator — not even the Cc.
			to, copyTo = []string{operatorEmail()}, nil
		}
		if len(to) == 0 {
			skipped++
			logCRMPackSend(req.PackID, t, mode, cc, "", "SKIPPED",
				"nobody on the roster has an email address", req.TestMode, uid)
			results = append(results, gin.H{"target": t.Target, "product": t.Product,
				"status": "SKIPPED", "reason": "no email address on the roster"})
			continue
		}

		attachName, attach, err := attachmentFor(zr, t, mode, "CRM")
		if err != nil {
			failed++
			logCRMPackSend(req.PackID, t, mode, cc, "", "FAILED", err.Error(), req.TestMode, uid)
			results = append(results, gin.H{"target": t.Target, "product": t.Product,
				"status": "FAILED", "reason": err.Error()})
			continue
		}

		subject := fmt.Sprintf("CRM leads — %s (%s)", t.Target, t.Product)
		if req.TestMode {
			subject = "[TEST] " + subject
		}
		err = sendDistEmail(auth, sender, to, copyTo, subject,
			crmPackEmailHTML(t, mode, req.TestMode), attachName, attach)
		if err != nil {
			failed++
			logCRMPackSend(req.PackID, t, mode, cc, attachName, "FAILED", err.Error(), req.TestMode, uid)
			results = append(results, gin.H{"target": t.Target, "product": t.Product,
				"status": "FAILED", "reason": err.Error()})
			continue
		}
		sent++
		logCRMPackSend(req.PackID, t, mode, cc, attachName, "SENT", "", req.TestMode, uid)
		results = append(results, gin.H{"target": t.Target, "product": t.Product,
			"status": "SENT", "to": to, "cc": copyTo, "rows": t.Rows})
	}

	msg := fmt.Sprintf("%d email(s) sent, %d failed, %d skipped.", sent, failed, skipped)
	if req.TestMode {
		msg = fmt.Sprintf("Test run — every email went to %s. %s", operatorEmail(), msg)
	} else if len(cc) > 0 {
		msg += fmt.Sprintf(" Copied to %s.", strings.Join(cc, ", "))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "mode": mode, "testMode": req.TestMode,
		"sent": sent, "failed": failed, "skipped": skipped, "cc": cc,
		"results": results, "message": msg,
	})
}

// crmPackEmailHTML — the house email: a band, one line of context, a figures
// table, a sign-off. Nothing the reader would skip.
func crmPackEmailHTML(t distTarget, mode string, testMode bool) string {
	const (
		ink, muted, line, band = "#1f2937", "#6b7280", "#e5e7eb", "#1f3864"
	)
	td := "padding:9px 14px;border:1px solid " + line + ";font-size:13px;color:" + ink + ";"
	th := "padding:10px 14px;border:1px solid " + line + ";font-size:12px;font-weight:700;" +
		"color:#ffffff;background:" + band + ";text-align:left;"

	var what string
	switch mode {
	case "CLUSTER":
		what = "Attached is a zip with the CRM leads for every branch in " + htmlEscape(t.Target) + "."
	case "ZONE":
		what = "Attached is a zip with the CRM leads for every branch in the " + htmlEscape(t.Target) + " zone."
	default:
		what = "Attached are the CRM leads for " + htmlEscape(t.Target) + "."
	}

	var b strings.Builder
	b.WriteString(`<div style="margin:0;padding:24px 0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">` +
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="720" ` +
		`style="width:720px;max-width:100%;margin:0 auto;background:#ffffff;border:1px solid ` + line + `;">`)
	fmt.Fprintf(&b, `<tr><td style="background:%s;padding:20px 28px;">`+
		`<div style="color:#ffffff;font-size:18px;font-weight:700;">CRM leads — %s</div>`+
		`<div style="color:#c7d2e6;font-size:13px;padding-top:4px;">%s · %s</div></td></tr>`,
		band, htmlEscape(t.Target), htmlEscape(t.Product), time.Now().Format("2 January 2006"))

	if testMode {
		fmt.Fprintf(&b, `<tr><td style="padding:16px 28px 0 28px;"><div style="padding:8px 12px;`+
			`font-size:12.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;">`+
			`Test copy — redirected to you; nothing reached the branch.</div></td></tr>`)
	}

	fmt.Fprintf(&b, `<tr><td style="padding:22px 28px 6px 28px;color:%s;font-size:13px;line-height:1.6;">`+
		`<p style="margin:0 0 4px 0;">Hello,</p><p style="margin:0;">%s</p></td></tr>`, ink, what)

	b.WriteString(`<tr><td style="padding:12px 28px 0 28px;"><table role="presentation" cellpadding="0" ` +
		`cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">`)
	fmt.Fprintf(&b, `<tr><th style="%s">Product</th><th style="%s">For</th>`+
		`<th style="%stext-align:right;">Leads</th><th style="%stext-align:right;">Files</th></tr>`, th, th, th, th)
	fmt.Fprintf(&b, `<tr><td style="%s">%s</td><td style="%s">%s</td>`+
		`<td style="%stext-align:right;font-weight:700;">%s</td>`+
		`<td style="%stext-align:right;font-weight:700;">%d</td></tr>`,
		td, htmlEscape(t.Product), td, htmlEscape(t.Target), td, formatThousands(t.Rows), td, len(t.Files))
	b.WriteString(`</table></td></tr>`)

	if len(t.Names) > 0 {
		fmt.Fprintf(&b, `<tr><td style="padding:14px 28px 0 28px;font-size:12px;color:%s;">Sent to %s</td></tr>`,
			muted, htmlEscape(strings.Join(t.Names, ", ")))
	}

	fmt.Fprintf(&b, `<tr><td style="padding:22px 28px 24px 28px;color:%s;font-size:13px;line-height:1.6;">`+
		`Kind regards,<br><strong>PCL Analysis</strong></td></tr>`, ink)
	fmt.Fprintf(&b, `<tr><td style="background:#f8fafc;border-top:1px solid %s;padding:12px 28px;`+
		`font-size:11px;color:%s;">Platinum Credit Tanzania · generated from the PCL Analysis platform</td></tr>`,
		line, muted)
	b.WriteString(`</table></div>`)
	return b.String()
}

func logCRMPackSend(packID string, t distTarget, mode string, cc []string, attachment,
	status, errText string, testMode bool, sentBy interface{}) {

	var fileID interface{}
	if len(t.fileIDs) == 1 {
		fileID = t.fileIDs[0]
	}
	database.DB.Exec(
		`INSERT INTO crm_pack_sends
		   (id, pack_id, file_id, mode, product, target, recipients, cc, rows,
		    attachment, status, error, test_mode, sent_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		uuid.New(), packID, fileID, mode, t.Product, t.Target,
		strings.Join(t.Emails, ","), nullIfEmpty(strings.Join(cc, ",")), t.Rows,
		nullIfEmpty(attachment), status, nullIfEmpty(errText), testMode, sentBy)
}

// ListCRMPackSends — GET /api/crm/packs/:id/sends
func ListCRMPackSends(c *gin.Context) {
	rows, err := database.DB.Query(
		`SELECT mode, product, target, recipients, COALESCE(cc,''), rows, status,
		        COALESCE(error,''), test_mode, sent_at
		   FROM crm_pack_sends WHERE pack_id = $1
		  ORDER BY sent_at DESC LIMIT 500`, c.Param("id"))
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query sends", err)
		return
	}
	defer rows.Close()
	out := []gin.H{}
	for rows.Next() {
		var mode, product, target, recipients, cc, status, errText string
		var n int
		var testMode bool
		var at time.Time
		if rows.Scan(&mode, &product, &target, &recipients, &cc, &n, &status,
			&errText, &testMode, &at) != nil {
			continue
		}
		out = append(out, gin.H{
			"mode": mode, "product": product, "target": target,
			"recipients": splitNonEmpty(recipients), "cc": splitNonEmpty(cc), "rows": n,
			"status": status, "error": errText, "testMode": testMode, "sentAt": at,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sends": out})
}
