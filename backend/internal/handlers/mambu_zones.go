package handlers

// The Zone and Clusters roster — read from the live Google Sheet.
//
// The old scripts read a local Zone and Clusters.xlsx. That copy went stale
// every time somebody moved branch, so this reads the workbook online instead.
// Layout (unchanged from the file):
//
//   "Zone and cluster"  Zone | Branch | Cluster | Product   — the branch map
//   every other tab     Zone | Branch | Name | Role | Phone | Email | Cluster | Product
//
// The "CRM" tab has a Name column but no Branch/Phone, so its rows could never
// match a branch and never entered a distribution pool. It is skipped here for
// the same reason, explicitly rather than by accident.
//
// Products present in the sheet: CS, LBF, SME and Agrifinance. Agrifinance has
// exactly ONE map row (Tukuyu / Maziwa) and NO people at all, which is why the
// old script special-cased a "Tukuyu" folder instead of treating it as a
// product. It is a real product here, and the missing roster is reported as a
// warning rather than silently producing unassigned files.

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"google.golang.org/api/sheets/v4"
)

const zoneMapSheet = "Zone and cluster"

// ZonePerson is one row of a roster tab.
type ZonePerson struct {
	Zone, Branch, Name, Role, Phone, Email, Cluster, Product string

	BranchKey, ClusterKey, ZoneKey, ProductKey string
	RoleClass                                  string
}

// ZoneMapRow is one row of the branch map.
type ZoneMapRow struct {
	Zone, Branch, Cluster, Product string
	ZoneKey, BranchKey, ProductKey string
}

// ZoneClusters is the whole roster, loaded once per run.
type ZoneClusters struct {
	Map      []ZoneMapRow
	People   []ZonePerson
	LoadedAt time.Time
	Title    string
}

// zoneKey is the match key used everywhere: upper-case, single-spaced.
// Branch names are typed by hand in both the exports and the sheet, so
// "  Zanzibar  Main Branch " and "ZANZIBAR MAIN BRANCH" have to be one key.
func zoneKey(s string) string {
	return strings.Join(strings.Fields(strings.ToUpper(strings.TrimSpace(s))), " ")
}

// roleClass buckets a free-text Role into the classes the distribution rules
// use. Roles are typed inconsistently ("CLUSTER SALES MANAGER", "Cluster
// Manager", "CC Agent", "Agent"), so this matches on substrings.
func roleClass(role string) string {
	r := strings.ToLower(role)
	switch {
	case strings.Contains(r, "agent"):
		return "agent"
	case strings.Contains(r, "branch loan officer"):
		return "blo"
	case strings.Contains(r, "team leader"):
		// Independent Team Leaders distribute like TLs but are tracked apart.
		if strings.Contains(r, "independent") {
			return "itl"
		}
		return "tl"
	case strings.Contains(r, "sales coordinator"):
		return "coordinator"
	}
	return "other" // managers, RSMs — recipients, not assignees
}

var sheetIDFromURL = regexp.MustCompile(`/d/([a-zA-Z0-9\-_]+)`)

// zoneSheetID accepts either a bare spreadsheet id or a full edit URL, because
// the value pasted into .env is usually the URL straight from the browser.
func zoneSheetID() string {
	raw := strings.TrimSpace(os.Getenv("ZONE_CLUSTERS_SHEET_ID"))
	if raw == "" {
		return ""
	}
	if m := sheetIDFromURL.FindStringSubmatch(raw); m != nil {
		return m[1]
	}
	return raw
}

var (
	zoneCacheMu  sync.Mutex
	zoneCache    *ZoneClusters
	zoneCacheTTL = 10 * time.Minute
)

