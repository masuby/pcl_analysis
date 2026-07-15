package handlers

// Equalize Reports — LOCAL DEVELOPMENT ONLY.
//
// Pulls every report that exists in the production database but is missing from
// this (local) database, so a developer's local DB mirrors production. The heavy
// lifting (SSH to production, copy rows + report_data + files) is done by
// backend/scripts/equalize_reports.py, which this endpoint runs.
//
// Gated by EQUALIZE_ENABLED=true (set only in the local backend/.env). The
// production environment never sets it, so the endpoint returns 403 there and
// the UI button is also hidden off-localhost.

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// EqualizeEnabled reports whether the equalize feature is turned on. It is a
// LOCAL development tool, so it is allowed when the server runs in Gin debug/test
// mode (production runs release) OR when EQUALIZE_ENABLED=true is set explicitly.
func EqualizeEnabled() bool {
	if strings.EqualFold(os.Getenv("EQUALIZE_ENABLED"), "true") {
		return true
	}
	return gin.Mode() != gin.ReleaseMode
}

// EqualizeReports — POST /api/admin/equalize-reports
func EqualizeReports(c *gin.Context) {
	if !EqualizeEnabled() {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"error":   "Equalize is available in local development only.",
		})
		return
	}

	script := findEqualizeScript()
	if script == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "equalize_reports.py not found (expected under backend/scripts).",
		})
		return
	}
	py := findPython()
	if py == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "python interpreter not found on PATH.",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, py, script, "--commit", "--json")
	cmd.Dir = filepath.Dir(filepath.Dir(script)) // backend/ (so ./uploads resolves)
	out, runErr := cmd.CombinedOutput()
	summary := parseEqualizeSummary(string(out))

	if runErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "equalize failed: " + runErr.Error(),
			"details": summary,
			"log":     lastLines(string(out), 12),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "details": summary})
}

// findEqualizeScript locates equalize_reports.py relative to the working dir
// or the executable.
func findEqualizeScript() string {
	candidates := []string{
		filepath.Join("scripts", "equalize_reports.py"),
		filepath.Join("backend", "scripts", "equalize_reports.py"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exe), "scripts", "equalize_reports.py"))
	}
	for _, p := range candidates {
		if abs, err := filepath.Abs(p); err == nil {
			if _, statErr := os.Stat(abs); statErr == nil {
				return abs
			}
		}
	}
	return ""
}

// findPython returns the first available python interpreter.
func findPython() string {
	for _, name := range []string{"python", "python3", "py"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

// parseEqualizeSummary extracts the JSON the script prints as "EQUALIZE_JSON {...}".
func parseEqualizeSummary(output string) map[string]interface{} {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "EQUALIZE_JSON ") {
			var m map[string]interface{}
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "EQUALIZE_JSON ")), &m) == nil {
				return m
			}
		}
	}
	return map[string]interface{}{}
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
