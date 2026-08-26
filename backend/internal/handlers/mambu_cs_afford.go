package handlers

// CS affordability — the Go port of process_data.py and generate_final.py.
//
// Everyone on the payroll register is sorted into one of three groups by
// whether they currently owe us anything:
//
//   Refinance     they have a live loan (balance above zero)
//   Reactivation  they had one and settled it (balance exactly zero)
//   New           they are not in the loan file at all
//
// Then the same affordability chain runs for each, and the qualifying figure
// differs: a refinance has to leave at least 200,000 in the client's hand after
// settling what they owe, while new and reactivation need a 500,000 loan.

import (
	"database/sql"

	"math"
	"strings"
	"time"

	"github.com/pcl/pcl-api/internal/database"
)

// Loan constants, exactly as the master Excel files have them.
const (
	csMonthlyRate = 0.035       // 3.5% a month, interest
	csAdminRate   = 0.004       // 0.4% a month, admin fee
	csProcFee     = 0.10 * 1.18 // 10% processing fee plus 18% VAT
	csRetireAge   = 59.5        // salary stops here
	csMaxTenure   = 96.0        // 8 years, hard cap
	csRefinMin    = 200000.0    // a refinance must free up at least this much
	csNewReactMin = 500000.0    // new and reactivation need this much loan
)

// Check numbers starting 1130–1134 are the ones payroll will accept a
// deduction instruction for, so they get their own whitelist sheet.
var csWhitelistPrefixes = []string{"1130", "1131", "1132", "1133", "1134"}

// The three groups.
const (
	GroupRefinance    = "Refinance"
	GroupReactivation = "Reactivation"
	GroupNew          = "New"
)

// csPerson is one employee with everything the maths needs.
type csPerson struct {
	CheckNumber string
	VoteName    string
	FullName    string
	ConfirDate  string
	Phone       string
	JobTitle    string
	Branch      string
	Cluster     string
	Group       string

	GrossPay, BasicPay, NetPay float64
	BirthDate                  sql.NullTime

	CurrentInstallment float64
	LoanBalance        float64

	Allowance       float64
	Affordability   float64
	MaxTenure       float64
	CapitalizedLoan float64

	NetLoanBefore float64
	NetLoanAfter  float64 // refinance: cash in hand after settling
	LoanAmount    float64 // new / reactivation
}

// Qualifying returns the figure this group is judged on, and its threshold.
func (p csPerson) Qualifying() (float64, float64) {
	if p.Group == GroupRefinance {
		return p.NetLoanAfter, csRefinMin
	}
	return p.LoanAmount, csNewReactMin
}

func (p csPerson) Qualifies() bool {
	v, min := p.Qualifying()
	return v >= min
}

