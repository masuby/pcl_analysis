package models

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

type KpiTargetFile struct {
	ID         uuid.UUID `json:"id"`
	Product    string    `json:"product"`
	Kind       string    `json:"kind"`
	FileName   string    `json:"fileName"`
	FilePath   string    `json:"filePath"`
	FileSize   int64     `json:"fileSize"`
	IsActive   bool      `json:"isActive"`
	IsDeleted  bool      `json:"isDeleted"`
	UploadedBy *uuid.UUID `json:"uploadedBy,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type KpiTargetFileCreate struct {
	Product  string `json:"product" binding:"required"`
	Kind     string `json:"kind" binding:"required"`
	FileName string `json:"fileName" binding:"required"`
	FilePath string `json:"filePath" binding:"required"`
	FileSize int64  `json:"fileSize"`
}

// GetKpiTargetFileByID retrieves a KPI target file metadata by id.
func GetKpiTargetFileByID(id uuid.UUID) (*KpiTargetFile, error) {
	file := &KpiTargetFile{}
	query := `
		SELECT id, product, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at
		FROM kpi_target_files
		WHERE id = $1`

	var uploadedBy sql.NullString
	err := database.DB.QueryRow(query, id).Scan(
		&file.ID, &file.Product, &file.Kind, &file.FileName, &file.FilePath, &file.FileSize,
		&file.IsActive, &file.IsDeleted, &uploadedBy, &file.CreatedAt, &file.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errors.New("kpi target file not found")
	}
	if err != nil {
		return nil, err
	}

	if uploadedBy.Valid {
		uid, _ := uuid.Parse(uploadedBy.String)
		file.UploadedBy = &uid
	}

	return file, nil
}

// GetKpiTargetVersions lists non-deleted versions for product/kind.
func GetKpiTargetVersions(product, kind string) ([]*KpiTargetFile, error) {
	query := `
		SELECT id, product, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at
		FROM kpi_target_files
		WHERE is_deleted = false AND product = $1 AND kind = $2
		ORDER BY created_at DESC`

	rows, err := database.DB.Query(query, product, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*KpiTargetFile
	for rows.Next() {
		f := &KpiTargetFile{}
		var uploadedBy sql.NullString
		if err := rows.Scan(
			&f.ID, &f.Product, &f.Kind, &f.FileName, &f.FilePath, &f.FileSize,
			&f.IsActive, &f.IsDeleted, &uploadedBy, &f.CreatedAt, &f.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if uploadedBy.Valid {
			uid, _ := uuid.Parse(uploadedBy.String)
			f.UploadedBy = &uid
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// GetKpiTargetActive returns active parsed JSON for product/kind.
func GetKpiTargetActiveParsed(product, kind string) (map[string]interface{}, *KpiTargetFile, error) {
	query := `
		SELECT
			f.id, f.product, f.kind, f.file_name, f.file_path, f.file_size, f.is_active, f.is_deleted, f.uploaded_by, f.created_at, f.updated_at,
			p.parsed_json
		FROM kpi_target_files f
		LEFT JOIN kpi_target_parsed p ON p.file_id = f.id
		WHERE f.is_deleted = false AND f.is_active = true AND f.product = $1 AND f.kind = $2
		LIMIT 1`

	file := &KpiTargetFile{}
	var uploadedBy sql.NullString
	var parsed sql.NullString
	err := database.DB.QueryRow(query, product, kind).Scan(
		&file.ID, &file.Product, &file.Kind, &file.FileName, &file.FilePath, &file.FileSize,
		&file.IsActive, &file.IsDeleted, &uploadedBy, &file.CreatedAt, &file.UpdatedAt,
		&parsed,
	)
	if err == sql.ErrNoRows {
		return nil, nil, errors.New("no active kpi target file")
	}
	if err != nil {
		return nil, nil, err
	}
	if uploadedBy.Valid {
		uid, _ := uuid.Parse(uploadedBy.String)
		file.UploadedBy = &uid
	}

	out := map[string]interface{}{}
	if parsed.Valid && parsed.String != "" {
		_ = json.Unmarshal([]byte(parsed.String), &out)
	}
	return out, file, nil
}

// CreateKpiTargetFile creates file metadata and creates an empty parsed row.
func CreateKpiTargetFile(input *KpiTargetFileCreate, uploadedBy uuid.UUID) (*KpiTargetFile, error) {
	file := &KpiTargetFile{
		ID:        uuid.New(),
		Product:   input.Product,
		Kind:      input.Kind,
		FileName:  input.FileName,
		FilePath:  input.FilePath,
		FileSize:  input.FileSize,
		IsActive:  true,
		IsDeleted: false,
		UploadedBy: &uploadedBy,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Ensure only one active version exists per product/kind.
	// We deactivate others in the same transaction.
	err := database.WithTransaction(func(tx *sql.Tx) error {
		// Deactivate other active versions first
		_, err := tx.Exec(`
			UPDATE kpi_target_files
			SET is_active = false
			WHERE is_deleted = false AND product = $1 AND kind = $2 AND is_active = true`,
			file.Product, file.Kind,
		)
		if err != nil {
			return err
		}

		_, err = tx.Exec(`
			INSERT INTO kpi_target_files
			(id, product, kind, file_name, file_path, file_size, is_active, is_deleted, uploaded_by, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			file.ID, file.Product, file.Kind, file.FileName, file.FilePath, file.FileSize,
			file.IsActive, file.IsDeleted, file.UploadedBy, file.CreatedAt, file.UpdatedAt,
		)
		if err != nil {
			return err
		}

		_, err = tx.Exec(`
			INSERT INTO kpi_target_parsed (file_id, parsed_json)
			VALUES ($1, '{}'::jsonb)`,
			file.ID,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return file, nil
}

// ActivateKpiTarget activates the given file_id for its product/kind.
func ActivateKpiTarget(fileID uuid.UUID) (*KpiTargetFile, error) {
	file, err := GetKpiTargetFileByID(fileID)
	if err != nil {
		return nil, err
	}
	if file.IsDeleted {
		return nil, errors.New("cannot activate deleted KPI target file")
	}

	err = database.WithTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec(`
			UPDATE kpi_target_files
			SET is_active = false
			WHERE is_deleted = false AND product = $1 AND kind = $2`,
			file.Product, file.Kind,
		)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`
			UPDATE kpi_target_files
			SET is_active = true, is_deleted = false
			WHERE id = $1`,
			fileID,
		)
		return err
	})
	if err != nil {
		return nil, err
	}

	return GetKpiTargetFileByID(fileID)
}

