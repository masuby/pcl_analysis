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
)

// Settlement file kinds.
var allowedSettlementKinds = map[string]bool{
	"TRANSACTIONS": true,
	"ZONE_CLUSTER": true,
}

// POST /api/settlements/upload
// multipart form:
//   - kind: TRANSACTIONS | ZONE_CLUSTER
//   - file: xlsx
//
// Replaces the currently active file for the given kind (previous active is deactivated
// but retained as history until soft-deleted).
func UploadSettlementFile(c *gin.Context) {
	userID, err := middleware.GetUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Not authenticated"})
		return
	}

	if err := c.Request.ParseMultipartForm(maxFileSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "File too large or invalid form data"})
		return
	}

	kind := strings.ToUpper(strings.TrimSpace(c.PostForm("kind")))
	if !allowedSettlementKinds[kind] {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "kind must be TRANSACTIONS or ZONE_CLUSTER"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil || header == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "No file provided"})
		return
	}
	defer file.Close()

	originalName := header.Filename
	timestamp := time.Now().UnixNano()
	filePath := filepath.Join("settlements", kind, fmt.Sprintf("%d_%s", timestamp, originalName))
	fullPath := filepath.Join(uploadPath, filePath)

	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create upload directory"})
		return
	}

	dst, err := os.Create(fullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create file"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to save uploaded file"})
		return
	}

	created, err := models.CreateSettlementFile(&models.SettlementFileCreate{
		Kind:     kind,
		FileName: originalName,
		FilePath: filePath,
		FileSize: header.Size,
	}, userID)
	if err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create settlement file record",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": created})
}

// GET /api/settlements/active?kind=TRANSACTIONS
func GetSettlementActive(c *gin.Context) {
	kind := strings.ToUpper(strings.TrimSpace(c.Query("kind")))
	if !allowedSettlementKinds[kind] {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "kind must be TRANSACTIONS or ZONE_CLUSTER"})
		return
	}
	file, err := models.GetSettlementActive(kind)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": file})
}

// GET /api/settlements/versions?kind=TRANSACTIONS
func ListSettlementVersions(c *gin.Context) {
	kind := strings.ToUpper(strings.TrimSpace(c.Query("kind")))
	if !allowedSettlementKinds[kind] {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "kind must be TRANSACTIONS or ZONE_CLUSTER"})
		return
	}
	items, err := models.ListSettlementVersions(kind)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to list settlement files"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// GET /api/settlements/:fileId/download
func DownloadSettlementFile(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid fileId"})
		return
	}
	file, err := models.GetSettlementFileByID(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Settlement file not found"})
		return
	}
	fullPath := filepath.Join(uploadPath, file.FilePath)
	if _, err := os.Stat(fullPath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Settlement file missing on disk"})
		return
	}
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.FileAttachment(fullPath, file.FileName)
}

// DELETE /api/settlements/:fileId
func DeleteSettlementFile(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid fileId"})
		return
	}
	if err := models.SoftDeleteSettlementFile(fileID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to delete settlement file"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
