package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/middleware"
	"github.com/pcl/pcl-api/internal/models"
)

// GetAllChallenges retrieves all challenges with pagination
func GetAllChallenges(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	if limit > 200 {
		limit = 200
	}

	challenges, total, err := models.GetAllChallenges(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch challenges: " + err.Error(),
		})
		return
	}

	// Add status to each challenge
	type ChallengeWithStatus struct {
		*models.Challenge
		Status models.ChallengeStatus `json:"status"`
	}

	var challengesWithStatus []ChallengeWithStatus
	for _, ch := range challenges {
		challengesWithStatus = append(challengesWithStatus, ChallengeWithStatus{
			Challenge: ch,
			Status:    ch.GetStatus(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    challengesWithStatus,
		"meta": gin.H{
			"total":  total,
			"limit":  limit,
			"offset": offset,
		},
	})
}

// GetChallengeByID retrieves a single challenge by ID
func GetChallengeByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid challenge ID",
		})
		return
	}

	challenge, err := models.GetChallengeByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Challenge not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"challenge": challenge,
			"status":    challenge.GetStatus(),
		},
	})
}

// GetChallengesByDepartment retrieves challenges by department
func GetChallengesByDepartment(c *gin.Context) {
	department := c.Param("department")

	challenges, err := models.GetChallengesByDepartment(department)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch challenges: " + err.Error(),
		})
		return
	}

	type ChallengeWithStatus struct {
		*models.Challenge
		Status models.ChallengeStatus `json:"status"`
	}

	var challengesWithStatus []ChallengeWithStatus
	for _, ch := range challenges {
		challengesWithStatus = append(challengesWithStatus, ChallengeWithStatus{
			Challenge: ch,
			Status:    ch.GetStatus(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    challengesWithStatus,
	})
}

// CreateChallenge creates a new challenge
func CreateChallenge(c *gin.Context) {
	userID, err := middleware.GetUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "Not authenticated",
		})
		return
	}

	var input models.ChallengeCreate

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid input: " + err.Error(),
		})
		return
	}

	challenge, err := models.CreateChallenge(&input, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create challenge: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data": gin.H{
			"challenge": challenge,
			"status":    challenge.GetStatus(),
		},
	})
}

// UpdateChallenge updates a challenge
func UpdateChallenge(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid challenge ID",
		})
		return
	}

	var input models.ChallengeUpdate

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid input: " + err.Error(),
		})
		return
	}

	challenge, err := models.UpdateChallenge(id, &input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to update challenge: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"challenge": challenge,
			"status":    challenge.GetStatus(),
		},
	})
}

// DeleteChallenge deletes a challenge
func DeleteChallenge(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid challenge ID",
		})
		return
	}

	if err := models.DeleteChallenge(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to delete challenge: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Challenge deleted successfully",
	})
}

// SearchChallenges searches challenges
func SearchChallenges(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Search query is required",
		})
		return
	}

	challenges, err := models.SearchChallenges(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to search challenges: " + err.Error(),
		})
		return
	}

	type ChallengeWithStatus struct {
		*models.Challenge
		Status models.ChallengeStatus `json:"status"`
	}

	var challengesWithStatus []ChallengeWithStatus
	for _, ch := range challenges {
		challengesWithStatus = append(challengesWithStatus, ChallengeWithStatus{
			Challenge: ch,
			Status:    ch.GetStatus(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    challengesWithStatus,
	})
}

// UploadChallengeImage uploads an image for a challenge
func UploadChallengeImage(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid challenge ID",
		})
		return
	}

	// Get challenge to verify it exists
	challenge, err := models.GetChallengeByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Challenge not found",
		})
		return
	}

	// Get file
	file, header, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "No image file provided",
		})
		return
	}
	defer file.Close()

	// Create file path
	timestamp := time.Now().Unix()
	fileName := fmt.Sprintf("%d_%s", timestamp, header.Filename)
	filePath := filepath.Join("CHALLENGE", challenge.Department, "images", fileName)
	fullPath := filepath.Join(uploadPath, filePath)

	// Create directory
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create directory",
		})
		return
	}

	// Save file
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
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save file",
		})
		return
	}

	// Update challenge with image path
	input := &models.ChallengeUpdate{
		ImagePath: filePath,
	}

	updatedChallenge, err := models.UpdateChallenge(id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to update challenge: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"challenge": updatedChallenge,
			"imagePath": filePath,
		},
	})
}

// UploadChallengeAttachment uploads an attachment for a challenge
func UploadChallengeAttachment(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid challenge ID",
		})
		return
	}

	// Get challenge to verify it exists
	challenge, err := models.GetChallengeByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Challenge not found",
		})
		return
	}

	// Get file
	file, header, err := c.Request.FormFile("attachment")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "No attachment file provided",
		})
		return
	}
	defer file.Close()

	// Create file path
	timestamp := time.Now().Unix()
	fileName := fmt.Sprintf("%d_%s", timestamp, header.Filename)
	filePath := filepath.Join("CHALLENGE", challenge.Department, "attachments", fileName)
	fullPath := filepath.Join(uploadPath, filePath)

	// Create directory
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create directory",
		})
		return
	}

	// Save file
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
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to save file",
		})
		return
	}

	// Update challenge with attachment path
	input := &models.ChallengeUpdate{
		AttachmentPath: filePath,
	}

	updatedChallenge, err := models.UpdateChallenge(id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to update challenge: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"challenge":      updatedChallenge,
			"attachmentPath": filePath,
		},
	})
}

// ServeChallengeFile serves a challenge file (image or attachment)
func ServeChallengeFile(c *gin.Context) {
	filePath := c.Param("filepath")
	fullPath := filepath.Join(uploadPath, "CHALLENGE", filePath)

	// Check if file exists
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "File not found",
		})
		return
	}

	c.File(fullPath)
}
