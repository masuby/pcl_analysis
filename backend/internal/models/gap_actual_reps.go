package models

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
)

// GapActualRep stores one team leader's submitted "Actual Sales Rep" value for a report
type GapActualRep struct {
	ID            uuid.UUID `json:"id"`
	ReportID      uuid.UUID `json:"reportId"`
	TeamLeaderKey string    `json:"teamLeaderKey"`
	Product       string    `json:"product"`
	Value         float64   `json:"value"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// UpsertGapActualRep inserts or updates one row (report_id + team_leader_key unique)
func UpsertGapActualRep(reportID uuid.UUID, teamLeaderKey, product string, value float64) error {
	query := `
		INSERT INTO gap_actual_reps (report_id, team_leader_key, product, value, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (report_id, team_leader_key)
		DO UPDATE SET value = $4, product = $3, updated_at = NOW()`
	_, err := database.DB.Exec(query, reportID, teamLeaderKey, product, value)
	return err
}

// GetGapActualRepsByReport returns a map of team_leader_key -> value for the given report
func GetGapActualRepsByReport(reportID uuid.UUID) (map[string]float64, error) {
	query := `
		SELECT team_leader_key, value
		FROM gap_actual_reps
		WHERE report_id = $1`
	rows, err := database.DB.Query(query, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var key string
		var val float64
		if err := rows.Scan(&key, &val); err != nil {
			return nil, err
		}
		out[key] = val
	}
	return out, rows.Err()
}

// GetGapActualRepByReportAndKey returns a single row if it exists
func GetGapActualRepByReportAndKey(reportID uuid.UUID, teamLeaderKey string) (*GapActualRep, error) {
	var r GapActualRep
	query := `SELECT id, report_id, team_leader_key, COALESCE(product, 'CS'), value, created_at, updated_at
		FROM gap_actual_reps WHERE report_id = $1 AND team_leader_key = $2`
	err := database.DB.QueryRow(query, reportID, teamLeaderKey).Scan(
		&r.ID, &r.ReportID, &r.TeamLeaderKey, &r.Product, &r.Value, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
