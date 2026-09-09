package handlers

// Distributing a finished run by email.
//
// Three ways to send, matching the three buttons:
//
//   BRANCH       each branch gets its own workbook, to that branch's team
//                leaders / independent TLs / branch loan officers.
//   CLUSTER      each cluster manager gets ONE zip containing every branch
//                workbook in their cluster, so they can see the whole cluster
//                without opening a dozen mails.
//   UNALLOCATED  clients nobody owns. Where the product has a call centre
//                (LBF via LBF_CC, CS via CS_CC) the call centre gets the lot.
//                Where it has none (SME, Agrifinance) there is nobody central
//                to call them, so they go back to the branch each client
//                actually belongs to.
//
// Sending mail to branch staff is not undoable, so nothing sends on one click.
// The UI asks for a preview first — exactly which addresses, which files, how
// many rows — and only a second, explicit confirm actually sends. A test mode
// redirects everything to the operator so a run can be rehearsed safely.

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

var distJob struct {
	mu      sync.Mutex
	running bool
}

// distTarget is one email that would be, or was, sent.
type distTarget struct {
	FileID   uuid.UUID `json:"-"`
	Product  string    `json:"product"`
	Target   string    `json:"target"`
	Rows     int       `json:"rows"`
	Emails   []string  `json:"emails"`
	Names    []string  `json:"names"`
	Files    []string  `json:"files"`
	relPaths []string
	fileIDs  []uuid.UUID
}

// loadRunFiles reads a run's recorded workbooks.
func loadRunFiles(runID string, scopes ...string) ([]struct {
	ID                                     uuid.UUID
	Product, Scope, Name, Cluster, RelPath string
	Rows                                   int
	Emails, Names                          []string
}, error) {
	rows, err := database.DB.Query(
		`SELECT id, product, scope, name, COALESCE(cluster,''), rel_path, rows,
		        COALESCE(emails,''), COALESCE(names,'')
		   FROM mambu_rr_files
		  WHERE run_id = $1 AND scope = ANY($2)
		  ORDER BY product, name`, runID, pqTextArray(scopes))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []struct {
		ID                                     uuid.UUID
		Product, Scope, Name, Cluster, RelPath string
		Rows                                   int
		Emails, Names                          []string
	}
	for rows.Next() {
		var r struct {
			ID                                     uuid.UUID
			Product, Scope, Name, Cluster, RelPath string
			Rows                                   int
			Emails, Names                          []string
		}
		var em, nm string
		if err := rows.Scan(&r.ID, &r.Product, &r.Scope, &r.Name, &r.Cluster,
			&r.RelPath, &r.Rows, &em, &nm); err != nil {
			continue
		}
		r.Emails = splitNonEmpty(em)
		r.Names = splitNonEmpty(nm)
		out = append(out, r)
	}
	return out, rows.Err()
}

