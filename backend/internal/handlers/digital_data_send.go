package handlers

// Sending a distribution to the people who will actually work it.
//
// Assigning a lead is only a database record — until this runs, nobody has been
// told. This groups the current assignments by assignee, builds each person a
// spreadsheet of just their own leads, and emails it to them over the same
// Gmail SMTP path the Score Card reports use.

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/xuri/excelize/v2"

	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/middleware"
)

type sendDistributionRequest struct {
	// Scope: a batch just created, or the current dropdown filter.
	BatchID string            `json:"batchId"`
	Filter  map[string]string `json:"filter"`
	// Limit to specific people (directory ids); empty means everyone in scope.
	AssigneeIDs []string `json:"assigneeIds"`
	// Re-send to people who already received these leads.
	IncludeAlreadySent bool `json:"includeAlreadySent"`
	// Build the emails and report what would be sent, without sending.
	DryRun bool `json:"dryRun"`
	Note   string `json:"note"`
}

// assigneeLeads is one person's slice of a distribution.
type assigneeLeads struct {
	Name, Email, Role, Phone, Branch string
	DistributionIDs                  []string
	Rows                             [][]string
}

// sendLeadColumns is the sheet the agent receives — what they need to make the
// call, and nothing else. No internal provenance or issue codes.
var sendLeadColumns = []string{
	"#", "Date", "Customer Name", "Phone", "Product", "Platform",
	"Last Status", "Comment", "Region",
}

// SendDigitalDistribution — POST /api/digital-data/send-distribution
//
// Emails each assignee their own leads as an .xlsx attachment. Idempotent by
// default: someone who already received a lead is not sent it again unless
// includeAlreadySent is set.
func SendDigitalDistribution(c *gin.Context) {
	var req sendDistributionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ddFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}

	if !req.DryRun && (EmailConfig.Sender == "" || strings.TrimSpace(EmailConfig.AppPassword) == "") {
		ddFail(c, http.StatusServiceUnavailable,
			"Email not configured. Add EMAIL_SENDER and EMAIL_APP_PASSWORD to backend .env", nil)
		return
	}

	groups, err := collectDistributionRecipients(req)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "collect recipients", err)
		return
	}
	if len(groups) == 0 {
		ddFail(c, http.StatusBadRequest,
			"nothing to send — either no leads are assigned in this scope, "+
				"all of them have already been sent, or the assignees have no email address", nil)
		return
	}

	var uid interface{}
	if id, err := middleware.GetUserIDFromContext(c); err == nil && id != uuid.Nil {
		uid = id.String()
	}

	results := make([]gin.H, 0, len(groups))
	sentCount, failCount := 0, 0

	for _, g := range groups {
		entry := gin.H{
			"name": g.Name, "email": g.Email, "branch": g.Branch, "leads": len(g.Rows),
		}
		if req.DryRun {
			entry["status"] = "PREVIEW"
			results = append(results, entry)
			continue
		}

		xlsx, fileName, err := buildAssigneeWorkbook(g)
		if err == nil {
			err = sendAssigneeEmail(g, xlsx, fileName, req.Note)
		}

		if err != nil {
			failCount++
			entry["status"] = "FAILED"
			entry["error"] = err.Error()
			_, _ = database.DB.Exec(`
				UPDATE digital_distributions SET send_error = $2
				 WHERE id = ANY($1::uuid[])`, pq.Array(g.DistributionIDs), err.Error())
			_, _ = database.DB.Exec(`
				INSERT INTO digital_send_log
				  (batch_id, assignee_name, assignee_email, lead_count, status, error, sent_by)
				VALUES ($1,$2,$3,$4,'FAILED',$5,$6)`,
				nullIfEmpty(req.BatchID), g.Name, g.Email, len(g.Rows), err.Error(), uid)
		} else {
			sentCount++
			entry["status"] = "SENT"
			_, _ = database.DB.Exec(`
				UPDATE digital_distributions
				   SET status = 'SENT', sent_at = NOW(), sent_to = $2, send_error = NULL
				 WHERE id = ANY($1::uuid[])`, pq.Array(g.DistributionIDs), g.Email)
			_, _ = database.DB.Exec(`
				INSERT INTO digital_send_log
				  (batch_id, assignee_name, assignee_email, lead_count, status, sent_by)
				VALUES ($1,$2,$3,$4,'SENT',$5)`,
				nullIfEmpty(req.BatchID), g.Name, g.Email, len(g.Rows), uid)
		}
		results = append(results, entry)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": failCount == 0,
		"dryRun":  req.DryRun,
		"sent":    sentCount,
		"failed":  failCount,
		"recipients": results,
	})
}

