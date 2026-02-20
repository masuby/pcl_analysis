package models

import (
	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// RecipientEmailInfo holds email and optional display name for a recipient
type RecipientEmailInfo struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

// UpsertGapRecipientEmail inserts or updates email and optional name for a recipient key (Branch TL or RSM)
func UpsertGapRecipientEmail(reportID uuid.UUID, recipientKey, product, email, name string) error {
	query := `
		INSERT INTO gap_recipient_emails (report_id, recipient_key, product, email, name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		ON CONFLICT (report_id, recipient_key)
		DO UPDATE SET email = $4, name = $5, product = $3, updated_at = NOW()`
	_, err := database.DB.Exec(query, reportID, recipientKey, product, email, name)
	return err
}

// GetGapRecipientEmailsByReport returns map recipient_key -> { email, name } for the given report
func GetGapRecipientEmailsByReport(reportID uuid.UUID) (map[string]RecipientEmailInfo, error) {
	query := `SELECT recipient_key, email, COALESCE(name, '') FROM gap_recipient_emails WHERE report_id = $1`
	rows, err := database.DB.Query(query, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]RecipientEmailInfo)
	for rows.Next() {
		var key, email, name string
		if err := rows.Scan(&key, &email, &name); err != nil {
			return nil, err
		}
		out[key] = RecipientEmailInfo{Email: email, Name: name}
	}
	return out, rows.Err()
}