func splitNonEmpty(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// pqTextArray renders a Go slice as a Postgres text[] literal for = ANY(...).
func pqTextArray(items []string) string {
	var b strings.Builder
	b.WriteByte('{')
	for i, s := range items {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		b.WriteString(strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s))
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String()
}

// buildDistribution works out what a given mode would send for a run.
func buildDistribution(runID, mode, product string) ([]distTarget, []string, error) {
	var notes []string

	switch mode {
	case "BRANCH":
		files, err := loadRunFiles(runID, ScopeBranch)
		if err != nil {
			return nil, nil, err
		}
		var out []distTarget
		for _, f := range files {
			if product != "" && f.Product != product {
				continue
			}
			if f.Rows == 0 {
				continue
			}
			out = append(out, distTarget{
				Product: f.Product, Target: f.Name, Rows: f.Rows,
				Emails: f.Emails, Names: f.Names,
				Files:    []string{filepath.Base(f.RelPath)},
				relPaths: []string{f.RelPath}, fileIDs: []uuid.UUID{f.ID},
			})
		}
		return out, notes, nil

	case "CLUSTER":
		// One zip per cluster, holding that cluster's branch workbooks. The
		// cluster file itself is included too, so the manager gets the rollup
		// and the detail together.
		branchFiles, err := loadRunFiles(runID, ScopeBranch)
		if err != nil {
			return nil, nil, err
		}
		clusterFiles, err := loadRunFiles(runID, ScopeCluster)
		if err != nil {
			return nil, nil, err
		}

		type acc struct {
			product, cluster string
			rows             int
			emails, names    []string
			relPaths         []string
			fileIDs          []uuid.UUID
		}
		byCluster := map[string]*acc{}
		order := []string{}
		get := func(prod, cl string) *acc {
			k := prod + "|" + zoneKey(cl)
			if byCluster[k] == nil {
				byCluster[k] = &acc{product: prod, cluster: cl}
				order = append(order, k)
			}
			return byCluster[k]
		}

		for _, f := range clusterFiles {
			if product != "" && f.Product != product {
				continue
			}
			a := get(f.Product, f.Name)
			a.emails, a.names = f.Emails, f.Names
			a.relPaths = append(a.relPaths, f.RelPath)
			a.fileIDs = append(a.fileIDs, f.ID)
		}
		for _, f := range branchFiles {
			if product != "" && f.Product != product {
				continue
			}
			cl := f.Cluster
			if cl == "" {
				cl = "Unknown"
			}
			a := get(f.Product, cl)
			a.rows += f.Rows
			a.relPaths = append(a.relPaths, f.RelPath)
			a.fileIDs = append(a.fileIDs, f.ID)
		}

		var out []distTarget
		for _, k := range order {
			a := byCluster[k]
			var names []string
			for _, p := range a.relPaths {
				names = append(names, filepath.Base(p))
			}
			out = append(out, distTarget{
				Product: a.product, Target: a.cluster, Rows: a.rows,
				Emails: a.emails, Names: a.names, Files: names,
				relPaths: a.relPaths, fileIDs: a.fileIDs,
			})
		}
		return out, notes, nil

	case "UNALLOCATED":
		// Call-centre products first; where there is no call centre the run
		// wrote per-branch unallocated files instead.
		cc, err := loadRunFiles(runID, ScopeUnallocated)
		if err != nil {
			return nil, nil, err
		}
		perBranch, err := loadRunFiles(runID, ScopeUnallocBranch)
		if err != nil {
			return nil, nil, err
		}
		var out []distTarget
		for _, f := range append(cc, perBranch...) {
			if product != "" && f.Product != product {
				continue
			}
			if f.Rows == 0 {
				continue
			}
			label := f.Name
			if f.Scope == ScopeUnallocBranch {
				label = f.Name + " (unallocated)"
				notes = appendUnique(notes, fmt.Sprintf(
					"%s has no call centre, so its unallocated clients go to the branches they belong to.",
					f.Product))
			} else {
				notes = appendUnique(notes, fmt.Sprintf(
					"%s unallocated clients go to the call centre.", f.Product))
			}
			out = append(out, distTarget{
				Product: f.Product, Target: label, Rows: f.Rows,
				Emails: f.Emails, Names: f.Names,
				Files:    []string{filepath.Base(f.RelPath)},
				relPaths: []string{f.RelPath}, fileIDs: []uuid.UUID{f.ID},
			})
		}
		return out, notes, nil
	}

	return nil, nil, fmt.Errorf("unknown distribution mode %q", mode)
}

type distRequest struct {
	RunID    string   `json:"runId"`
	Mode     string   `json:"mode"`    // branch | cluster | unallocated
	Product  string   `json:"product"` // optional filter
	CC       []string `json:"cc"`      // operator-added copies, on every email of the send
	TestMode bool     `json:"testMode"`
	Confirm  bool     `json:"confirm"`
}

func normaliseDistMode(s string) string {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "BRANCH":
		return "BRANCH"
	case "CLUSTER":
		return "CLUSTER"
	case "UNALLOCATED", "UNALLOC":
		return "UNALLOCATED"
	}
	return ""
}

// PreviewMambuDistribution — POST /api/mambu/rr/distribute/preview
//
// Says exactly what a send would do, and sends nothing. This is what the UI
// shows before asking the operator to confirm.
func PreviewMambuDistribution(c *gin.Context) {
	var req distRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}
	mode := normaliseDistMode(req.Mode)
	if mode == "" || req.RunID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "A run and a mode (branch, cluster or unallocated) are required."})
		return
	}

	targets, notes, err := buildDistribution(req.RunID, mode, normaliseProduct(req.Product))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	var ready, blocked []distTarget
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

	sender, _ := emailCreds()
	c.JSON(http.StatusOK, gin.H{
		"success": true, "mode": mode, "runId": req.RunID,
		"willSend": ready, "cannotSend": blocked,
		"emailCount": len(ready), "addressCount": totalEmails,
		"rowCount": totalRows, "notes": notes,
		"sender":        sender,
		"emailReady":    sender != "",
		"testRecipient": operatorEmail(),
	})
}

