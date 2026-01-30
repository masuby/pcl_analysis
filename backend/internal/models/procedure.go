package models

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// ProcedureContentBlock represents a single content block in a procedure
type ProcedureContentBlock struct {
	Type       string                 `json:"type"`       // "paragraph", "heading", "list", "image", "file", "formula"
	Content    string                 `json:"content"`    // Text content or formula
	ListType   string                 `json:"listType"`   // "ordered", "unordered" for list type
	Formatting map[string]interface{} `json:"formatting"` // bold, italic, etc.
	Metadata   map[string]interface{} `json:"metadata"`   // For images/files: url, filename, size, etc.
}

// Procedure represents a report procedure documentation
type Procedure struct {
	ID         uuid.UUID               `json:"id"`
	ReportType string                  `json:"reportType"`
	Department *string                 `json:"department,omitempty"` // NULL for MANAGEMENT
	Content    []ProcedureContentBlock `json:"content"`
	CreatedBy  *uuid.UUID              `json:"createdBy,omitempty"`
	CreatedAt  time.Time               `json:"createdAt"`
	UpdatedAt  time.Time               `json:"updatedAt"`
}

// ProcedureCreate is the input for creating a new procedure
type ProcedureCreate struct {
	ReportType string                  `json:"reportType" binding:"required"`
	Department *string                 `json:"department"`
	Content    []ProcedureContentBlock `json:"content" binding:"required"`
}

// ProcedureUpdate is the input for updating a procedure
type ProcedureUpdate struct {
	Content []ProcedureContentBlock `json:"content"`
}

// CreateProcedure creates a new procedure in the database
func CreateProcedure(input *ProcedureCreate, createdBy uuid.UUID) (*Procedure, error) {
	// Convert content to JSONB
	contentJSON, err := json.Marshal(input.Content)
	if err != nil {
		return nil, err
	}

	procedure := &Procedure{
		ID:         uuid.New(),
		ReportType: input.ReportType,
		Department: input.Department,
		Content:    input.Content,
		CreatedBy:  &createdBy,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	query := `
		INSERT INTO procedures (id, report_type, department, content, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id`

	err = database.DB.QueryRow(
		query,
		procedure.ID, procedure.ReportType, procedure.Department, contentJSON,
		procedure.CreatedBy, procedure.CreatedAt, procedure.UpdatedAt,
	).Scan(&procedure.ID)

	if err != nil {
		return nil, err
	}

	return procedure, nil
}

// GetProcedureByTypeAndDepartment retrieves a procedure by report type and department
func GetProcedureByTypeAndDepartment(reportType string, department *string) (*Procedure, error) {
	var procedure Procedure
	var contentJSON []byte
	var dept sql.NullString

	query := `
		SELECT id, report_type, department, content, created_by, created_at, updated_at
		FROM procedures
		WHERE report_type = $1 AND (department = $2 OR (department IS NULL AND $2 IS NULL))`

	var err error
	if department == nil {
		err = database.DB.QueryRow(query, reportType, nil).Scan(
			&procedure.ID, &procedure.ReportType, &dept, &contentJSON,
			&procedure.CreatedBy, &procedure.CreatedAt, &procedure.UpdatedAt,
		)
	} else {
		err = database.DB.QueryRow(query, reportType, *department).Scan(
			&procedure.ID, &procedure.ReportType, &dept, &contentJSON,
			&procedure.CreatedBy, &procedure.CreatedAt, &procedure.UpdatedAt,
		)
	}

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("procedure not found")
		}
		return nil, err
	}

	if dept.Valid {
		procedure.Department = &dept.String
	}

	// Parse content JSON
	if err := json.Unmarshal(contentJSON, &procedure.Content); err != nil {
		return nil, err
	}

	return &procedure, nil
}

// GetAllProcedures retrieves all procedures
func GetAllProcedures() ([]*Procedure, error) {
	query := `
		SELECT id, report_type, department, content, created_by, created_at, updated_at
		FROM procedures
		ORDER BY report_type, department NULLS FIRST, created_at DESC`

	rows, err := database.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var procedures []*Procedure
	for rows.Next() {
		var procedure Procedure
		var contentJSON []byte
		var dept sql.NullString

		err := rows.Scan(
			&procedure.ID, &procedure.ReportType, &dept, &contentJSON,
			&procedure.CreatedBy, &procedure.CreatedAt, &procedure.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		if dept.Valid {
			procedure.Department = &dept.String
		}

		// Parse content JSON
		if err := json.Unmarshal(contentJSON, &procedure.Content); err != nil {
			return nil, err
		}

		procedures = append(procedures, &procedure)
	}

	return procedures, rows.Err()
}

// UpdateProcedure updates a procedure's content
func UpdateProcedure(id uuid.UUID, input *ProcedureUpdate) (*Procedure, error) {
	// Convert content to JSONB
	contentJSON, err := json.Marshal(input.Content)
	if err != nil {
		return nil, err
	}

	query := `
		UPDATE procedures
		SET content = $1, updated_at = $2
		WHERE id = $3
		RETURNING id, report_type, department, content, created_by, created_at, updated_at`

	var procedure Procedure
	var contentJSONResult []byte
	var dept sql.NullString

	err = database.DB.QueryRow(query, contentJSON, time.Now(), id).Scan(
		&procedure.ID, &procedure.ReportType, &dept, &contentJSONResult,
		&procedure.CreatedBy, &procedure.CreatedAt, &procedure.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("procedure not found")
		}
		return nil, err
	}

	if dept.Valid {
		procedure.Department = &dept.String
	}

	// Parse content JSON
	if err := json.Unmarshal(contentJSONResult, &procedure.Content); err != nil {
		return nil, err
	}

	return &procedure, nil
}

// DeleteProcedure deletes a procedure
func DeleteProcedure(id uuid.UUID) error {
	query := `DELETE FROM procedures WHERE id = $1`
	result, err := database.DB.Exec(query, id)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("procedure not found")
	}

	return nil
}