// LoadZoneClusters reads the roster, using a short cache so a run that touches
// several products does not re-fetch the same workbook repeatedly.
func LoadZoneClusters(ctx context.Context, forceRefresh bool) (*ZoneClusters, error) {
	zoneCacheMu.Lock()
	defer zoneCacheMu.Unlock()

	if !forceRefresh && zoneCache != nil && time.Since(zoneCache.LoadedAt) < zoneCacheTTL {
		return zoneCache, nil
	}

	id := zoneSheetID()
	if id == "" {
		return nil, fmt.Errorf("ZONE_CLUSTERS_SHEET_ID is not set — the roster cannot be read")
	}

	svc, err := newSheetsService(ctx)
	if err != nil {
		return nil, fmt.Errorf("google sheets: %w", err)
	}

	meta, err := svc.Spreadsheets.Get(id).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("reading the Zone and Clusters sheet: %w", err)
	}

	zc := &ZoneClusters{LoadedAt: time.Now(), Title: meta.Properties.Title}

	for _, sh := range meta.Sheets {
		tab := sh.Properties.Title
		vals, err := readZoneTab(ctx, svc, id, tab)
		if err != nil || len(vals) < 2 {
			continue
		}
		head := headerIndex(vals[0])

		if tab == zoneMapSheet {
			for _, row := range vals[1:] {
				r := ZoneMapRow{
					Zone:    cellAt(row, head, "zone"),
					Branch:  cellAt(row, head, "branch"),
					Cluster: cellAt(row, head, "cluster"),
					Product: cellAt(row, head, "product"),
				}
				if r.Branch == "" && r.Zone == "" {
					continue
				}
				r.ZoneKey, r.BranchKey, r.ProductKey = zoneKey(r.Zone), zoneKey(r.Branch), zoneKey(r.Product)
				zc.Map = append(zc.Map, r)
			}
			continue
		}

		// A roster tab must carry both a Name and a Branch to be usable — that
		// is what excludes the CRM tab, whose rows have no branch to match on.
		if _, ok := head["name"]; !ok {
			continue
		}
		if _, ok := head["branch"]; !ok {
			continue
		}

		for _, row := range vals[1:] {
			p := ZonePerson{
				Zone:    cellAt(row, head, "zone"),
				Branch:  cellAt(row, head, "branch"),
				Name:    cellAt(row, head, "name"),
				Role:    cellAt(row, head, "role"),
				Phone:   cellAt(row, head, "phone"),
				Email:   cellAt(row, head, "email"),
				Cluster: cellAt(row, head, "cluster"),
				Product: cellAt(row, head, "product"),
			}
			if p.Name == "" {
				continue
			}
			p.BranchKey, p.ClusterKey = zoneKey(p.Branch), zoneKey(p.Cluster)
			p.ZoneKey, p.ProductKey = zoneKey(p.Zone), zoneKey(p.Product)
			p.RoleClass = roleClass(p.Role)
			zc.People = append(zc.People, p)
		}
	}

	// The same person can appear on more than one tab; dedupe the way the
	// original did, on branch + name + phone + product.
	seen := map[string]bool{}
	uniq := zc.People[:0]
	for _, p := range zc.People {
		k := p.BranchKey + "|" + p.Name + "|" + p.Phone + "|" + p.ProductKey
		if seen[k] {
			continue
		}
		seen[k] = true
		uniq = append(uniq, p)
	}
	zc.People = uniq

	if len(zc.Map) == 0 {
		return nil, fmt.Errorf("the %q tab produced no branch rows", zoneMapSheet)
	}

	zoneCache = zc
	return zc, nil
}

func readZoneTab(ctx context.Context, svc *sheets.Service, id, tab string) ([][]interface{}, error) {
	// Sheet names contain spaces, so the range must be quoted.
	resp, err := svc.Spreadsheets.Values.
		Get(id, fmt.Sprintf("'%s'!A1:Z5000", strings.ReplaceAll(tab, "'", "''"))).
		Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.Values, nil
}

// headerIndex maps a lower-cased header name to its column position.
func headerIndex(row []interface{}) map[string]int {
	out := map[string]int{}
	for i, v := range row {
		name := strings.ToLower(strings.TrimSpace(fmt.Sprint(v)))
		if name != "" {
			if _, dup := out[name]; !dup {
				out[name] = i
			}
		}
	}
	return out
}

// cellAt reads a named column, tolerating short rows — Sheets omits trailing
// empty cells, so a row can be shorter than the header.
func cellAt(row []interface{}, head map[string]int, name string) string {
	i, ok := head[name]
	if !ok || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(row[i]))
}

// ---------------------------------------------------------------------------
// Lookups used by the pipeline
// ---------------------------------------------------------------------------

// ClusterForBranch resolves Branch -> Cluster within one product, the
// VLOOKUP the original did against the map sheet.
func (zc *ZoneClusters) ClusterForBranch(product string) map[string]string {
	pk := zoneKey(product)
	out := map[string]string{}
	for _, r := range zc.Map {
		if r.ProductKey == pk {
			if _, dup := out[r.BranchKey]; !dup {
				out[r.BranchKey] = r.Cluster
			}
		}
	}
	return out
}

