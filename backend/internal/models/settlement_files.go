package models

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// SettlementFile represents an uploaded XLSX file used by the Settlements Analysis feature.
// Two kinds are supported:
//   - TRANSACTIONS: the monthly settlements transactions export
//   - ZONE_CLUSTER: the branch->product mapping used for VLOOKUP
type SettlementFile struct {
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

type SettlementFileCreate struct {
	Kind     string `json:"kind" binding:"required"`
	FileName string `json:"fileName" binding:"required"`
	FilePath string `json:"filePath" binding:"required"`
	FileSize int64  `json:"fileSize"`
}

func scanSettlementFile(row interface {
	Scan(dest ...interface{}) error
}) (*SettlementFile, error) {
	f := &SettlementFile{}
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

// GetSettlementFileByID retrieves a settlement file metadata by id.
func GetSettlementFileByID(id uuid.UUID) (*SettlementFile, error) {
	row := database.DB.QueryRow(`
		SELECT id, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at
		FROM settlement_files
		WHERE id = $1`, id)
	f, err := scanSettlementFile(row)
	if err == sql.ErrNoRows {
		return nil, errors.New("settlement file not found")
	}
	return f, err
}

// GetSettlementActive returns the active file for the given kind, if any.
func GetSettlementActive(kind string) (*SettlementFile, error) {
	row := database.DB.QueryRow(`
		SELECT id, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at
		FROM settlement_files
		WHERE is_deleted = false AND is_active = true AND kind = $1
		LIMIT 1`, kind)
	f, err := scanSettlementFile(row)
	if err == sql.ErrNoRows {
		return nil, errors.New("no active settlement file")
	}
	return f, err
}

// ListSettlementVersions lists all non-deleted versions for the given kind, newest first.
func ListSettlementVersions(kind string) ([]*SettlementFile, error) {
	rows, err := database.DB.Query(`
		SELECT id, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at
		FROM settlement_files
		WHERE is_deleted = false AND kind = $1
		ORDER BY created_at DESC`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*SettlementFile
	for rows.Next() {
		f, err := scanSettlementFile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateSettlementFile inserts a new file, deactivating any previous active version.
// This matches the "replace file" UX: the newest upload becomes active automatically.
func CreateSettlementFile(input *SettlementFileCreate, uploadedBy uuid.UUID) (*SettlementFile, error) {
	f := &SettlementFile{
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
			UPDATE settlement_files
			SET is_active = false
			WHERE is_deleted = false AND kind = $1 AND is_active = true`,
			f.Kind,
		); err != nil {
			return err
		}

		_, err := tx.Exec(`
			INSERT INTO settlement_files
			(id, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at)
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

// SoftDeleteSettlementFile marks a file as deleted; if it was the active one, the next newest
// remaining version (if any) is activated instead.
func SoftDeleteSettlementFile(id uuid.UUID) error {
	file, err := GetSettlementFileByID(id)
	if err != nil {
		return err
	}
	wasActive := file.IsActive
	kind := file.Kind

	return database.WithTransaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`
			UPDATE settlement_files
			SET is_active = false, is_deleted = true
			WHERE id = $1`, id); err != nil {
			return err
		}
		if !wasActive {
			return nil
		}
		var latestID uuid.UUID
		if err := tx.QueryRow(`
			SELECT id FROM settlement_files
			WHERE is_deleted = false AND kind = $1
			ORDER BY created_at DESC LIMIT 1`, kind).Scan(&latestID); err != nil {
			return nil
		}
		_, err := tx.Exec(`
			UPDATE settlement_files
			SET is_active = true
			WHERE id = $1`, latestID)
		return err
	})
}
