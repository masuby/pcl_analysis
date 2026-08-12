package handlers

// Emailing a CRM distribution to the Team Leaders who will work it.
//
// Same shape as the DIGITAL DATA send: group the current assignments by TL,
// build each one a spreadsheet of only their own leads, deliver over the Gmail
// SMTP path the Score Card reports already use.

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"github.com/xuri/excelize/v2"

	"github.com/pcl/pcl-api/internal/database"
)

type crmSendRequest struct {
	BatchID            string            `json:"batchId"`
	Filter             map[string]string `json:"filter"`
	AssigneeIDs        []string          `json:"assigneeIds"`
	IncludeAlreadySent bool              `json:"includeAlreadySent"`
	DryRun             bool              `json:"dryRun"`
	Note               string            `json:"note"`
}

// Columns a Team Leader receives — what the team needs to make the call.
var crmSendColumns = []string{
	"#", "Client Name", "Phone", "Branch", "Region", "Team",
	"CRM Assigned To", "Status", "Consent Date", "Location", "Comment",
}

type crmGroup struct {
	Name, Email, Role, Phone, Branch string
	DistIDs                          []string
	Rows                             [][]string
}

// SendCRMDistribution — POST /api/crm/send
func SendCRMDistribution(c *gin.Context) {
	var req crmSendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		crmFail(c, http.StatusBadRequest, "invalid body", err)
		return
	}
	if !req.DryRun && (EmailConfig.Sender == "" || strings.TrimSpace(EmailConfig.AppPassword) == "") {
		crmFail(c, http.StatusServiceUnavailable,
			"Email not configured. Add EMAIL_SENDER and EMAIL_APP_PASSWORD to backend .env", nil)
		return
	}

	groups, err := crmCollectRecipients(req)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "collect recipients", err)
		return
	}
	if len(groups) == 0 {
		crmFail(c, http.StatusBadRequest,
			"nothing to send — either nothing is assigned in this scope, it has all been "+
				"sent already, or the Team Leaders have no email address on file", nil)
		return
	}

	uid := crmUserID(c)
	results := make([]gin.H, 0, len(groups))
	sent, failed := 0, 0

	for _, g := range groups {
		entry := gin.H{"name": g.Name, "email": g.Email, "branch": g.Branch, "leads": len(g.Rows)}
		if req.DryRun {
			entry["status"] = "PREVIEW"
			results = append(results, entry)
			continue
		}

		xlsx, fileName, err := crmBuildWorkbook(g)
		if err == nil {
			err = crmSendEmail(g, xlsx, fileName, req.Note)
		}

		if err != nil {
			failed++
			entry["status"] = "FAILED"
			entry["error"] = err.Error()
			_, _ = database.DB.Exec(
				`UPDATE crm_distributions SET send_error=$2 WHERE id = ANY($1::uuid[])`,
				pq.Array(g.DistIDs), err.Error())
			_, _ = database.DB.Exec(`
				INSERT INTO crm_send_log (batch_id, assignee_name, assignee_email, lead_count, status, error, sent_by)
				VALUES ($1,$2,$3,$4,'FAILED',$5,$6)`,
				nullIfEmpty(req.BatchID), g.Name, g.Email, len(g.Rows), err.Error(), uid)
		} else {
			sent++
			entry["status"] = "SENT"
			_, _ = database.DB.Exec(`
				UPDATE crm_distributions
				   SET status='SENT', sent_at=NOW(), sent_to=$2, send_error=NULL
				 WHERE id = ANY($1::uuid[])`, pq.Array(g.DistIDs), g.Email)
			_, _ = database.DB.Exec(`
				INSERT INTO crm_send_log (batch_id, assignee_name, assignee_email, lead_count, status, sent_by)
				VALUES ($1,$2,$3,$4,'SENT',$5)`,
				nullIfEmpty(req.BatchID), g.Name, g.Email, len(g.Rows), uid)
		}
		results = append(results, entry)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": failed == 0, "dryRun": req.DryRun,
		"sent": sent, "failed": failed, "recipients": results,
	})
}

