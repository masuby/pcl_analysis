package models

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// MarketingDSFile represents one uploaded DIGITAL SALES Excel file.
// Exactly one active record per year is enforced by the DB unique partial index.
type MarketingDSFile struct {
	ID         uuid.UUID              `json:"id"`
	Year       int                    `json:"year"`
	FileName   string                 `json:"fileName"`
	FilePath   string                 `json:"filePath"`
	FileSize   int64                  `json:"fileSize"`
	ParsedData map[string]interface{} `json:"parsedData,omitempty"`
	IsActive   bool                   `json:"isActive"`
	IsDeleted  bool                   `json:"isDeleted"`
	UploadedBy *uuid.UUID             `json:"uploadedBy,omitempty"`
	CreatedAt  time.Time              `json:"createdAt"`
	UpdatedAt  time.Time              `json:"updatedAt"`
}

type MarketingDSFileCreate struct {
	Year       int                    `json:"year"`
	FileName   string                 `json:"fileName"`
	FilePath   string                 `json:"filePath"`
	FileSize   int64                  `json:"fileSize"`
	ParsedData map[string]interface{} `json:"parsedData"`
}

const mdsSelect = `
	SELECT id, year, file_name, file_path, file_size, parsed_data,
	       is_active, is_deleted, uploaded_by, created_at, updated_at
	FROM marketing_digital_sales_files`

func scanMarketingDSFile(row interface{ Scan(...interface{}) error }) (*MarketingDSFile, error) {
	f := &MarketingDSFile{}
	var uploadedBy sql.NullString
	var parsedRaw []byte
	if err := row.Scan(
		&f.ID, &f.Year, &f.FileName, &f.FilePath, &f.FileSize,
		&parsedRaw, &f.IsActive, &f.IsDeleted,
		&uploadedBy, &f.CreatedAt, &f.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if uploadedBy.Valid {
		uid, _ := uuid.Parse(uploadedBy.String)
		f.UploadedBy = &uid
	}
	if len(parsedRaw) > 0 {
		_ = json.Unmarshal(parsedRaw, &f.ParsedData)
	}
	return f, nil
}

// ListActiveMarketingDSFiles returns all active files, newest year first.
func ListActiveMarketingDSFiles() ([]*MarketingDSFile, error) {
	rows, err := database.DB.Query(
		mdsSelect + ` WHERE is_deleted = false AND is_active = true ORDER BY year DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*MarketingDSFile
	for rows.Next() {
		f, err := scanMarketingDSFile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// GetMarketingDSFileByYear returns the active file for the given year.
func GetMarketingDSFileByYear(year int) (*MarketingDSFile, error) {
	row := database.DB.QueryRow(
		mdsSelect+` WHERE is_deleted = false AND is_active = true AND year = $1 LIMIT 1`,
		year,
	)
	f, err := scanMarketingDSFile(row)
	if err == sql.ErrNoRows {
		return nil, errors.New("no active file for year")
	}
	return f, err
}

// GetMarketingDSFileByID returns any file record by primary key.
func GetMarketingDSFileByID(id uuid.UUID) (*MarketingDSFile, error) {
	row := database.DB.QueryRow(mdsSelect+` WHERE id = $1`, id)
	f, err := scanMarketingDSFile(row)
	if err == sql.ErrNoRows {
		return nil, errors.New("marketing file not found")
	}
	return f, err
}

// UpsertMarketingDSFile deactivates any existing active file for the year and inserts a
// new active record. Previous records are retained (is_active=false) for audit purposes.
func UpsertMarketingDSFile(input *MarketingDSFileCreate, uploadedBy uuid.UUID) (*MarketingDSFile, error) {
	parsedJSON, err := json.Marshal(input.ParsedData)
	if err != nil {
		return nil, err
	}

	f := &MarketingDSFile{
		ID:         uuid.New(),
		Year:       input.Year,
		FileName:   input.FileName,
		FilePath:   input.FilePath,
		FileSize:   input.FileSize,
		IsActive:   true,
		IsDeleted:  false,
		UploadedBy: &uploadedBy,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if err := database.WithTransaction(func(tx *sql.Tx) error {
		// Deactivate previous active record for this year (keep for history)
		if _, err := tx.Exec(`
			UPDATE marketing_digital_sales_files
			SET is_active = false, updated_at = NOW()
			WHERE is_deleted = false AND year = $1 AND is_active = true`,
			f.Year,
		); err != nil {
			return err
		}

		_, err := tx.Exec(`
			INSERT INTO marketing_digital_sales_files
			  (id, year, file_name, file_path, file_size, parsed_data,
			   is_active, is_deleted, uploaded_by, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			f.ID, f.Year, f.FileName, f.FilePath, f.FileSize, parsedJSON,
			f.IsActive, f.IsDeleted, f.UploadedBy, f.CreatedAt, f.UpdatedAt,
		)
		return err
	}); err != nil {
		return nil, err
	}

	_ = json.Unmarshal(parsedJSON, &f.ParsedData)
	return f, nil
}

// DeleteMarketingDSFileForYear soft-deletes the active file for the given year.
func DeleteMarketingDSFileForYear(year int) error {
	res, err := database.DB.Exec(`
		UPDATE marketing_digital_sales_files
		SET is_active = false, is_deleted = true, updated_at = NOW()
		WHERE is_deleted = false AND year = $1 AND is_active = true`,
		year,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("no active file found for year")
	}
	return nil
}
