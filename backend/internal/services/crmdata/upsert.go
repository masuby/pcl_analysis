package crmdata

// Merging an uploaded Lead_Report into the accumulating store.
//
// Per the requirement: a client that is new gets appended; a client already
// present gets their row updated in place, matched on the phone number. The
// store therefore always holds one current row per client, however many times
// the report is re-uploaded.

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pcl/pcl-api/internal/database"
)

// Result summarises one merge.
type Result struct {
	UploadID  string `json:"uploadId"`
	RowsRead  int    `json:"rowsRead"`
	Inserted  int    `json:"inserted"`
	Updated   int    `json:"updated"`
	Skipped   int    `json:"skipped"`
	BadPhones int    `json:"badPhones"`
	Total     int    `json:"totalInStore"`
}

const upsertBatch = 400

// Merge upserts the parsed rows and returns what changed.
func Merge(ctx context.Context, uploadID string, rows []Row, skipped int) (*Result, error) {
	res := &Result{UploadID: uploadID, RowsRead: len(rows) + skipped, Skipped: skipped}

	// A single upload can legitimately contain the same number twice (the
	// sample file has 132 such rows). Postgres cannot update the same row twice
	// in one statement — "ON CONFLICT DO UPDATE command cannot affect row a
	// second time" — so collapse duplicates first, keeping the last occurrence.
	seen := make(map[string]int, len(rows))
	deduped := make([]Row, 0, len(rows))
	for _, r := range rows {
		if i, ok := seen[r.PhoneNorm]; ok {
			deduped[i] = r
			continue
		}
		seen[r.PhoneNorm] = len(deduped)
		deduped = append(deduped, r)
	}

	for _, r := range deduped {
		if !r.PhoneValid {
			res.BadPhones++
		}
	}

	for start := 0; start < len(deduped); start += upsertBatch {
		end := start + upsertBatch
		if end > len(deduped) {
			end = len(deduped)
		}
		ins, upd, err := upsertChunk(ctx, uploadID, deduped[start:end])
		if err != nil {
			return res, err
		}
		res.Inserted += ins
		res.Updated += upd
	}

	_ = database.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM crm_leads`).Scan(&res.Total)
	return res, nil
}

const crmCols = 29

func upsertChunk(ctx context.Context, uploadID string, rows []Row) (inserted, updated int, err error) {
	if len(rows) == 0 {
		return 0, 0, nil
	}

	ph := make([]string, 0, len(rows))
	args := make([]interface{}, 0, len(rows)*crmCols)

	for i, r := range rows {
		b := i * crmCols
		p := make([]string, crmCols)
		for k := range p {
			p[k] = fmt.Sprintf("$%d", b+k+1)
		}
		ph = append(ph, "("+strings.Join(p, ",")+")")

		args = append(args,
			r.PhoneNorm, nullStr(r.PhoneRaw), r.PhoneValid,
			nullStr(r.Name), nullStr(r.CreatedBy), nullStr(r.CreatedByKey), nullStr(r.Email),
			nullStr(r.IDNumber), nullStr(r.EmpNumber), nullStr(r.TeamName),
			nullStr(r.AssignedTo), nullStr(r.ConsentType), nullStr(r.ConsentStatus),
			nullTime(r.ConsentDate), nullTime(r.ConsentRequestDate),
			nullStr(r.Status), nullStr(r.Branch), nullStr(r.BranchKey), r.ProductHint,
			nullStr(r.Region), nullStr(r.Location), nullStr(r.Source),
			nullStr(r.AffordabilityOutcome), nullFloat(r.TotalAffordability),
			nullFloat(r.InstallmentAmount), nullStr(r.AffordabilityDate),
			nullStr(r.AssignmentType), nullTime(r.CreatedDate), nullStr(r.Comment),
		)
	}

	// xmax = 0 identifies rows that were INSERTed rather than UPDATEd, which is
	// how the counts are split without a second round trip.
	//
	// COALESCE on update keeps a value we already hold when the new file has a
	// blank there — a later export must not erase a branch or a comment it
	// simply did not carry.
	q := `
	INSERT INTO crm_leads (
	  phone_norm, phone_raw, phone_valid,
	  lead_name, created_by, created_by_key, email_address, id_number, emp_number, team_name,
	  assigned_to, consent_type, consent_status, consent_date, consent_request_date,
	  status, branch, branch_key, product_hint, region, location, source,
	  affordability_outcome, total_affordability, installment_amount,
	  affordability_date_text, assignment_type, created_date, comment,
	  first_upload_id, last_upload_id
	)
	-- Types must be stated explicitly. In a VALUES list built from parameters
	-- Postgres has nothing to infer from, so every column would arrive as text
	-- and the booleans / timestamps / numerics would be rejected.
	SELECT v.phone_norm, v.phone_raw, v.phone_valid::boolean,
	       v.lead_name, v.created_by, v.created_by_key, v.email_address, v.id_number, v.emp_number,
	       v.team_name, v.assigned_to, v.consent_type, v.consent_status,
	       v.consent_date::timestamptz, v.consent_request_date::timestamptz,
	       v.status, v.branch, v.branch_key, v.product_hint,
	       v.region, v.location, v.source, v.affordability_outcome,
	       v.total_affordability::numeric, v.installment_amount::numeric,
	       v.affordability_date_text, v.assignment_type,
	       v.created_date::timestamptz, v.comment,
	       '` + uploadID + `'::uuid, '` + uploadID + `'::uuid
	  FROM (VALUES ` + strings.Join(ph, ",") + `) AS v(
	    phone_norm, phone_raw, phone_valid,
	    lead_name, created_by, created_by_key, email_address, id_number, emp_number, team_name,
	    assigned_to, consent_type, consent_status, consent_date, consent_request_date,
	    status, branch, branch_key, product_hint, region, location, source,
	    affordability_outcome, total_affordability, installment_amount,
	    affordability_date_text, assignment_type, created_date, comment)
	ON CONFLICT (phone_norm) DO UPDATE SET
	  phone_raw               = COALESCE(EXCLUDED.phone_raw, crm_leads.phone_raw),
	  phone_valid             = EXCLUDED.phone_valid,
	  lead_name               = COALESCE(EXCLUDED.lead_name, crm_leads.lead_name),
	  created_by              = COALESCE(EXCLUDED.created_by, crm_leads.created_by),
	  created_by_key          = COALESCE(EXCLUDED.created_by_key, crm_leads.created_by_key),
	  email_address           = COALESCE(EXCLUDED.email_address, crm_leads.email_address),
	  id_number               = COALESCE(EXCLUDED.id_number, crm_leads.id_number),
	  emp_number              = COALESCE(EXCLUDED.emp_number, crm_leads.emp_number),
	  team_name               = COALESCE(EXCLUDED.team_name, crm_leads.team_name),
	  assigned_to             = COALESCE(EXCLUDED.assigned_to, crm_leads.assigned_to),
	  consent_type            = COALESCE(EXCLUDED.consent_type, crm_leads.consent_type),
	  consent_status          = COALESCE(EXCLUDED.consent_status, crm_leads.consent_status),
	  consent_date            = COALESCE(EXCLUDED.consent_date, crm_leads.consent_date),
	  consent_request_date    = COALESCE(EXCLUDED.consent_request_date, crm_leads.consent_request_date),
	  status                  = COALESCE(EXCLUDED.status, crm_leads.status),
	  branch                  = COALESCE(EXCLUDED.branch, crm_leads.branch),
	  branch_key              = COALESCE(EXCLUDED.branch_key, crm_leads.branch_key),
	  product_hint            = EXCLUDED.product_hint,
	  region                  = COALESCE(EXCLUDED.region, crm_leads.region),
	  location                = COALESCE(EXCLUDED.location, crm_leads.location),
	  source                  = COALESCE(EXCLUDED.source, crm_leads.source),
	  affordability_outcome   = COALESCE(EXCLUDED.affordability_outcome, crm_leads.affordability_outcome),
	  total_affordability     = COALESCE(EXCLUDED.total_affordability, crm_leads.total_affordability),
	  installment_amount      = COALESCE(EXCLUDED.installment_amount, crm_leads.installment_amount),
	  affordability_date_text = COALESCE(EXCLUDED.affordability_date_text, crm_leads.affordability_date_text),
	  assignment_type         = COALESCE(EXCLUDED.assignment_type, crm_leads.assignment_type),
	  created_date            = COALESCE(EXCLUDED.created_date, crm_leads.created_date),
	  comment                 = COALESCE(EXCLUDED.comment, crm_leads.comment),
	  last_upload_id          = EXCLUDED.last_upload_id,
	  update_count            = crm_leads.update_count + 1,
	  updated_at              = NOW()
	RETURNING (xmax = 0) AS was_insert`

	rowsRes, err := database.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return 0, 0, fmt.Errorf("upsert crm leads: %w", err)
	}
	defer rowsRes.Close()

	for rowsRes.Next() {
		var wasInsert bool
		if err := rowsRes.Scan(&wasInsert); err != nil {
			continue
		}
		if wasInsert {
			inserted++
		} else {
			updated++
		}
	}
	return inserted, updated, rowsRes.Err()
}

func nullStr(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullTime(t *time.Time) interface{} {
	if t == nil {
		return nil
	}
	return *t
}

func nullFloat(f *float64) interface{} {
	if f == nil {
		return nil
	}
	return *f
}
