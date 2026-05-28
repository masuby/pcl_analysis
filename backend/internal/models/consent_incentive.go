package models

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// ConsentIncentiveFile represents one uploaded Lead file for the Consent Incentive Report.
// Only kind "LEAD" is supported. Exactly one active (non-deleted) record per kind is
// enforced by the DB unique partial index.
type ConsentIncentiveFile struct {
	ID         uuid.UUID  `json:"id"`
	Kind       string     `json:"kind"`
	FileName   string     `json:"fileName"`
	FilePath   string     `json:"filePath"`
	FileSize   int64      `json:"fileSize"`
	IsActive   bool       `json:"isActive"`
	IsDeleted  bool       `json:"isDeleted"`
	UploadedBy *uuid.UUID `json:"uploadedBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type ConsentIncentiveFileCreate struct {
	Kind     string
	FileName string
	FilePath string
	FileSize int64
}

const cifSelect = `
	SELECT id, kind, file_name, file_path, file_size,
	       is_active, is_deleted, uploaded_by, created_at, updated_at
	FROM consent_incentive_files`

func scanConsentIncentiveFile(row interface{ Scan(...interface{}) error }) (*ConsentIncentiveFile, error) {
	f := &ConsentIncentiveFile{}
	var uploadedBy sql.NullString
	if err := row.Scan(
		&f.ID, &f.Kind, &f.FileName, &f.FilePath, &f.FileSize,
		&f.IsActive, &f.IsDeleted, &uploadedBy, &f.CreatedAt, &f.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if uploadedBy.Valid {
		uid, _ := uuid.Parse(uploadedBy.String)
		f.UploadedBy = &uid
	}
	return f, nil
}

// ListActiveConsentIncentiveFiles returns the single active file for each kind that has one.
func ListActiveConsentIncentiveFiles() ([]*ConsentIncentiveFile, error) {
	rows, err := database.DB.Query(
		cifSelect + ` WHERE is_deleted = false AND is_active = true ORDER BY kind ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*ConsentIncentiveFile
	for rows.Next() {
		f, err := scanConsentIncentiveFile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// GetConsentIncentiveFileByID retrieves any file record by primary key.
func GetConsentIncentiveFileByID(id uuid.UUID) (*ConsentIncentiveFile, error) {
	row := database.DB.QueryRow(cifSelect+` WHERE id = $1`, id)
	f, err := scanConsentIncentiveFile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("consent incentive file not found")
	}
	return f, err
}

// CreateConsentIncentiveFile inserts a new file record as active, deactivating any previous
// active record for the same kind (retained for history).
func CreateConsentIncentiveFile(input *ConsentIncentiveFileCreate, uploadedBy uuid.UUID) (*ConsentIncentiveFile, error) {
	f := &ConsentIncentiveFile{
		ID:         uuid.New(),
		Kind:       input.Kind,
		FileName:   input.FileName,
		FilePath:   input.FilePath,
		FileSize:   input.FileSize,
		IsActive:   true,
		IsDeleted:  false,
		UploadedBy: &uploadedBy,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	err := database.WithTransaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`
			UPDATE consent_incentive_files
			SET is_active = false, updated_at = NOW()
			WHERE is_deleted = false AND kind = $1 AND is_active = true`,
			f.Kind,
		); err != nil {
			return err
		}

		_, err := tx.Exec(`
			INSERT INTO consent_incentive_files
			  (id, kind, file_name, file_path, file_size,
			   is_active, is_deleted, uploaded_by, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			f.ID, f.Kind, f.FileName, f.FilePath, f.FileSize,
			f.IsActive, f.IsDeleted, f.UploadedBy, f.CreatedAt, f.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return f, nil
}

// SoftDeleteConsentIncentiveFile marks a file as deleted and, if it was active,
// promotes the next-newest non-deleted version (if any) to active.
func SoftDeleteConsentIncentiveFile(id uuid.UUID) error {
	file, err := GetConsentIncentiveFileByID(id)
	if err != nil {
		return err
	}
	wasActive := file.IsActive
	kind := file.Kind

	return database.WithTransaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`
			UPDATE consent_incentive_files
			SET is_active = false, is_deleted = true, updated_at = NOW()
			WHERE id = $1`, id,
		); err != nil {
			return err
		}
		if !wasActive {
			return nil
		}
		// Promote the next-newest remaining version
		var latestID uuid.UUID
		if err := tx.QueryRow(`
			SELECT id FROM consent_incentive_files
			WHERE is_deleted = false AND kind = $1
			ORDER BY created_at DESC LIMIT 1`, kind,
		).Scan(&latestID); err != nil {
			return nil // no remaining versions — that is fine
		}
		_, err := tx.Exec(`
			UPDATE consent_incentive_files SET is_active = true, updated_at = NOW()
			WHERE id = $1`, latestID,
		)
		return err
	})
}
