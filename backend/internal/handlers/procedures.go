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
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/models"
)

var proceduresUploadPath string
var maxProcedureFileSize int64 = 100 * 1024 * 1024 // 100 MB

// InitProcedureHandlers initializes procedure handlers with config
func InitProcedureHandlers(cfg *config.StorageConfig) {
	proceduresUploadPath = filepath.Join(cfg.UploadPath, "procedures")

	// Create procedures upload directories
	dirs := []string{"images", "files"}
	for _, dir := range dirs {
		fullDir := filepath.Join(proceduresUploadPath, dir)
		if err := os.MkdirAll(fullDir, 0755); err != nil {
			fmt.Printf("Warning: Could not create directory %s: %v\n", fullDir, err)
		}
	}
}

// GetAllProcedures retrieves all procedures
func GetAllProcedures(c *gin.Context) {
	procedures, err := models.GetAllProcedures()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch procedures: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    procedures,
	})
}

// GetProcedureByTypeAndDepartment retrieves a procedure by report type and department
func GetProcedureByTypeAndDepartment(c *gin.Context) {
	reportType := c.Param("type")
	department := c.Query("department") // Optional query parameter

	var deptPtr *string
	if department != "" {
		deptPtr = &department
	}

	procedure, err := models.GetProcedureByTypeAndDepartment(reportType, deptPtr)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Procedure not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    procedure,
	})
}

// CreateProcedure creates a new procedure
func CreateProcedure(c *gin.Context) {
	userID, err := middleware.GetUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "Not authenticated",
		})
		return
	}

	var input models.ProcedureCreate
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid input: " + err.Error(),
		})
		return
	}

	procedure, err := models.CreateProcedure(&input, userID)
	if err != nil {
		// Check if it's a unique constraint violation
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "UNIQUE constraint") {
			c.JSON(http.StatusConflict, gin.H{
				"success": false,
				"error":   "A procedure for this report type and department already exists",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create procedure: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data":    procedure,
	})
}

// UpdateProcedure updates a procedure
func UpdateProcedure(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid procedure ID",
		})
		return
	}

	var input models.ProcedureUpdate
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid input: " + err.Error(),
		})
		return
	}

	procedure, err := models.UpdateProcedure(id, &input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to update procedure: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    procedure,
	})
}

// DeleteProcedure deletes a procedure
func DeleteProcedure(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid procedure ID",
		})
		return
	}

	if err := models.DeleteProcedure(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to delete procedure: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Procedure deleted successfully",
	})
}

// UploadProcedureFile handles file uploads for procedures (images or documents)
func UploadProcedureFile(c *gin.Context) {
	fileType := c.DefaultQuery("type", "file") // "image" or "file"

	// Parse multipart form
	if err := c.Request.ParseMultipartForm(maxProcedureFileSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "File too large (max 100MB) or invalid form data",
		})
		return
	}

	// Get file from form
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "No file provided",
		})
		return
	}
	defer file.Close()

	// Validate file size
	if header.Size > maxProcedureFileSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   fmt.Sprintf("File size exceeds maximum allowed size of %d MB", maxProcedureFileSize/(1024*1024)),
		})
		return
	}

	// Determine upload directory
	var uploadDir string
	if fileType == "image" {
		uploadDir = filepath.Join(proceduresUploadPath, "images")
	} else {
		uploadDir = filepath.Join(proceduresUploadPath, "files")
	}

	// Generate unique filename
	timestamp := time.Now().Unix()
	safeFileName := fmt.Sprintf("%d_%s", timestamp, header.Filename)
	fullPath := filepath.Join(uploadDir, safeFileName)

	// Create destination file
	dst, err := os.Create(fullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create file",
		})
		return
	}
	defer dst.Close()

	// Copy file content
	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save file",
		})
		return
	}

	// Return file info
	relativePath := filepath.Join("procedures", fileType+"s", safeFileName)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"url":      relativePath,
			"filename": header.Filename,
			"size":     header.Size,
			"type":     fileType,
		},
	})
}

// DownloadProcedureFile handles file downloads for procedures
func DownloadProcedureFile(c *gin.Context) {
	filePath := c.Param("path")

	// Security: prevent directory traversal
	if strings.Contains(filePath, "..") {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid file path",
		})
		return
	}

	fullPath := filepath.Join(proceduresUploadPath, filePath)

	// Verify file exists
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "File not found",
		})
		return
	}

	// Serve file
	c.File(fullPath)
}