// collectDistributionRecipients groups the in-scope assignments by person.
func collectDistributionRecipients(req sendDistributionRequest) ([]assigneeLeads, error) {
	var conds []string
	var args []interface{}
	add := func(tmpl string, v interface{}) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(tmpl, len(args)))
	}

	// A person with no email address cannot be sent anything.
	conds = append(conds, "d.assignee_email IS NOT NULL AND d.assignee_email <> ''")

	if strings.TrimSpace(req.BatchID) != "" {
		add("d.batch_id = $%d", req.BatchID)
	}
	if len(req.AssigneeIDs) > 0 {
		add("d.directory_id = ANY($%d::uuid[])", pq.Array(req.AssigneeIDs))
	}
	if !req.IncludeAlreadySent {
		conds = append(conds, "d.sent_at IS NULL")
	}

	// Scope by the dropdown filter when no batch was named.
	if strings.TrimSpace(req.BatchID) == "" && req.Filter != nil {
		where, fArgs := ddFiltersFromMap(req.Filter)
		if where != "" {
			// Re-number the filter's placeholders to continue our sequence.
			// Done in ONE regex pass: successive ReplaceAll calls would corrupt
			// multi-digit placeholders (rewriting $1 would also hit the "$1"
			// inside an already-rewritten $12).
			inner := shiftPlaceholders(strings.TrimPrefix(where, "WHERE "), len(args))
			args = append(args, fArgs...)
			conds = append(conds,
				"EXISTS (SELECT 1 FROM digital_leads WHERE id = d.lead_id AND "+inner+")")
		}
	}

	rows, err := database.DB.Query(`
		SELECT d.id, d.assignee_name, d.assignee_email,
		       COALESCE(d.assignee_role,''), COALESCE(d.assignee_phone,''),
		       COALESCE(d.branch,''),
		       COALESCE(to_char(l.lead_date,'YYYY-MM-DD'),''),
		       COALESCE(l.lead_name,''), COALESCE(l.phone_e164,''),
		       l.product, l.platform, l.status_canonical,
		       COALESCE(l.comment,''), COALESCE(l.region,'')
		  FROM digital_distributions d
		  JOIN digital_leads l ON l.id = d.lead_id
		 WHERE `+strings.Join(conds, " AND ")+`
		 ORDER BY d.assignee_name, l.lead_date DESC NULLS LAST`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	order := []string{}
	byEmail := map[string]*assigneeLeads{}

	for rows.Next() {
		var distID, name, email, role, phone, branch string
		var date, lead, leadPhone, product, platform, status, comment, region string
		if err := rows.Scan(&distID, &name, &email, &role, &phone, &branch,
			&date, &lead, &leadPhone, &product, &platform, &status,
			&comment, &region); err != nil {
			continue
		}
		key := strings.ToLower(email)
		g, ok := byEmail[key]
		if !ok {
			g = &assigneeLeads{Name: name, Email: email, Role: role, Phone: phone, Branch: branch}
			byEmail[key] = g
			order = append(order, key)
		}
		g.DistributionIDs = append(g.DistributionIDs, distID)
		g.Rows = append(g.Rows, []string{
			strconv.Itoa(len(g.Rows) + 1), date, lead, leadPhone, product,
			prettyToken(platform), prettyToken(status), comment, region,
		})
	}

	out := make([]assigneeLeads, 0, len(order))
	for _, k := range order {
		out = append(out, *byEmail[k])
	}
	return out, nil
}