// SendMambuDistribution — POST /api/mambu/rr/distribute
//
// Actually sends. Requires confirm=true, because this puts client lists in
// branch inboxes and cannot be taken back.
func SendMambuDistribution(c *gin.Context) {
	var req distRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}
	mode := normaliseDistMode(req.Mode)
	if mode == "" || req.RunID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "A run and a mode are required."})
		return
	}
	if !req.Confirm {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "This sends real email to branch staff and cannot be undone. " +
				"Review the preview and confirm to proceed."})
		return
	}

	cc, bad := cleanEmailList(req.CC)
	if len(bad) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "Not an email address: " + strings.Join(bad, ", ")})
		return
	}

	sender, password := emailCreds()
	if sender == "" || password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "No email account is configured on the server (EMAIL_SENDER / EMAIL_APP_PASSWORD)."})
		return
	}

	distJob.mu.Lock()
	if distJob.running {
		distJob.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false,
			"error": "A distribution is already running."})
		return
	}
	distJob.running = true
	distJob.mu.Unlock()
	defer func() {
		distJob.mu.Lock()
		distJob.running = false
		distJob.mu.Unlock()
	}()

	targets, _, err := buildDistribution(req.RunID, mode, normaliseProduct(req.Product))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if len(targets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false,
			"error": "There is nothing to send for that run and mode."})
		return
	}

	// Open the run's zip once — the attachments come straight out of it, so
	// what lands in an inbox is byte-identical to what was downloaded.
	var zipRel, label string
	if err := database.DB.QueryRow(
		`SELECT COALESCE(zip_path,''), mode FROM mambu_rr_runs WHERE id=$1`, req.RunID).
		Scan(&zipRel, &label); err != nil || zipRel == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false,
			"error": "That run has no files on the server any more."})
		return
	}
	zr, err := zip.OpenReader(filepath.Join(mambuRoot(), zipRel))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false,
			"error": "Could not open the run's files: " + err.Error()})
		return
	}
	defer zr.Close()

	var sentBy interface{}
	if v, ok := c.Get("userID"); ok {
		sentBy = v
	}

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
			logDistSend(req.RunID, t, mode, cc, "", "SKIPPED",
				"nobody on the roster has an email address", req.TestMode, sentBy)
			results = append(results, gin.H{"target": t.Target, "product": t.Product,
				"status": "SKIPPED", "reason": "no email address on the roster"})
			continue
		}

		attachName, attach, err := attachmentFor(zr, t, mode, label)
		if err != nil {
			failed++
			logDistSend(req.RunID, t, mode, cc, "", "FAILED", err.Error(), req.TestMode, sentBy)
			results = append(results, gin.H{"target": t.Target, "product": t.Product,
				"status": "FAILED", "reason": err.Error()})
			continue
		}

		subject := fmt.Sprintf("%s Data — %s (%s)", titleWord(label), t.Target, t.Product)
		if req.TestMode {
			subject = "[TEST] " + subject
		}
		err = sendDistEmail(auth, sender, to, copyTo, subject,
			distEmailHTML(t, mode, label, req.TestMode), attachName, attach)
		if err != nil {
			failed++
			logDistSend(req.RunID, t, mode, cc, attachName, "FAILED", err.Error(), req.TestMode, sentBy)
			results = append(results, gin.H{"target": t.Target, "product": t.Product,
				"status": "FAILED", "reason": err.Error()})
			continue
		}
		sent++
		logDistSend(req.RunID, t, mode, cc, attachName, "SENT", "", req.TestMode, sentBy)
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

