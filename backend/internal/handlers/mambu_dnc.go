package handlers

// Do-not-contact list.
//
// Numbers here are stripped from every distributed lead file. Somebody taking a
// complaint types the number however they have it written down — 0712 317 849,
// +255712317849, 255-712-317-849 — so the handler normalises before storing.
// Matching on the normalised form is what makes the list actually work: a number
// added as 07… must still be caught when a loan export writes it as 255….

import (
	"context"
	"database/sql"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pcl/pcl-api/internal/database"
)

var nonDigits = regexp.MustCompile(`\D`)

// NormaliseTZPhone turns any way of writing a Tanzanian mobile number into the
// canonical 255XXXXXXXXX, or returns ok=false if it cannot be one.
//
// Tanzanian mobiles are nine digits after the country code and begin 6 or 7.
// Accepted: 255712317849, +255712317849, 0712317849, 712317849, and any of
// those with spaces, dashes or brackets.
func NormaliseTZPhone(raw string) (string, bool) {
	d := nonDigits.ReplaceAllString(raw, "")

	switch {
	case strings.HasPrefix(d, "255") && len(d) == 12:
		d = d[3:]
	case strings.HasPrefix(d, "0") && len(d) == 10:
		d = d[1:]
	case len(d) == 9:
		// already the subscriber part
	default:
		return "", false
	}

	if len(d) != 9 || (d[0] != '6' && d[0] != '7') {
		return "", false
	}
	return "255" + d, true
}

type dncRequest struct {
	Phone  string `json:"phone"`
	Reason string `json:"reason"`
}

// AddDoNotContact — POST /api/mambu/do-not-contact
func AddDoNotContact(c *gin.Context) {
	var req dncRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Phone) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "A phone number is required"})
		return
	}

	phone, ok := NormaliseTZPhone(req.Phone)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error": "That is not a Tanzanian mobile number. Enter it as 0712317849, " +
				"255712317849 or +255 712 317 849 — nine digits after the code, starting 6 or 7.",
		})
		return
	}

	var addedBy interface{}
	if v, ok := c.Get("userID"); ok {
		addedBy = v
	}

	var existed bool
	err := database.DB.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM mambu_do_not_contact WHERE phone = $1)`, phone).Scan(&existed)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	if _, err := database.DB.Exec(
		`INSERT INTO mambu_do_not_contact (phone, raw_input, reason, added_by, source)
		 VALUES ($1, $2, NULLIF(btrim($3), ''), $4, 'Web')
		 ON CONFLICT (phone) DO UPDATE
		    SET reason = COALESCE(NULLIF(btrim($3), ''), mambu_do_not_contact.reason)`,
		phone, strings.TrimSpace(req.Phone), req.Reason, addedBy,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// The tab is a mirror of this table, so it is rewritten after every change.
	// In the background: the number is already saved, and a slow or unreachable
	// Sheets must not hold up the person taking the complaint.
	syncDNCQuietly("add")

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"phone":   phone,
		"existed": existed,
		"message": map[bool]string{true: "Already on the list — reason updated.", false: "Added to the do-not-contact list."}[existed],
	})
}

// ListDoNotContact — GET /api/mambu/do-not-contact
//
// Pulls the DO_NOT_CONTACT tab in first, so a number somebody typed into the
// spreadsheet appears in the app without anyone having to re-enter it.
func ListDoNotContact(c *gin.Context) {
	syncDNCIfStale(c.Request.Context())

	rows, err := database.DB.Query(
		`SELECT phone, COALESCE(raw_input,''), COALESCE(reason,''), created_at
		   FROM mambu_do_not_contact ORDER BY created_at DESC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	out := []gin.H{}
	for rows.Next() {
		var phone, raw, reason string
		var created sql.NullTime
		if err := rows.Scan(&phone, &raw, &reason, &created); err != nil {
			continue
		}
		out = append(out, gin.H{
			"phone": phone, "rawInput": raw, "reason": reason, "createdAt": created.Time,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "numbers": out, "total": len(out)})
}

// DeleteDoNotContact — DELETE /api/mambu/do-not-contact/:phone
//
// Removing somebody means they can be called again, so the number is normalised
// the same way on the way out — deleting "0712317849" must remove the row stored
// as "255712317849" rather than silently matching nothing.
func DeleteDoNotContact(c *gin.Context) {
	phone, ok := NormaliseTZPhone(c.Param("phone"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Not a valid Tanzanian mobile number"})
		return
	}
	res, err := database.DB.Exec(`DELETE FROM mambu_do_not_contact WHERE phone = $1`, phone)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "That number is not on the list"})
		return
	}
	// Rewrite the tab without it. Removal only ever travels app -> sheet; a row
	// vanishing from the spreadsheet is not treated as a removal.
	syncDNCQuietly("delete")

	c.JSON(http.StatusOK, gin.H{"success": true, "phone": phone, "removed": n})
}

// doNotContactSet loads the list for use while building lead files.
//
// The sheet is read first: somebody who typed a number into the DO_NOT_CONTACT
// tab this morning expects it gone from this afternoon's file, and expecting
// them to also enter it in the app is how a complaint turns into a second call.
func doNotContactSet() (map[string]bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	syncDNCIfStale(ctx)

	rows, err := database.DB.Query(`SELECT phone FROM mambu_do_not_contact`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err == nil {
			set[p] = true
		}
	}
	return set, rows.Err()
}