// SoftDeleteKpiTarget soft-deletes a KPI target version.
func SoftDeleteKpiTarget(fileID uuid.UUID) error {
	file, err := GetKpiTargetFileByID(fileID)
	if err != nil {
		return err
	}

	wasActive := file.IsActive
	product := file.Product
	kind := file.Kind

	err = database.WithTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec(`
			UPDATE kpi_target_files
			SET is_active = false, is_deleted = true
			WHERE id = $1`,
			fileID,
		)
		if err != nil {
			return err
		}

		// If we deleted the active version, activate the latest remaining one.
		if wasActive {
			var latestID uuid.UUID
			if err := tx.QueryRow(`
				SELECT id
				FROM kpi_target_files
				WHERE is_deleted = false AND product = $1 AND kind = $2
				ORDER BY created_at DESC
				LIMIT 1`,
				product, kind,
			).Scan(&latestID); err != nil {
				// No remaining version; that's fine.
				return nil
			}

			_, err := tx.Exec(`
				UPDATE kpi_target_files
				SET is_active = false
				WHERE is_deleted = false AND product = $1 AND kind = $2`,
				product, kind,
			)
			if err != nil {
				return err
			}

			_, err = tx.Exec(`
				UPDATE kpi_target_files
				SET is_active = true
				WHERE id = $1`,
				latestID,
			)
			if err != nil {
				return err
			}
		}
		return nil
	})

	return err
}

// GetParsedByFileID returns parsed JSON for a specific version file.
func GetParsedByFileID(fileID uuid.UUID) (map[string]interface{}, error) {
	query := `
		SELECT parsed_json
		FROM kpi_target_parsed
		WHERE file_id = $1
		LIMIT 1`

	var parsed sql.NullString
	err := database.DB.QueryRow(query, fileID).Scan(&parsed)
	if err == sql.ErrNoRows {
		return map[string]interface{}{}, nil
	}
	if err != nil {
		return nil, err
	}

	out := map[string]interface{}{}
	if parsed.Valid && parsed.String != "" {
		_ = json.Unmarshal([]byte(parsed.String), &out)
	}
	return out, nil
}

// UpsertParsedByFileID stores parsed JSON for a specific version file.
func UpsertParsedByFileID(fileID uuid.UUID, parsed map[string]interface{}) error {
	b, err := json.Marshal(parsed)
	if err != nil {
		return err
	}

	// Prefer update (row is created on upload), but upsert is safer.
	_, err = database.DB.Exec(`
		INSERT INTO kpi_target_parsed (file_id, parsed_json)
		VALUES ($1, $2::jsonb)
		ON CONFLICT (file_id)
		DO UPDATE SET parsed_json = EXCLUDED.parsed_json, updated_at = NOW()`,
		fileID, string(b),
	)
	return err
}

