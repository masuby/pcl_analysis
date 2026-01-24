package models

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// Challenge represents a challenge/competition
type Challenge struct {
	ID             uuid.UUID  `json:"id"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	Department     string     `json:"department"`
	StartDate      *time.Time `json:"startDate"`
	EndDate        *time.Time `json:"endDate"`
	ImagePath      string     `json:"imagePath,omitempty"`
	AttachmentPath string     `json:"attachmentPath,omitempty"`
	IsActive       bool       `json:"isActive"`
	CreatedBy      *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// ChallengeCreate is the input for creating a new challenge
type ChallengeCreate struct {
	Title          string     `json:"title" binding:"required"`
	Description    string     `json:"description"`
	Department     string     `json:"department" binding:"required"`
	StartDate      *time.Time `json:"startDate"`
	EndDate        *time.Time `json:"endDate"`
	ImagePath      string     `json:"imagePath"`
	AttachmentPath string     `json:"attachmentPath"`
}

// ChallengeUpdate is the input for updating a challenge
type ChallengeUpdate struct {
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	Department     string     `json:"department"`
	StartDate      *time.Time `json:"startDate"`
	EndDate        *time.Time `json:"endDate"`
	ImagePath      string     `json:"imagePath"`
	AttachmentPath string     `json:"attachmentPath"`
	IsActive       *bool      `json:"isActive"`
}

// ChallengeStatus represents the status of a challenge
type ChallengeStatus string

const (
	ChallengeStatusIncoming ChallengeStatus = "incoming"
	ChallengeStatusOngoing  ChallengeStatus = "ongoing"
	ChallengeStatusFinished ChallengeStatus = "finished"
	ChallengeStatusUnknown  ChallengeStatus = "unknown"
)

// GetStatus returns the current status of the challenge
func (c *Challenge) GetStatus() ChallengeStatus {
	if c.StartDate == nil || c.EndDate == nil {
		return ChallengeStatusUnknown
	}

	now := time.Now()

	if now.Before(*c.StartDate) {
		return ChallengeStatusIncoming
	}
	if now.After(*c.EndDate) {
		return ChallengeStatusFinished
	}
	return ChallengeStatusOngoing
}

// CreateChallenge creates a new challenge in the database
func CreateChallenge(input *ChallengeCreate, createdBy uuid.UUID) (*Challenge, error) {
	challenge := &Challenge{
		ID:             uuid.New(),
		Title:          input.Title,
		Description:    input.Description,
		Department:     input.Department,
		StartDate:      input.StartDate,
		EndDate:        input.EndDate,
		ImagePath:      input.ImagePath,
		AttachmentPath: input.AttachmentPath,
		IsActive:       true,
		CreatedBy:      &createdBy,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	query := `
		INSERT INTO challenges (id, title, description, department, start_date, end_date, image_path, attachment_path, is_active, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id`

	err := database.DB.QueryRow(
		query,
		challenge.ID, challenge.Title, challenge.Description, challenge.Department,
		challenge.StartDate, challenge.EndDate, challenge.ImagePath, challenge.AttachmentPath,
		challenge.IsActive, challenge.CreatedBy, challenge.CreatedAt, challenge.UpdatedAt,
	).Scan(&challenge.ID)

	if err != nil {
		return nil, err
	}

	return challenge, nil
}

// GetChallengeByID retrieves a challenge by ID
func GetChallengeByID(id uuid.UUID) (*Challenge, error) {
	challenge := &Challenge{}

	query := `
		SELECT id, title, description, department, start_date, end_date, image_path, attachment_path, is_active, created_by, created_at, updated_at
		FROM challenges WHERE id = $1`

	var startDate, endDate sql.NullTime
	var imagePath, attachmentPath sql.NullString
	var createdBy sql.NullString

	err := database.DB.QueryRow(query, id).Scan(
		&challenge.ID, &challenge.Title, &challenge.Description, &challenge.Department,
		&startDate, &endDate, &imagePath, &attachmentPath,
		&challenge.IsActive, &createdBy, &challenge.CreatedAt, &challenge.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, errors.New("challenge not found")
	}
	if err != nil {
		return nil, err
	}

	if startDate.Valid {
		challenge.StartDate = &startDate.Time
	}
	if endDate.Valid {
		challenge.EndDate = &endDate.Time
	}
	if imagePath.Valid {
		challenge.ImagePath = imagePath.String
	}
	if attachmentPath.Valid {
		challenge.AttachmentPath = attachmentPath.String
	}
	if createdBy.Valid {
		uid, _ := uuid.Parse(createdBy.String)
		challenge.CreatedBy = &uid
	}

	return challenge, nil
}

// GetAllChallenges retrieves all challenges with pagination
func GetAllChallenges(limit, offset int) ([]*Challenge, int, error) {
	var total int
	err := database.DB.QueryRow("SELECT COUNT(*) FROM challenges WHERE is_active = true").Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := `
		SELECT id, title, description, department, start_date, end_date, image_path, attachment_path, is_active, created_by, created_at, updated_at
		FROM challenges
		WHERE is_active = true
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2`

	rows, err := database.DB.Query(query, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var challenges []*Challenge
	for rows.Next() {
		challenge := &Challenge{}
		var startDate, endDate sql.NullTime
		var imagePath, attachmentPath sql.NullString
		var createdBy sql.NullString

		err := rows.Scan(
			&challenge.ID, &challenge.Title, &challenge.Description, &challenge.Department,
			&startDate, &endDate, &imagePath, &attachmentPath,
			&challenge.IsActive, &createdBy, &challenge.CreatedAt, &challenge.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}

		if startDate.Valid {
			challenge.StartDate = &startDate.Time
		}
		if endDate.Valid {
			challenge.EndDate = &endDate.Time
		}
		if imagePath.Valid {
			challenge.ImagePath = imagePath.String
		}
		if attachmentPath.Valid {
			challenge.AttachmentPath = attachmentPath.String
		}
		if createdBy.Valid {
			uid, _ := uuid.Parse(createdBy.String)
			challenge.CreatedBy = &uid
		}

		challenges = append(challenges, challenge)
	}

	return challenges, total, nil
}

// GetChallengesByDepartment retrieves challenges by department
func GetChallengesByDepartment(department string) ([]*Challenge, error) {
	query := `
		SELECT id, title, description, department, start_date, end_date, image_path, attachment_path, is_active, created_by, created_at, updated_at
		FROM challenges
		WHERE is_active = true AND department = $1
		ORDER BY created_at DESC`

	rows, err := database.DB.Query(query, department)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var challenges []*Challenge
	for rows.Next() {
		challenge := &Challenge{}
		var startDate, endDate sql.NullTime
		var imagePath, attachmentPath sql.NullString
		var createdBy sql.NullString

		err := rows.Scan(
			&challenge.ID, &challenge.Title, &challenge.Description, &challenge.Department,
			&startDate, &endDate, &imagePath, &attachmentPath,
			&challenge.IsActive, &createdBy, &challenge.CreatedAt, &challenge.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		if startDate.Valid {
			challenge.StartDate = &startDate.Time
		}
		if endDate.Valid {
			challenge.EndDate = &endDate.Time
		}
		if imagePath.Valid {
			challenge.ImagePath = imagePath.String
		}
		if attachmentPath.Valid {
			challenge.AttachmentPath = attachmentPath.String
		}
		if createdBy.Valid {
			uid, _ := uuid.Parse(createdBy.String)
			challenge.CreatedBy = &uid
		}

		challenges = append(challenges, challenge)
	}

	return challenges, nil
}

// UpdateChallenge updates a challenge in the database
func UpdateChallenge(id uuid.UUID, input *ChallengeUpdate) (*Challenge, error) {
	challenge, err := GetChallengeByID(id)
	if err != nil {
		return nil, err
	}

	if input.Title != "" {
		challenge.Title = input.Title
	}
	if input.Description != "" {
		challenge.Description = input.Description
	}
	if input.Department != "" {
		challenge.Department = input.Department
	}
	if input.StartDate != nil {
		challenge.StartDate = input.StartDate
	}
	if input.EndDate != nil {
		challenge.EndDate = input.EndDate
	}
	if input.ImagePath != "" {
		challenge.ImagePath = input.ImagePath
	}
	if input.AttachmentPath != "" {
		challenge.AttachmentPath = input.AttachmentPath
	}
	if input.IsActive != nil {
		challenge.IsActive = *input.IsActive
	}
	challenge.UpdatedAt = time.Now()

	query := `
		UPDATE challenges
		SET title = $1, description = $2, department = $3, start_date = $4, end_date = $5, 
		    image_path = $6, attachment_path = $7, is_active = $8, updated_at = $9
		WHERE id = $10`

	_, err = database.DB.Exec(query,
		challenge.Title, challenge.Description, challenge.Department,
		challenge.StartDate, challenge.EndDate, challenge.ImagePath, challenge.AttachmentPath,
		challenge.IsActive, challenge.UpdatedAt, id)

	if err != nil {
		return nil, err
	}

	return challenge, nil
}

// DeleteChallenge soft deletes a challenge
func DeleteChallenge(id uuid.UUID) error {
	query := `UPDATE challenges SET is_active = false, updated_at = $1 WHERE id = $2`
	result, err := database.DB.Exec(query, time.Now(), id)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("challenge not found")
	}

	return nil
}

// SearchChallenges searches challenges by title or description
func SearchChallenges(searchTerm string) ([]*Challenge, error) {
	searchPattern := "%" + searchTerm + "%"

	query := `
		SELECT id, title, description, department, start_date, end_date, image_path, attachment_path, is_active, created_by, created_at, updated_at
		FROM challenges
		WHERE is_active = true AND (title ILIKE $1 OR description ILIKE $1 OR department ILIKE $1)
		ORDER BY created_at DESC`

	rows, err := database.DB.Query(query, searchPattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var challenges []*Challenge
	for rows.Next() {
		challenge := &Challenge{}
		var startDate, endDate sql.NullTime
		var imagePath, attachmentPath sql.NullString
		var createdBy sql.NullString

		err := rows.Scan(
			&challenge.ID, &challenge.Title, &challenge.Description, &challenge.Department,
			&startDate, &endDate, &imagePath, &attachmentPath,
			&challenge.IsActive, &createdBy, &challenge.CreatedAt, &challenge.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		if startDate.Valid {
			challenge.StartDate = &startDate.Time
		}
		if endDate.Valid {
			challenge.EndDate = &endDate.Time
		}
		if imagePath.Valid {
			challenge.ImagePath = imagePath.String
		}
		if attachmentPath.Valid {
			challenge.AttachmentPath = attachmentPath.String
		}
		if createdBy.Valid {
			uid, _ := uuid.Parse(createdBy.String)
			challenge.CreatedBy = &uid
		}

		challenges = append(challenges, challenge)
	}

	return challenges, nil
}