func crmCollectRecipients(req crmSendRequest) ([]crmGroup, error) {
	var conds []string
	var args []interface{}
	add := func(tmpl string, v interface{}) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(tmpl, len(args)))
	}

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
	if strings.TrimSpace(req.BatchID) == "" && req.Filter != nil {
		where, fArgs := crmFiltersFromMap(req.Filter)
		if where != "" {
			inner := shiftPlaceholders(strings.TrimPrefix(where, "WHERE "), len(args))
			args = append(args, fArgs...)
			conds = append(conds,
				"EXISTS (SELECT 1 FROM crm_leads WHERE id = d.lead_id AND "+inner+")")
		}
	}

	rows, err := database.DB.Query(`
		SELECT d.id, d.assignee_name, d.assignee_email, COALESCE(d.assignee_role,''),
		       COALESCE(d.assignee_phone,''), COALESCE(d.branch,''),
		       COALESCE(l.lead_name,''), COALESCE(l.phone_norm,''),
		       COALESCE(l.branch,''), COALESCE(l.region,''), COALESCE(l.team_name,''),
		       COALESCE(l.assigned_to,''), COALESCE(l.status,''),
		       COALESCE(to_char(l.consent_date,'YYYY-MM-DD'),''),
		       COALESCE(l.location,''), COALESCE(l.comment,'')
		  FROM crm_distributions d
		  JOIN crm_leads l ON l.id = d.lead_id
		 WHERE `+strings.Join(conds, " AND ")+`
		 ORDER BY d.assignee_name, l.created_date DESC NULLS LAST`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	order := []string{}
	byEmail := map[string]*crmGroup{}

	for rows.Next() {
		var distID, aName, aEmail, aRole, aPhone, aBranch string
		var name, phone, branch, region, team, crmAsg, status, consent, loc, comment string
		if err := rows.Scan(&distID, &aName, &aEmail, &aRole, &aPhone, &aBranch,
			&name, &phone, &branch, &region, &team, &crmAsg, &status,
			&consent, &loc, &comment); err != nil {
			continue
		}
		key := strings.ToLower(aEmail)
		g, ok := byEmail[key]
		if !ok {
			g = &crmGroup{Name: aName, Email: aEmail, Role: aRole, Phone: aPhone, Branch: aBranch}
			byEmail[key] = g
			order = append(order, key)
		}
		g.DistIDs = append(g.DistIDs, distID)
		g.Rows = append(g.Rows, []string{
			strconv.Itoa(len(g.Rows) + 1), name, phone, branch, region, team,
			crmAsg, status, consent, loc, comment,
		})
	}

	out := make([]crmGroup, 0, len(order))
	for _, k := range order {
		out = append(out, *byEmail[k])
	}
	return out, nil
}

func crmBuildWorkbook(g crmGroup) ([]byte, string, error) {
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

	for i, h := range crmSendColumns {
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
		"A": 5, "B": 26, "C": 16, "D": 22, "E": 22, "F": 20,
		"G": 20, "H": 12, "I": 13, "J": 30, "K": 40,
	} {
		_ = f.SetColWidth(sheet, col, col, w)
	}
	_ = f.SetPanes(sheet, &excelize.Panes{
		Freeze: true, XSplit: 0, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft",
	})

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, "", err
	}
	safe := strings.NewReplacer(" ", "_", "/", "-", "\\", "-").Replace(g.Name)
	return buf.Bytes(), fmt.Sprintf("CRM_Leads_%s_%s.xlsx", safe, time.Now().Format("2006-01-02")), nil
}

func crmSendEmail(g crmGroup, attachment []byte, fileName, note string) error {
	subject := fmt.Sprintf("Your CRM leads — %d to follow up (%s)",
		len(g.Rows), time.Now().Format("2 Jan 2006"))

	var b strings.Builder
	b.WriteString(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937">`)
	fmt.Fprintf(&b, `<p>Hello %s,</p>`, htmlEscape(firstName(g.Name)))
	fmt.Fprintf(&b,
		`<p>Your team has been assigned <strong>%d CRM lead%s</strong>%s. `+
			`The full list is attached as an Excel file.</p>`,
		len(g.Rows), plural(len(g.Rows)),
		func() string {
			if g.Branch != "" {
				return " for " + htmlEscape(g.Branch)
			}
			return ""
		}())
	if strings.TrimSpace(note) != "" {
		fmt.Fprintf(&b,
			`<p style="padding:10px 12px;background:#f1f5f9;border:1px solid #e2e8f0">%s</p>`,
			htmlEscape(note))
	}

	preview := g.Rows
	if len(preview) > 10 {
		preview = preview[:10]
	}
	b.WriteString(`<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:12px">`)
	b.WriteString(`<tr style="background:#1e3a8a;color:#fff">`)
	for _, h := range []string{"Client", "Phone", "Branch", "Status"} {
		fmt.Fprintf(&b, `<th style="border:1px solid #cbd5e1;text-align:left">%s</th>`, h)
	}
	b.WriteString(`</tr>`)
	for _, r := range preview {
		b.WriteString(`<tr>`)
		for _, i := range []int{1, 2, 3, 7} { // name, phone, branch, status
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

	bodyBuf := &bytes.Buffer{}
	mw := multipart.NewWriter(bodyBuf)

	htmlPart, err := mw.CreatePart(map[string][]string{
		"Content-Type":              {"text/html; charset=UTF-8"},
		"Content-Transfer-Encoding": {"base64"},
	})
	if err != nil {
		return err
	}
	writeBase64Lines(htmlPart, base64.StdEncoding.EncodeToString([]byte(b.String())))

	attPart, err := mw.CreatePart(map[string][]string{
		"Content-Type":              {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
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

// GetCRMSendLog — GET /api/crm/send-log?limit=30
func GetCRMSendLog(c *gin.Context) {
	limit := ddIntQuery(c, "limit", 30, 1, 200)
	rows, err := database.DB.Query(`
		SELECT assignee_name, assignee_email, lead_count, status, COALESCE(error,''), sent_at
		  FROM crm_send_log ORDER BY sent_at DESC LIMIT $1`, limit)
	if err != nil {
		crmFail(c, http.StatusInternalServerError, "query send log", err)
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var name, email, status, errMsg string
		var n int
		var at time.Time
		if rows.Scan(&name, &email, &n, &status, &errMsg, &at) == nil {
			e := gin.H{"name": name, "email": email, "leads": n, "status": status, "sentAt": at}
			if errMsg != "" {
				e["error"] = errMsg
			}
			out = append(out, e)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sends": out})
}