// ZoneForBranch resolves Branch -> Zone within one product.
func (zc *ZoneClusters) ZoneForBranch(product string) map[string]string {
	pk := zoneKey(product)
	out := map[string]string{}
	for _, r := range zc.Map {
		if r.ProductKey == pk {
			if _, dup := out[r.BranchKey]; !dup {
				out[r.BranchKey] = r.Zone
			}
		}
	}
	return out
}

func (zc *ZoneClusters) peopleWhere(match func(ZonePerson) bool) []ZonePerson {
	var out []ZonePerson
	for _, p := range zc.People {
		if match(p) {
			out = append(out, p)
		}
	}
	return out
}

func filterClass(in []ZonePerson, classes ...string) []ZonePerson {
	want := map[string]bool{}
	for _, c := range classes {
		want[c] = true
	}
	var out []ZonePerson
	for _, p := range in {
		if want[p.RoleClass] {
			out = append(out, p)
		}
	}
	return out
}

// PeopleForBranch is the distribution pool for one branch:
// agents where the branch has them (the call centres), otherwise
// TL + Independent TL + Branch Loan Officer. An LBF branch with neither
// falls back to its Sales Coordinator, then to the global "LBF All Branch"
// coordinator — which is how upcountry LBF branches get covered at all.
func (zc *ZoneClusters) PeopleForBranch(product, branch string) []ZonePerson {
	pk, bk := zoneKey(product), zoneKey(branch)
	sub := zc.peopleWhere(func(p ZonePerson) bool {
		return p.ProductKey == pk && p.BranchKey == bk
	})

	if agents := filterClass(sub, "agent"); len(agents) > 0 {
		return agents
	}
	if pool := filterClass(sub, "tl", "itl", "blo"); len(pool) > 0 {
		return pool
	}
	if pk == "LBF" {
		if coord := filterClass(sub, "coordinator"); len(coord) > 0 {
			return coord
		}
		return filterClass(zc.peopleWhere(func(p ZonePerson) bool {
			return p.ProductKey == pk && p.BranchKey == "LBF ALL BRANCH"
		}), "coordinator")
	}
	return nil
}

// PeopleForCluster is the pool for a cluster workbook: everyone eligible
// across that cluster's branches, under the same role rules.
func (zc *ZoneClusters) PeopleForCluster(product, cluster string) []ZonePerson {
	pk, ck := zoneKey(product), zoneKey(cluster)
	sub := zc.peopleWhere(func(p ZonePerson) bool {
		return p.ProductKey == pk && p.ClusterKey == ck
	})
	if agents := filterClass(sub, "agent"); len(agents) > 0 {
		return agents
	}
	return filterClass(sub, "tl", "itl", "blo")
}

// CallCentrePeople is the pool for the UNALLOCATED workbook — nobody owns
// those clients, so they go to the call centre. SME has no call centre, so
// its Team Leaders take them.
func (zc *ZoneClusters) CallCentrePeople(product string) []ZonePerson {
	pk := zoneKey(product)
	sub := zc.peopleWhere(func(p ZonePerson) bool { return p.ProductKey == pk })
	if agents := filterClass(sub, "agent"); len(agents) > 0 {
		return agents
	}
	return filterClass(sub, "tl", "itl", "blo")
}

func withRole(in []ZonePerson, tokens ...string) []ZonePerson {
	var out []ZonePerson
	seen := map[string]bool{}
	for _, p := range in {
		r := strings.ToLower(p.Role)
		for _, t := range tokens {
			if strings.Contains(r, t) {
				k := p.Name + "|" + p.Phone
				if !seen[k] {
					seen[k] = true
					out = append(out, p)
				}
				break
			}
		}
	}
	return out
}

func firstNonEmpty(frames ...[]ZonePerson) []ZonePerson {
	for _, f := range frames {
		if len(f) > 0 {
			return f
		}
	}
	return nil
}

// ZoneRecipients: who a zone workbook is addressed to — the CS Regional Sales
// Manager, or the Cluster Sales Manager for LBF and SME, with fallbacks so a
// zone missing its manager still reaches somebody.
func (zc *ZoneClusters) ZoneRecipients(product, zone string) []ZonePerson {
	pk, zk := zoneKey(product), zoneKey(zone)
	sub := zc.peopleWhere(func(p ZonePerson) bool {
		return p.ProductKey == pk && p.ZoneKey == zk
	})
	if pk == "CS" {
		return firstNonEmpty(
			withRole(sub, "regional sales manager"),
			withRole(sub, "cluster manager"),
			withRole(sub, "branch manager"),
			withRole(sub, "team leader"))
	}
	return firstNonEmpty(
		withRole(sub, "cluster sales manager", "cluster manager"),
		withRole(sub, "branch manager"),
		withRole(sub, "team leader"))
}

