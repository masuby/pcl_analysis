package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/models"
	"github.com/pcl/pcl-api/internal/services"
)

// POST /api/kpi-targets/upload
// multipart form:
// - product: CS/LBF/SME
// - kind: TOTAL/CLUSTER
// - file: xlsx
func UploadKpiTargetFile(c *gin.Context) {
	userID, err := middleware.GetUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "Not authenticated",
		})
		return
	}

	if err := c.Request.ParseMultipartForm(maxFileSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "File too large or invalid form data",
		})
		return
	}

	product := strings.ToUpper(strings.TrimSpace(c.PostForm("product")))
	kind := strings.ToUpper(strings.TrimSpace(c.PostForm("kind")))

	if product == "" || kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "product and kind are required",
		})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "No file provided",
		})
		return
	}
	defer file.Close()

	if header == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "No file provided",
		})
		return
	}

	// Save uploaded file under uploads/kpi-targets/<product>/<kind>/...
	safeProduct := product
	safeKind := kind
	originalName := header.Filename
	timestamp := time.Now().UnixNano()
	filePath := filepath.Join("kpi-targets", safeProduct, safeKind, fmt.Sprintf("%d_%s", timestamp, originalName))
	fullPath := filepath.Join(uploadPath, filePath)

	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create upload directory",
		})
		return
	}

	dst, err := os.Create(fullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create file",
		})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save uploaded file",
		})
		return
	}

	createdFile, err := models.CreateKpiTargetFile(&models.KpiTargetFileCreate{
		Product:  safeProduct,
		Kind:     safeKind,
		FileName: originalName,
		FilePath: filePath,
		FileSize: header.Size,
	}, userID)
	if err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create KPI target record",
			"details": err.Error(),
		})
		return
	}

	parsed := map[string]interface{}{}
	// For now, parsing is stubbed; later we implement the real CS parser.
	if p, parseErr := services.ParseKpiTargetFile(safeProduct, safeKind, fullPath); parseErr == nil && p != nil {
		parsed = p
	}

	// Store parsed JSON (even if empty stub).
	_ = models.UpsertParsedByFileID(createdFile.ID, parsed)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data":    createdFile,
	})
}

// GET /api/kpi-targets/versions?product=CS&kind=TOTAL
func GetKpiTargetVersions(c *gin.Context) {
	product := strings.ToUpper(strings.TrimSpace(c.Query("product")))
	kind := strings.ToUpper(strings.TrimSpace(c.Query("kind")))

	if product == "" || kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "product and kind are required",
		})
		return
	}

	versions, err := models.GetKpiTargetVersions(product, kind)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch KPI target versions",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    versions,
	})
}

// GET /api/kpi-targets/active?product=CS&kind=TOTAL
func GetKpiTargetActive(c *gin.Context) {
	product := strings.ToUpper(strings.TrimSpace(c.Query("product")))
	kind := strings.ToUpper(strings.TrimSpace(c.Query("kind")))

	if product == "" || kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "product and kind are required",
		})
		return
	}

	parsed, file, err := models.GetKpiTargetActiveParsed(product, kind)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "No active KPI target file",
		})
		return
	}

	// Self-heal: if parsed JSON is empty/malformed (e.g., after parser upgrades),
	// re-parse from the stored XLSX on disk.
	if file != nil {
		needsParse := false
		if parsed == nil || len(parsed) == 0 {
			needsParse = true
		} else {
			// TOTAL expects mainland/zanzibar/callCenter and performanceStandards.
			if strings.EqualFold(kind, "TOTAL") {
				// CS shape
				if m, ok := parsed["mainland"].(map[string]interface{}); ok {
					if len(m) == 0 {
						needsParse = true
					}
				}
				if z, ok := parsed["zanzibar"].(map[string]interface{}); ok {
					if len(z) == 0 {
						needsParse = true
					}
				}
				// LBF/SME shape
				if t, ok := parsed["targetsByMonth"].(map[string]interface{}); ok && len(t) == 0 {
					needsParse = true
				}
			} else if strings.EqualFold(kind, "CLUSTER") {
				// Heuristic: if clusters exist but all month maps inside are empty, re-parse.
				if cl, ok := parsed["clusters"].(map[string]interface{}); ok {
					if len(cl) == 0 {
						needsParse = true
					} else {
						allEmpty := true
						for _, v := range cl {
							if vm, ok := v.(map[string]interface{}); ok && len(vm) > 0 {
								allEmpty = false
								break
							}
						}
						if allEmpty {
							needsParse = true
						}
					}
				}
			}
		}

		if needsParse {
			fullPath := filepath.Join(uploadPath, file.FilePath)
			if p, parseErr := services.ParseKpiTargetFile(file.Product, file.Kind, fullPath); parseErr == nil && p != nil {
				_ = models.UpsertParsedByFileID(file.ID, p)
				parsed = p
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"file":   file,
			"parsed": parsed,
		},
	})
}

// GET /api/kpi-targets/:fileId/parsed
func GetKpiTargetParsedByFileID(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid fileId",
		})
		return
	}

	parsed, err := models.GetParsedByFileID(fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch parsed KPI targets",
		})
		return
	}

	// Self-heal similarly to the "active" endpoint.
	if len(parsed) == 0 {
		if fileMeta, metaErr := models.GetKpiTargetFileByID(fileID); metaErr == nil && fileMeta != nil {
			fullPath := filepath.Join(uploadPath, fileMeta.FilePath)
			if p, parseErr := services.ParseKpiTargetFile(fileMeta.Product, fileMeta.Kind, fullPath); parseErr == nil && p != nil {
				_ = models.UpsertParsedByFileID(fileID, p)
				parsed = p
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"parsed": parsed,
		},
	})
}

// POST /api/kpi-targets/:fileId/activate
func ActivateKpiTargetVersion(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid fileId",
		})
		return
	}

	_, err = models.ActivateKpiTarget(fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to activate KPI target version",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
	})
}

// DELETE /api/kpi-targets/:fileId
func DeleteKpiTargetVersion(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid fileId",
		})
		return
	}

	if err := models.SoftDeleteKpiTarget(fileID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to delete KPI target version",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
	})
}

// GET /api/kpi-targets/:fileId/download
func DownloadKpiTargetFile(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid fileId",
		})
		return
	}

	file, err := models.GetKpiTargetFileByID(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "KPI target file not found",
		})
		return
	}

	fullPath := filepath.Join(uploadPath, file.FilePath)
	if _, err := os.Stat(fullPath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "KPI target file missing on disk",
		})
		return
	}

	// Force the downloaded filename to the original XLSX name.
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.FileAttachment(fullPath, file.FileName)
}