func prettyToken(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "_", " "))
}

var placeholderRe = regexp.MustCompile(`\$(\d+)`)

// shiftPlaceholders renumbers every $N in a fragment by `offset`, in a single
// pass so multi-digit placeholders survive.
func shiftPlaceholders(sql string, offset int) string {
	if offset == 0 {
		return sql
	}
	return placeholderRe.ReplaceAllStringFunc(sql, func(m string) string {
		n, err := strconv.Atoi(m[1:])
		if err != nil {
			return m
		}
		return "$" + strconv.Itoa(n+offset)
	})
}

// buildAssigneeWorkbook renders one person's leads as an .xlsx.
func buildAssigneeWorkbook(g assigneeLeads) ([]byte, string, error) {
	f := excelize.NewFile()
	defer f.Close()

	const sheet = "My Leads"
	idx, err := f.NewSheet(sheet)
	if err != nil {
		return nil, "", err
	}
	f.SetActiveSheet(idx)
	_ = f.DeleteSheet("Sheet1")

	header, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF", Size: 10},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"1E3A8A"}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border: []excelize.Border{
			{Type: "left", Color: "CBD5E1", Style: 1}, {Type: "right", Color: "CBD5E1", Style: 1},
			{Type: "top", Color: "CBD5E1", Style: 1}, {Type: "bottom", Color: "CBD5E1", Style: 1},
		},
	})
	if err != nil {
		return nil, "", err
	}
	body, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 10},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: "E2E8F0", Style: 1}, {Type: "right", Color: "E2E8F0", Style: 1},
			{Type: "top", Color: "E2E8F0", Style: 1}, {Type: "bottom", Color: "E2E8F0", Style: 1},
		},
	})
	if err != nil {
		return nil, "", err
	}

	for i, h := range sendLeadColumns {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
		_ = f.SetCellStyle(sheet, cell, cell, header)
	}
	for r, row := range g.Rows {
		for cIdx, v := range row {
			cell, _ := excelize.CoordinatesToCellName(cIdx+1, r+2)
			_ = f.SetCellValue(sheet, cell, v)
			_ = f.SetCellStyle(sheet, cell, cell, body)
		}
	}

	for col, w := range map[string]float64{
		"A": 5, "B": 12, "C": 26, "D": 16, "E": 9,
		"F": 12, "G": 18, "H": 40, "I": 16,
	} {
		_ = f.SetColWidth(sheet, col, col, w)
	}
	_ = f.SetPanes(sheet, &excelize.Panes{
		Freeze: true, Split: false, XSplit: 0, YSplit: 1,
		TopLeftCell: "A2", ActivePane: "bottomLeft",
	})

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, "", err
	}

	safe := strings.NewReplacer(" ", "_", "/", "-", "\\", "-").Replace(g.Name)
	name := fmt.Sprintf("Leads_%s_%s.xlsx", safe, time.Now().Format("2006-01-02"))
	return buf.Bytes(), name, nil
}

