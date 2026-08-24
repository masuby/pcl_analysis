package handlers

// System storage + report totals for the Administration screen.
//
// The screen used to derive its figures from the page of reports it had loaded,
// which is capped at 500 rows — so a database holding 1,255 reports reported
// "500", and the view/download totals only counted that page. These come from
// the database itself, so they say what is actually there.

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/utils"
)

type reportTotals struct {
	Total     int64 `json:"total"`
	Active    int64 `json:"active"`
	Views     int64 `json:"views"`
	Downloads int64 `json:"downloads"`
}

type storageBlock struct {
	Bytes     int64   `json:"bytes"`
	Total     int64   `json:"total,omitempty"`
	Used      int64   `json:"used,omitempty"`
	Available int64   `json:"available,omitempty"`
	Percent   float64 `json:"percentUsed,omitempty"`
	Path      string  `json:"path,omitempty"`
	Error     string  `json:"error,omitempty"`
}

// GetSystemStorage — GET /api/system/storage
//
//	{ success, reports: {total, active, views, downloads},
//	  database: {bytes}, uploads: {bytes}, disk: {total, used, available, percentUsed} }
func GetSystemStorage(c *gin.Context) {
	resp := gin.H{"success": true}

	// ── report totals, straight from the table ───────────────────────────────
	var rt reportTotals
	err := database.DB.QueryRow(`
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE is_active),
		       COALESCE(SUM(views), 0),
		       COALESCE(SUM(downloads), 0)
		  FROM reports`).
		Scan(&rt.Total, &rt.Active, &rt.Views, &rt.Downloads)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to read report totals: " + err.Error(),
		})
		return
	}
	resp["reports"] = rt

	// ── how much space Postgres itself occupies ──────────────────────────────
	dbBlock := storageBlock{}
	var dbBytes int64
	if err := database.DB.QueryRow(`SELECT pg_database_size(current_database())`).Scan(&dbBytes); err != nil {
		dbBlock.Error = err.Error()
	} else {
		dbBlock.Bytes = dbBytes
	}
	resp["database"] = dbBlock

	// ── uploaded files ───────────────────────────────────────────────────────
	// uploadPath is the package-level value set by InitReportHandlers.
	root := uploadPath
	if root == "" {
		root = "/var/reports"
	}
	uploads := storageBlock{Path: root}
	if size, err := dirSize(root); err != nil {
		uploads.Error = err.Error()
	} else {
		uploads.Bytes = size
	}
	resp["uploads"] = uploads

	// ── the filesystem underneath, so the operator sees what is left ─────────
	disk := storageBlock{Path: root}
	if total, used, available, err := utils.DiskUsage(root); err != nil {
		disk.Error = err.Error()
	} else {
		disk.Total = int64(total)
		disk.Used = int64(used)
		disk.Available = int64(available)
		if total > 0 {
			disk.Percent = float64(used) / float64(total) * 100
		}
	}
	resp["disk"] = disk

	c.JSON(http.StatusOK, resp)
}

// dirSize walks a directory and adds up the files in it. The uploads tree holds
// thousands of files rather than millions, so a walk is cheap enough and avoids
// shelling out to du.
func dirSize(root string) (int64, error) {
	var total int64
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0, err
	}
	var walk func(string, []os.DirEntry) error
	walk = func(dir string, list []os.DirEntry) error {
		for _, e := range list {
			full := dir + string(os.PathSeparator) + e.Name()
			if e.IsDir() {
				sub, err := os.ReadDir(full)
				if err != nil {
					continue // unreadable subtree should not fail the whole figure
				}
				if err := walk(full, sub); err != nil {
					return err
				}
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			total += info.Size()
		}
		return nil
	}
	if err := walk(root, entries); err != nil {
		return 0, err
	}
	return total, nil
}