// ClusterRecipients: who a cluster workbook is addressed to.
func (zc *ZoneClusters) ClusterRecipients(product, cluster string) []ZonePerson {
	pk, ck := zoneKey(product), zoneKey(cluster)
	sub := zc.peopleWhere(func(p ZonePerson) bool {
		return p.ProductKey == pk && p.ClusterKey == ck
	})
	return firstNonEmpty(
		withRole(sub, "cluster sales manager", "cluster manager"),
		withRole(sub, "branch manager"),
		withRole(sub, "regional sales manager"),
		withRole(sub, "team leader"))
}

// UnallocatedRecipients: the call centre's Branch Manager, or its Team Leader
// where the sheet lists no manager.
func (zc *ZoneClusters) UnallocatedRecipients(product string) []ZonePerson {
	pk := zoneKey(product)
	sub := zc.peopleWhere(func(p ZonePerson) bool { return p.ProductKey == pk })

	ccBranches := map[string]bool{}
	for _, p := range sub {
		if p.RoleClass == "agent" {
			ccBranches[p.BranchKey] = true
		}
	}
	if len(ccBranches) > 0 {
		var narrowed []ZonePerson
		for _, p := range sub {
			if ccBranches[p.BranchKey] {
				narrowed = append(narrowed, p)
			}
		}
		sub = narrowed
	}
	return firstNonEmpty(withRole(sub, "branch manager"), withRole(sub, "team leader"))
}

// TeamLeadersByBranch maps Branch -> the TL names, " / " joined.
func (zc *ZoneClusters) TeamLeadersByBranch(product string) map[string]string {
	pk := zoneKey(product)
	order := []string{}
	byBranch := map[string][]string{}
	for _, p := range zc.People {
		if p.ProductKey != pk || (p.RoleClass != "tl" && p.RoleClass != "itl") {
			continue
		}
		if _, ok := byBranch[p.BranchKey]; !ok {
			order = append(order, p.BranchKey)
		}
		byBranch[p.BranchKey] = appendUnique(byBranch[p.BranchKey], p.Name)
	}
	out := map[string]string{}
	for _, b := range order {
		out[b] = strings.Join(byBranch[b], " / ")
	}
	return out
}

// TLContactByBranch maps Branch -> the TL phone numbers, " au " joined
// ("au" is Swahili "or" — the clients read these).
//
// Where a branch has no TL phone: LBF falls back to its Sales Coordinator and
// then the global coordinator; CS falls back to the zone-level manager, so a
// branch between team leaders still shows a number somebody answers.
func (zc *ZoneClusters) TLContactByBranch(product string) func(branch string) string {
	pk := zoneKey(product)
	sub := zc.peopleWhere(func(p ZonePerson) bool { return p.ProductKey == pk })

	joinPhones := func(in []ZonePerson) map[string]string {
		order := []string{}
		byBranch := map[string][]string{}
		for _, p := range in {
			if p.Phone == "" {
				continue
			}
			if _, ok := byBranch[p.BranchKey]; !ok {
				order = append(order, p.BranchKey)
			}
			byBranch[p.BranchKey] = appendUnique(byBranch[p.BranchKey], p.Phone)
		}
		out := map[string]string{}
		for _, b := range order {
			out[b] = strings.Join(byBranch[b], " au ")
		}
		return out
	}

	tlPhones := joinPhones(filterClass(sub, "tl", "itl"))
	coordPhones := joinPhones(filterClass(sub, "coordinator"))
	// CS zone-level managers sit on rows whose Branch equals the Zone name.
	mgrPhones := joinPhones(filterClass(sub, "other"))
	globalCoord := coordPhones["LBF ALL BRANCH"]
	branchZone := zc.ZoneForBranch(product)

	return func(branch string) string {
		bk := zoneKey(branch)
		if bk == "" {
			return ""
		}
		if tl := tlPhones[bk]; tl != "" {
			return tl
		}
		if pk == "LBF" {
			if c := coordPhones[bk]; c != "" {
				return c
			}
			return globalCoord
		}
		return mgrPhones[zoneKey(branchZone[bk])]
	}
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}
