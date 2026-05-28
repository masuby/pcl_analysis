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

var allowedConsentIncentiveKinds = map[string]bool{
	"LEAD": true,
	"LOAN": true,
}

// InitConsentIncentiveHandlers creates the upload directories for each file kind.
func InitConsentIncentiveHandlers() {
	for kind := range allowedConsentIncentiveKinds {
		dir := filepath.Join(uploadPath, "consent_incentive", strings.ToLower(kind))
		if err := os.MkdirAll(dir, 0755); err != nil {
			fmt.Printf("Warning: Could not create consent incentive dir %s: %v\n", dir, err)
		}
	}
}

// POST /api/consent-incentive/upload
// multipart/form-data fields:
//
//	file – the .xlsx file
//	kind – LEAD
func UploadConsentIncentiveFile(c *gin.Context) {
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
	if !allowedConsentIncentiveKinds[kind] {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "kind must be one of: LEAD, LOAN",
		})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil || header == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "No file provided"})
		return
	}
	defer file.Close()

	timestamp := time.Now().UnixNano()
	safeFileName := fmt.Sprintf("%d_%s", timestamp, header.Filename)
	relPath := filepath.Join("consent_incentive", strings.ToLower(kind), safeFileName)
	fullPath := filepath.Join(uploadPath, relPath)

	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create upload directory"})
		return
	}

	dst, err := os.Create(fullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create destination file"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to save uploaded file"})
		return
	}

	record, err := models.CreateConsentIncentiveFile(&models.ConsentIncentiveFileCreate{
		Kind:     kind,
		FileName: header.Filename,
		FilePath: relPath,
		FileSize: header.Size,
	}, userID)
	if err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save record: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": record})
}

// GET /api/consent-incentive/files
// Returns the currently active file for each kind.
func GetConsentIncentiveFiles(c *gin.Context) {
	files, err := models.ListActiveConsentIncentiveFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to list files: " + err.Error()})
		return
	}
	if files == nil {
		files = []*models.ConsentIncentiveFile{}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": files})
}

// GET /api/consent-incentive/files/:fileId/download
// Serves the original uploaded Excel file for download.
func DownloadConsentIncentiveFile(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid fileId"})
		return
	}

	f, err := models.GetConsentIncentiveFileByID(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "File not found"})
		return
	}

	fullPath := filepath.Join(uploadPath, f.FilePath)
	if _, statErr := os.Stat(fullPath); statErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "File missing from disk"})
		return
	}

	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.FileAttachment(fullPath, f.FileName)
}

// DELETE /api/consent-incentive/files/:fileId
// Soft-deletes the file (promotes the next version if the deleted file was active).
func DeleteConsentIncentiveFile(c *gin.Context) {
	idStr := c.Param("fileId")
	fileID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid fileId"})
		return
	}
	if err := models.SoftDeleteConsentIncentiveFile(fileID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
