/**
 * Hardcoded Zone and Cluster mapping for CS (from Zone and cluster.xlsx).
 * These are constants and will not change.
 */

/** Cluster display names */
export const CLUSTER_NAMES = ['Cluster 1', 'Cluster 2', 'Cluster 3', 'Zanzibar'];

/**
 * Zones (regions) per cluster. Used for MTD supervisions and CRM Zone column.
 * Zanzibar zone is used for Zanzibar cluster only.
 */
export const ZONES_BY_CLUSTER_CS = {
  'Cluster 1': ['Central Zone', 'Northern Zone', 'Pwani Zone'],
  'Cluster 2': ['Highland Zone', 'Lake Victoria Zone', 'Western Zone'],
  'Cluster 3': ['Nyasa Zone', 'Southern Highland Zone'],
  'Zanzibar': ['ZANZIBAR']
};

/**
 * Branch names per cluster (CS only). From Zone and cluster.xlsx. Used for branch-level KPIs and MTD team leader mapping.
 */
export const BRANCHES_BY_CLUSTER_CS = {
  'Cluster 1': [
    'Arusha', 'Dodoma', 'Kibaha', 'Kilosa', 'Korogwe', 'Lindi', 'Lushoto', 'Manyara',
    'Mkuranga', 'Morogoro', 'Moshi', 'Singida', 'Tanga', 'Dar es Salaam'
  ],
  'Cluster 2': [
    'Mwanza', 'Bariadi', 'Bukoba', 'Chato', 'Geita', 'Kahama', 'Kasulu', 'Kigoma',
    'Musoma', 'Nzega', 'Shinyanga', 'Tabora', 'Ukerewe', 'Urambo'
  ],
  'Cluster 3': [
    'Ifakara', 'Iringa', 'Masasi', 'Mbeya', 'Mpanda', 'Mtwara', 'Nachingwea', 'Njombe',
    'Songea', 'Sumbawanga', 'Tunduru', 'Vwawa'
  ],
  'Zanzibar': [
    'ZANZIBAR', 'Zanzibar Main Branch', 'Michenzani  Mall Branch', 'Pemba Branch'
  ]
};

/**
 * MTD supervision names often match Branch names or Zone names.
 * We use branch names to filter "regions" (supervisions) in cluster.
 */
export function getSupervisionNamesForCluster(cluster) {
  return BRANCHES_BY_CLUSTER_CS[cluster] || [];
}

export function getZonesForCluster(cluster) {
  return ZONES_BY_CLUSTER_CS[cluster] || [];
}

export function getBranchesForCluster(cluster) {
  return BRANCHES_BY_CLUSTER_CS[cluster] || [];
}
