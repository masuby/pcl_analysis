# Cluster KPI inspection scripts

Temporary scripts to understand report structures for Cluster KPI implementation.

## Data sources

1. **Management report (Country sheet)**  
   - Columns: Branch, Target, Disbursements This Month.  
   - Rows with Branch = "Cluster 1", "Cluster 2", "Cluster 3", "ZANZIBAR" give cluster-level disbursement and target.  
   - Also used: Portfolio, PAR >30 per product/sheet.

2. **MTD CS report**  
   - Parsed in `useMTDData`: `groupedData` = { [supervisionName]: { supervisionData: row, teamLeaders: [] } }.  
   - supervisionData has MONTH TARGET, VALUE (and other cols).  
   - Supervision names = branch/region names; filter by Cluster using Zone and cluster.xlsx (branch in cluster).

3. **CRM CS reports**  
   - **agent_activity** sheet: Product (filter CS), Zone (region), Status (COMPLETED), Target_Met (AT_LOCATION).  
   - **Lead_Report** sheet: Product (CS), Zone, Consent_Status (ACCEPTED).  
   - Zanzibar Zone → Zanzibar cluster only.

4. **Gap Analysis**  
   - Uses MTD parsed data; buildCSGapRows per supervision. Target vs Achieved sales reps per region; sum by cluster.

5. **Zone and cluster.xlsx**  
   - Columns: Zone, Branch, Cluster, Product.  
   - CS only: Cluster 1/2/3/Zanzibar. Hardcoded in `ClusterKpis/constants.js`.