func (p csPerson) Whitelisted() bool {
	for _, pre := range csWhitelistPrefixes {
		if strings.HasPrefix(p.CheckNumber, pre) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// The formula chain
// ---------------------------------------------------------------------------

// csAgeYears is complete years lived — DATEDIF(birth, TODAY(), "y").
func csAgeYears(birth time.Time, today time.Time) float64 {
	y := today.Year() - birth.Year()
	if today.Month() < birth.Month() ||
		(today.Month() == birth.Month() && today.Day() < birth.Day()) {
		y--
	}
	if y < 0 {
		return 0
	}
	return float64(y)
}

// csMaxTenureFor is how long they can borrow: months left until 59½, capped at
// 96. Somebody with no date of birth on file gets nothing rather than a
// default, because guessing here hands out a loan the salary cannot repay.
func csMaxTenureFor(birth sql.NullTime, today time.Time) float64 {
	if !birth.Valid {
		return 0
	}
	months := (csRetireAge - csAgeYears(birth.Time, today)) * 12
	return math.Max(0, math.Min(csMaxTenure, months))
}

// csCapitalizedLoan runs the monthly figure backwards through the annuity
// formula to the biggest loan it can carry.
func csCapitalizedLoan(affordability, tenure float64) float64 {
	if affordability <= 0 || tenure <= 0 {
		return 0
	}
	denom := csMonthlyRate/(1-math.Pow(1+csMonthlyRate, -tenure)) + csAdminRate
	if denom <= 0 || math.IsNaN(denom) || math.IsInf(denom, 0) {
		return 0
	}
	v := affordability / denom
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	return v
}

// csNetBefore strips the processing fee and its VAT off the capitalised loan.
func csNetBefore(capLoan float64) float64 {
	if capLoan <= 0 {
		return 0
	}
	v := (csProcFee + capLoan) / (1 + csProcFee)
	if v > capLoan {
		return 0
	}
	return math.Max(0, v)
}

// computeAffordability fills in the whole chain for one person.
func computeAffordability(p *csPerson, today time.Time) {
	// Allowances are the part of gross that is not basic. They are not
	// dependable income, so they are taken out again below.
	p.Allowance = p.GrossPay - p.BasicPay

	// A third of basic pay is protected by law and cannot be lent against.
	disposable := p.NetPay - p.BasicPay/3 - p.Allowance
	if disposable < 0 {
		disposable = 0
	}
	p.Affordability = disposable

	// For a refinance the new loan swallows the old one, so the installment
	// they are already paying is freed up and counts as affordability.
	if p.Group == GroupRefinance {
		p.Affordability += p.CurrentInstallment
	}

	p.MaxTenure = csMaxTenureFor(p.BirthDate, today)
	p.CapitalizedLoan = csCapitalizedLoan(p.Affordability, p.MaxTenure)
	p.NetLoanBefore = csNetBefore(p.CapitalizedLoan)

	if p.Group == GroupRefinance {
		// Cash actually reaching the client, after settling what they owe.
		p.NetLoanAfter = math.Max(0, p.NetLoanBefore-p.LoanBalance)
	} else {
		p.LoanAmount = p.NetLoanBefore
	}
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type csRunInputs struct {
	InstBatch sql.NullString
	LoanBatch sql.NullString
	Today     time.Time
	ZC        *ZoneClusters
}

// activeCSBatch returns the batch a report should read for a kind.
func activeCSBatch(kind string) (sql.NullString, error) {
	var id sql.NullString
	err := database.DB.QueryRow(
		`SELECT id::text FROM mambu_cs_batches WHERE kind=$1 AND status='ACTIVE'`, kind).Scan(&id)
	if err == sql.ErrNoRows {
		return sql.NullString{}, nil
	}
	return id, err
}

// loadCSPeople pulls the register, attaches each person's deductions and loan
// status, and works out the affordability chain.
//
// The joins are done in SQL rather than in Go: the register is ~650,000 people
// and the deductions over a million rows, and moving that across the wire to
// group it here would be slow for no benefit.
func loadCSPeople(in csRunInputs) ([]*csPerson, map[string]int, error) {
	instBatch := ""
	if in.InstBatch.Valid {
		instBatch = in.InstBatch.String
	}
	loanBatch := ""
	if in.LoanBatch.Valid {
		loanBatch = in.LoanBatch.String
	}

	// client_status mirrors process_data.py: a live balance is ACTIVE, a
	// settled one INACTIVE, and anyone the loan file has never heard of is NEW.
	// Where a person has several loan rows the largest balance wins, so one
	// settled loan cannot hide a live one.
	const q = `
WITH inst AS (
    SELECT check_number,
           COALESCE(SUM(installment), 0) AS total_installment,
           COALESCE(SUM(balance), 0)     AS total_balance
      FROM mambu_installments
     WHERE ($1 = '' OR batch_id::text = $1)
     GROUP BY check_number
), loans AS (
    SELECT check_number,
           MAX(COALESCE(total_balance, 0)) AS loan_balance,
           MIN(branch) FILTER (WHERE branch IS NOT NULL) AS branch
      FROM mambu_cs_loans
     WHERE ($2 = '' OR batch_id::text = $2)
     GROUP BY check_number
)
SELECT e.check_number,
       COALESCE(e.votename, ''),
       btrim(COALESCE(e.first_name,'') || ' ' || COALESCE(e.middle_name,'') || ' ' || COALESCE(e.last_name,'')),
       COALESCE(to_char(e.confirdate, 'YYYY-MM-DD'), ''),
       COALESCE(e.phone, ''),
       COALESCE(e.jobtittle, ''),
       COALESCE(l.branch, ''),
       COALESCE(e.grosspay, 0), COALESCE(e.basicpay, 0), COALESCE(e.netpay, 0),
       e.birth_date,
       COALESCE(i.total_installment, 0),
       COALESCE(i.total_balance, 0),
       CASE WHEN l.check_number IS NULL THEN 'NEW'
            WHEN l.loan_balance > 0     THEN 'ACTIVE'
            ELSE 'INACTIVE' END AS client_status
  FROM mambu_employees e
  LEFT JOIN inst  i ON i.check_number = btrim(e.check_number)
  LEFT JOIN loans l ON l.check_number = btrim(e.check_number)`

	rows, err := database.DB.Query(q, instBatch, loanBatch)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	counts := map[string]int{}
	var out []*csPerson
	for rows.Next() {
		p := &csPerson{}
		var status string
		if err := rows.Scan(&p.CheckNumber, &p.VoteName, &p.FullName, &p.ConfirDate,
			&p.Phone, &p.JobTitle, &p.Branch,
			&p.GrossPay, &p.BasicPay, &p.NetPay, &p.BirthDate,
			&p.CurrentInstallment, &p.LoanBalance, &status); err != nil {
			continue
		}
		switch status {
		case "ACTIVE":
			p.Group = GroupRefinance
		case "INACTIVE":
			p.Group = GroupReactivation
		default:
			p.Group = GroupNew
		}
		p.FullName = strings.Join(strings.Fields(p.FullName), " ")
		p.Phone = rrNormalisePhone(p.Phone)
		counts[p.Group]++
		out = append(out, p)
	}
	return out, counts, rows.Err()
}

// assignBranches fills the branch nobody could be matched to from the loan
// file, using the same tiered fallback the script had: a colleague at the same
// employer (votename) who IS in the loan file tells us where that employer's
// people are served. Then Branch -> Cluster from the live roster.
func assignBranches(people []*csPerson, zc *ZoneClusters) map[string]int {
	// votename -> branch, learned from everyone whose branch is known.
	voteBranch := map[string]string{}
	for _, p := range people {
		if p.Branch != "" && p.VoteName != "" {
			if _, ok := voteBranch[p.VoteName]; !ok {
				voteBranch[p.VoteName] = p.Branch
			}
		}
	}

	clusterOf := zc.ClusterForBranch(ProdCS)
	stats := map[string]int{}
	for _, p := range people {
		if p.Branch == "" {
			p.Branch = voteBranch[p.VoteName]
			if p.Branch != "" {
				stats["branchFromColleague"]++
			}
		} else {
			stats["branchFromLoanFile"]++
		}
		if p.Branch == "" {
			stats["branchUnknown"]++
			continue
		}
		p.Cluster = clusterOf[zoneKey(p.Branch)]
		if p.Cluster == "" {
			stats["clusterUnknown"]++
		}
	}
	return stats
}
