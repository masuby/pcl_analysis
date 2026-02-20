package handlers

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"strings"

	"github.com/gin-gonic/gin"
)

// EmailConfig holds email sender credentials (loaded from env)
var EmailConfig struct {
	Sender      string
	AppPassword string
}

// SendScoreCardRequest is the request body for sending score card email
type SendScoreCardRequest struct {
	Recipients []string `json:"recipients" binding:"required"`
	Subject    string   `json:"subject" binding:"required"`
	HTMLBody   string   `json:"htmlBody" binding:"required"`
	Mode       string   `json:"mode"` // "WEEKLY" or "MONTHLY"
	// Attachment as base64-encoded Excel file (optional, for weekly mode)
	AttachmentBase64 string `json:"attachmentBase64"`
	AttachmentName   string `json:"attachmentName"`
}

// SendScoreCardEmail sends the HOD Score Card report email to managers
func SendScoreCardEmail(c *gin.Context) {
	if EmailConfig.Sender == "" || strings.TrimSpace(EmailConfig.AppPassword) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Email not configured. Add EMAIL_SENDER and EMAIL_APP_PASSWORD to backend .env",
		})
		return
	}

	var req SendScoreCardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid input: " + err.Error(),
		})
		return
	}

	if len(req.Recipients) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "At least one recipient is required",
		})
		return
	}

	subject := req.Subject
	if strings.ContainsAny(subject, "\r\n") {
		subject = strings.ReplaceAll(subject, "\r", "")
		subject = strings.ReplaceAll(subject, "\n", " ")
	}

	// Build multipart body using standard library (guarantees valid MIME)
	bodyBuf := &bytes.Buffer{}
	mw := multipart.NewWriter(bodyBuf)

	// Part 1: HTML body
	htmlPart, err := mw.CreatePart(map[string][]string{
		"Content-Type":        {"text/html; charset=UTF-8"},
		"Content-Transfer-Encoding": {"base64"},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create message part: " + err.Error(),
		})
		return
	}
	htmlB64 := base64.StdEncoding.EncodeToString([]byte(req.HTMLBody))
	writeBase64Lines(htmlPart, htmlB64)

	// Part 2: Attachment (if present)
	if req.AttachmentBase64 != "" && req.AttachmentName != "" {
		contentType := "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		if strings.HasSuffix(strings.ToLower(req.AttachmentName), ".pptx") {
			contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
		}
		attPart, err := mw.CreatePart(map[string][]string{
			"Content-Type":              {contentType + `; name="` + req.AttachmentName + `"`},
			"Content-Transfer-Encoding":  {"base64"},
			"Content-Disposition":        {`attachment; filename="` + req.AttachmentName + `"`},
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   "Failed to create attachment part: " + err.Error(),
			})
			return
		}
		writeBase64Lines(attPart, req.AttachmentBase64)
	}

	if err := mw.Close(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to finalize message: " + err.Error(),
		})
		return
	}

	// Build full message: headers + body (CRLF line endings for SMTP)
	var msg bytes.Buffer
	msg.WriteString("From: " + EmailConfig.Sender + "\r\n")
	msg.WriteString("To: " + strings.Join(req.Recipients, ", ") + "\r\n")
	msg.WriteString("Subject: " + subject + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: multipart/mixed; boundary=\"" + mw.Boundary() + "\"\r\n")
	msg.WriteString("\r\n")
	_, _ = io.Copy(&msg, bodyBuf)

	// Envelope sender: use bare address (some servers reject "Name <addr>" in MAIL FROM)
	envelopeFrom := extractEmailAddress(EmailConfig.Sender)
	if envelopeFrom == "" {
		envelopeFrom = EmailConfig.Sender
	}

	appPassword := strings.Trim(strings.TrimSpace(EmailConfig.AppPassword), `"`)
	auth := smtp.PlainAuth("", envelopeFrom, appPassword, "smtp.gmail.com")
	addr := "smtp.gmail.com:587"

	err = smtp.SendMail(addr, auth, envelopeFrom, req.Recipients, msg.Bytes())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   fmt.Sprintf("Failed to send email: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("Email sent successfully to %d recipient(s)", len(req.Recipients)),
	})
}

// extractEmailAddress returns the email from "Name <user@domain.com>" or the string if no angle brackets
func extractEmailAddress(s string) string {
	s = strings.TrimSpace(s)
	start := strings.Index(s, "<")
	end := strings.LastIndex(s, ">")
	if start >= 0 && end > start {
		return strings.TrimSpace(s[start+1 : end])
	}
	return s
}

// writeBase64Lines writes base64 with 76 chars per line (RFC 2045) to w
func writeBase64Lines(w io.Writer, b64 string) {
	const lineLen = 76
	for i := 0; i < len(b64); i += lineLen {
		end := i + lineLen
		if end > len(b64) {
			end = len(b64)
		}
		w.Write([]byte(b64[i:end]))
		w.Write([]byte("\r\n"))
	}
}