// attachmentFor pulls the file(s) for one target out of the run's zip. Cluster
// and zone sends bundle several workbooks into a fresh zip; everything else is
// a single workbook.
func attachmentFor(zr *zip.ReadCloser, t distTarget, mode, label string) (string, []byte, error) {
	read := func(rel string) ([]byte, error) {
		want := strings.ReplaceAll(rel, string(os.PathSeparator), "/")
		for _, f := range zr.File {
			if f.Name == want {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
		return nil, fmt.Errorf("%s is missing from the run's files", filepath.Base(rel))
	}

	if mode == "CLUSTER" || mode == "ZONE" || len(t.relPaths) > 1 {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		for _, rel := range t.relPaths {
			b, err := read(rel)
			if err != nil {
				zw.Close()
				return "", nil, err
			}
			w, err := zw.Create(filepath.Base(rel))
			if err != nil {
				zw.Close()
				return "", nil, err
			}
			if _, err := w.Write(b); err != nil {
				zw.Close()
				return "", nil, err
			}
		}
		if err := zw.Close(); err != nil {
			return "", nil, err
		}
		name := fmt.Sprintf("%s_%s_%s.zip", titleWord(label),
			safeFileName(t.Product), safeFileName(t.Target))
		return strings.ReplaceAll(name, " ", "_"), buf.Bytes(), nil
	}

	if len(t.relPaths) == 0 {
		return "", nil, fmt.Errorf("no file recorded for %s", t.Target)
	}
	b, err := read(t.relPaths[0])
	if err != nil {
		return "", nil, err
	}
	return filepath.Base(t.relPaths[0]), b, nil
}

// sendDistEmail delivers one HTML email with one attachment. The Cc list is
// written to the header and added to the envelope, so copied people receive
// the same message the branch does.
func sendDistEmail(auth smtp.Auth, sender string, to, cc []string, subject, html,
	attachName string, attach []byte) error {

	bodyBuf := &bytes.Buffer{}
	mw := multipart.NewWriter(bodyBuf)

	htmlPart, err := mw.CreatePart(map[string][]string{
		"Content-Type":              {"text/html; charset=UTF-8"},
		"Content-Transfer-Encoding": {"base64"},
	})
	if err != nil {
		return err
	}
	writeBase64Lines(htmlPart, base64.StdEncoding.EncodeToString([]byte(html)))

	ctype := "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	if strings.HasSuffix(strings.ToLower(attachName), ".zip") {
		ctype = "application/zip"
	}
	attPart, err := mw.CreatePart(map[string][]string{
		"Content-Type":              {ctype},
		"Content-Transfer-Encoding": {"base64"},
		"Content-Disposition":       {fmt.Sprintf("attachment; filename=%q", attachName)},
	})
	if err != nil {
		return err
	}
	writeBase64Lines(attPart, base64.StdEncoding.EncodeToString(attach))

	if err := mw.Close(); err != nil {
		return err
	}

	from := extractEmailAddress(sender)
	msg := &bytes.Buffer{}
	fmt.Fprintf(msg, "From: %s\r\n", sender)
	fmt.Fprintf(msg, "To: %s\r\n", strings.Join(to, ", "))
	if len(cc) > 0 {
		fmt.Fprintf(msg, "Cc: %s\r\n", strings.Join(cc, ", "))
	}
	fmt.Fprintf(msg, "Subject: %s\r\n",
		strings.NewReplacer("\r", "", "\n", " ").Replace(subject))
	fmt.Fprintf(msg, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(msg, "Content-Type: multipart/mixed; boundary=%s\r\n\r\n", mw.Boundary())
	msg.Write(bodyBuf.Bytes())

	rcpt := append(append([]string{}, to...), cc...)
	return smtp.SendMail("smtp.gmail.com:587", auth, from, rcpt, msg.Bytes())
}

func distEmailHTML(t distTarget, mode, label string, testMode bool) string {
	var b strings.Builder
	b.WriteString(`<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#222">`)

	if testMode {
		b.WriteString(`<p style="font-size:13px;color:#92400e;background:#fef3c7;` +
			`border:1px solid #fde68a;border-radius:6px;padding:8px 12px">` +
			`Test copy — this was redirected to you and did not go to the branch.</p>`)
	}

	fmt.Fprintf(&b, `<h2 style="font-size:18px;color:#1f4e79;margin:16px 0 4px">%s data — %s</h2>`,
		htmlEscape(titleWord(label)), htmlEscape(t.Target))
	b.WriteString(`<div style="border-bottom:2px solid #1f4e79;margin-bottom:14px"></div>`)

	switch mode {
	case "CLUSTER":
		fmt.Fprintf(&b, `<p style="font-size:14px">Attached is a zip with the %s workbook`+
			` for every branch in <b>%s</b> — %s clients in total.</p>`,
			strings.ToLower(titleWord(label)), htmlEscape(t.Target), formatThousands(t.Rows))
	case "UNALLOCATED":
		fmt.Fprintf(&b, `<p style="font-size:14px">Attached are <b>%s</b> clients with no sales`+
			` rep assigned to them. They are not on any branch list, so they will not be`+
			` called unless they are called from here.</p>`, formatThousands(t.Rows))
	default:
		fmt.Fprintf(&b, `<p style="font-size:14px">Attached is the %s list for <b>%s</b>`+
			` — <b>%s</b> clients.</p>`, strings.ToLower(titleWord(label)),
			htmlEscape(t.Target), formatThousands(t.Rows))
	}

	b.WriteString(`<p style="font-size:14px">The <b>Distribution</b> sheet shows who each` +
		` client is assigned to; <b>Summary</b> shows every person's share.` +
		` Clients on the do-not-contact list have already been removed.</p>`)

	if len(t.Names) > 0 {
		b.WriteString(`<table style="border-collapse:collapse;max-width:420px;width:100%">` +
			`<tr><th style="text-align:left;padding:6px 10px;background:#f4f4f4;` +
			`border-bottom:1.5px solid #888;font-size:13px;color:#333">Sent to</th></tr>`)
		for _, n := range t.Names {
			fmt.Fprintf(&b, `<tr><td style="padding:6px 10px;border-bottom:1px solid #e3e3e3;`+
				`font-size:13px;color:#222">%s</td></tr>`, htmlEscape(n))
		}
		b.WriteString(`</table>`)
	}

	fmt.Fprintf(&b, `<div style="border-top:1px solid #ddd;margin-top:22px;padding-top:8px">`+
		`<p style="font-size:11px;color:#999;margin:0">Automated report &middot; `+
		`Platinum Credit Limited &middot; %s</p></div></div>`,
		time.Now().Format("2 Jan 2006"))
	return b.String()
}

func logDistSend(runID string, t distTarget, mode string, cc []string, attachment, status,
	errText string, testMode bool, sentBy interface{}) {

	var fileID interface{}
	if len(t.fileIDs) == 1 {
		fileID = t.fileIDs[0]
	}
	var errVal interface{}
	if errText != "" {
		errVal = errText
	}
	database.DB.Exec(
		`INSERT INTO mambu_rr_sends
		   (id, run_id, file_id, mode, product, target, recipients, cc, rows,
		    attachment, status, error, test_mode, sent_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		uuid.New(), runID, fileID, mode, t.Product, t.Target,
		strings.Join(t.Emails, ","), nullIfEmpty(strings.Join(cc, ",")), t.Rows,
		attachment, status, errVal, testMode, sentBy)
}

// ListMambuDistributions — GET /api/mambu/rr/runs/:id/sends
func ListMambuDistributions(c *gin.Context) {
	rows, err := database.DB.Query(
		`SELECT mode, product, target, recipients, COALESCE(cc,''), rows, status,
		        COALESCE(error,''), test_mode, sent_at
		   FROM mambu_rr_sends WHERE run_id = $1
		  ORDER BY sent_at DESC LIMIT 500`, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var mode, product, target, recipients, cc, status, errText string
		var n int
		var testMode bool
		var at time.Time
		if err := rows.Scan(&mode, &product, &target, &recipients, &cc, &n,
			&status, &errText, &testMode, &at); err != nil {
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

// emailCreds reads the server's sending account.
func emailCreds() (string, string) {
	sender := strings.TrimSpace(EmailConfig.Sender)
	pass := strings.TrimSpace(EmailConfig.AppPassword)
	if sender == "" {
		sender = strings.TrimSpace(os.Getenv("EMAIL_SENDER"))
	}
	if pass == "" {
		pass = strings.TrimSpace(os.Getenv("EMAIL_APP_PASSWORD"))
	}
	return sender, pass
}

// operatorEmail is where test sends are redirected.
func operatorEmail() string {
	if v := strings.TrimSpace(os.Getenv("MAMBU_TEST_EMAIL")); v != "" {
		return v
	}
	s, _ := emailCreds()
	return extractEmailAddress(s)
}