// sendAssigneeEmail delivers one person's workbook over Gmail SMTP.
func sendAssigneeEmail(g assigneeLeads, attachment []byte, fileName, note string) error {
	subject := fmt.Sprintf("Your digital leads — %d to call (%s)",
		len(g.Rows), time.Now().Format("2 Jan 2006"))

	html := buildAssigneeEmailHTML(g, note)

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

	attPart, err := mw.CreatePart(map[string][]string{
		"Content-Type": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		"Content-Transfer-Encoding": {"base64"},
		"Content-Disposition":       {fmt.Sprintf("attachment; filename=%q", fileName)},
	})
	if err != nil {
		return err
	}
	writeBase64Lines(attPart, base64.StdEncoding.EncodeToString(attachment))

	if err := mw.Close(); err != nil {
		return err
	}

	from := extractEmailAddress(EmailConfig.Sender)
	msg := &bytes.Buffer{}
	fmt.Fprintf(msg, "From: %s\r\n", EmailConfig.Sender)
	fmt.Fprintf(msg, "To: %s\r\n", g.Email)
	fmt.Fprintf(msg, "Subject: %s\r\n", strings.NewReplacer("\r", "", "\n", " ").Replace(subject))
	fmt.Fprintf(msg, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(msg, "Content-Type: multipart/mixed; boundary=%s\r\n\r\n", mw.Boundary())
	msg.Write(bodyBuf.Bytes())

	auth := smtp.PlainAuth("", from, EmailConfig.AppPassword, "smtp.gmail.com")
	return smtp.SendMail("smtp.gmail.com:587", auth, from, []string{g.Email}, msg.Bytes())
}

func buildAssigneeEmailHTML(g assigneeLeads, note string) string {
	var b strings.Builder
	b.WriteString(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937">`)
	fmt.Fprintf(&b, `<p>Hello %s,</p>`, htmlEscape(firstName(g.Name)))
	fmt.Fprintf(&b,
		`<p>You have been assigned <strong>%d lead%s</strong> to follow up. `+
			`The full list is attached as an Excel file.</p>`,
		len(g.Rows), plural(len(g.Rows)))

	if strings.TrimSpace(note) != "" {
		fmt.Fprintf(&b,
			`<p style="padding:10px 12px;background:#f1f5f9;border:1px solid #e2e8f0">%s</p>`,
			htmlEscape(note))
	}

	// A short preview so the email is useful without opening the attachment.
	preview := g.Rows
	if len(preview) > 10 {
		preview = preview[:10]
	}
	b.WriteString(`<table cellpadding="6" cellspacing="0" ` +
		`style="border-collapse:collapse;font-size:13px;margin-top:12px">`)
	b.WriteString(`<tr style="background:#1e3a8a;color:#fff">`)
	for _, h := range []string{"Date", "Customer", "Phone", "Product", "Last status"} {
		fmt.Fprintf(&b, `<th style="border:1px solid #cbd5e1;text-align:left">%s</th>`, h)
	}
	b.WriteString(`</tr>`)
	for _, r := range preview {
		b.WriteString(`<tr>`)
		for _, i := range []int{1, 2, 3, 4, 6} { // date, name, phone, product, status
			fmt.Fprintf(&b, `<td style="border:1px solid #e2e8f0">%s</td>`, htmlEscape(r[i]))
		}
		b.WriteString(`</tr>`)
	}
	b.WriteString(`</table>`)

	if len(g.Rows) > len(preview) {
		fmt.Fprintf(&b,
			`<p style="color:#64748b;font-size:12px">Showing the first %d — all %d are in the attachment.</p>`,
			len(preview), len(g.Rows))
	}

	b.WriteString(`<p style="color:#64748b;font-size:12px;margin-top:18px">` +
		`Sent automatically from the PCL Analysis dashboard.</p></div>`)
	return b.String()
}

func firstName(full string) string {
	if f := strings.Fields(full); len(f) > 0 {
		return f[0]
	}
	return full
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func htmlEscape(s string) string {
	return strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;",
	).Replace(s)
}

// GetDigitalSendLog — GET /api/digital-data/send-log?limit=30
func GetDigitalSendLog(c *gin.Context) {
	limit := ddIntQuery(c, "limit", 30, 1, 200)
	rows, err := database.DB.Query(`
		SELECT assignee_name, assignee_email, lead_count, status,
		       COALESCE(error,''), sent_at
		  FROM digital_send_log ORDER BY sent_at DESC LIMIT $1`, limit)
	if err != nil {
		ddFail(c, http.StatusInternalServerError, "query send log", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var name, email, status, errMsg string
		var count int
		var at time.Time
		if rows.Scan(&name, &email, &count, &status, &errMsg, &at) == nil {
			e := gin.H{"name": name, "email": email, "leads": count,
				"status": status, "sentAt": at}
			if errMsg != "" {
				e["error"] = errMsg
			}
			out = append(out, e)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sends": out})
}
