/**
 * Maps branch names to their cluster, zone, and type structure
 */

export const branchMapping = {
  // CS - Cluster 1
  'Arusha': { type: 'CS', cluster: 'Cluster 1', zone: 'Northern Zone' },
  'Korogwe': { type: 'CS', cluster: 'Cluster 1', zone: 'Northern Zone' },
  'Lushoto': { type: 'CS', cluster: 'Cluster 1', zone: 'Northern Zone' },
  'Moshi': { type: 'CS', cluster: 'Cluster 1', zone: 'Northern Zone' },
  'Tanga': { type: 'CS', cluster: 'Cluster 1', zone: 'Northern Zone' },
  'Dar es Salaam': { type: 'CS', cluster: 'Cluster 1', zone: 'Pwani Zone' },
  'Kibaha': { type: 'CS', cluster: 'Cluster 1', zone: 'Pwani Zone' },
  'Lindi': { type: 'CS', cluster: 'Cluster 1', zone: 'Pwani Zone' },
  'Mkuranga': { type: 'CS', cluster: 'Cluster 1', zone: 'Pwani Zone' },
  'Dodoma': { type: 'CS', cluster: 'Cluster 1', zone: 'Central Zone' },
  'Kilosa': { type: 'CS', cluster: 'Cluster 1', zone: 'Central Zone' },
  'Manyara': { type: 'CS', cluster: 'Cluster 1', zone: 'Central Zone' },
  'Morogoro': { type: 'CS', cluster: 'Cluster 1', zone: 'Central Zone' },
  'Singida': { type: 'CS', cluster: 'Cluster 1', zone: 'Central Zone' },

  // CS - Cluster 2
  'Bariadi': { type: 'CS', cluster: 'Cluster 2', zone: 'Western Zone' },
  'Chato': { type: 'CS', cluster: 'Cluster 2', zone: 'Western Zone' },
  'Geita': { type: 'CS', cluster: 'Cluster 2', zone: 'Western Zone' },
  'Kahama': { type: 'CS', cluster: 'Cluster 2', zone: 'Western Zone' },
  'Shinyanga': { type: 'CS', cluster: 'Cluster 2', zone: 'Western Zone' },
  'Bukoba': { type: 'CS', cluster: 'Cluster 2', zone: 'Lake Victoria Zone' },
  'Musoma': { type: 'CS', cluster: 'Cluster 2', zone: 'Lake Victoria Zone' },
  'Mwanza': { type: 'CS', cluster: 'Cluster 2', zone: 'Lake Victoria Zone' },
  'Ukerewe': { type: 'CS', cluster: 'Cluster 2', zone: 'Lake Victoria Zone' },
  'Kasulu': { type: 'CS', cluster: 'Cluster 2', zone: 'Highland Zone' },
  'Kigoma': { type: 'CS', cluster: 'Cluster 2', zone: 'Highland Zone' },
  'Nzega': { type: 'CS', cluster: 'Cluster 2', zone: 'Highland Zone' },
  'Tabora': { type: 'CS', cluster: 'Cluster 2', zone: 'Highland Zone' },
  'Urambo': { type: 'CS', cluster: 'Cluster 2', zone: 'Highland Zone' },

  // CS - Cluster 3
  'Ifakara': { type: 'CS', cluster: 'Cluster 3', zone: 'Southern Highland Zone' },
  'Iringa': { type: 'CS', cluster: 'Cluster 3', zone: 'Southern Highland Zone' },
  'Mbeya': { type: 'CS', cluster: 'Cluster 3', zone: 'Southern Highland Zone' },
  'Mpanda': { type: 'CS', cluster: 'Cluster 3', zone: 'Southern Highland Zone' },
  'Sumbawanga': { type: 'CS', cluster: 'Cluster 3', zone: 'Southern Highland Zone' },
  'Vwawa': { type: 'CS', cluster: 'Cluster 3', zone: 'Southern Highland Zone' },
  'Masasi': { type: 'CS', cluster: 'Cluster 3', zone: 'Nyasa Zone' },
  'Mtwara': { type: 'CS', cluster: 'Cluster 3', zone: 'Nyasa Zone' },
  'Nachingwea': { type: 'CS', cluster: 'Cluster 3', zone: 'Nyasa Zone' },
  'Njombe': { type: 'CS', cluster: 'Cluster 3', zone: 'Nyasa Zone' },
  'Songea': { type: 'CS', cluster: 'Cluster 3', zone: 'Nyasa Zone' },
  'Tunduru': { type: 'CS', cluster: 'Cluster 3', zone: 'Nyasa Zone' },

  // CS - ZANZIBAR
  'Michenzani Mall Branch': { type: 'CS', cluster: 'ZANZIBAR', zone: null },
  'Pemba Branch': { type: 'CS', cluster: 'ZANZIBAR', zone: null },
  'Zanzibar Main Branch': { type: 'CS', cluster: 'ZANZIBAR', zone: null },

  // CS - Call Center
  'CS Call center': { type: 'CS', cluster: 'CS Call center', zone: null },

  // LBF - Call Center
  'Lbf Call Center zone': { type: 'LBF', cluster: 'Lbf Call Center', zone: null },
  'LBF Call Center': { type: 'LBF', cluster: 'Lbf Call Center', zone: null },

  // LBF - Cluster (all LBF branches)
  'LBF Arusha Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Babati Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF CITY CENTRE': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF City Mall': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Geita': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF IRINGA BRANCH': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF KIGAMBONI BRANCH': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Kahama Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Kigoma Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF MOROGORO BRANCH': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Mikocheni Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Mlimani Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Musoma Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Mwanza Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF NJOMBE': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Office Dodoma': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF TAZARA BRANCH': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Tabata': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Tanga': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF Tegeta Branch': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },
  'LBF office Mbeya': { type: 'LBF', cluster: 'Lbf Cluster', zone: null },

  // SME
  'SME ARUSHA BRANCH': { type: 'SME', cluster: 'SMEs', zone: null },
  'SME MBEYA BRANCH': { type: 'SME', cluster: 'SMEs', zone: null },
  'SME MOROGORO BRANCH': { type: 'SME', cluster: 'SMEs', zone: null },
  'SME Njombe': { type: 'SME', cluster: 'SMEs', zone: null },
  'SME Tazara Branch': { type: 'SME', cluster: 'SMEs', zone: null },
};

/**
 * Get cluster structure for a type
 */
export const getClusterStructure = (type) => {
  const structure = {
    CS: {
      'Cluster 1': {
        'Northern Zone': ['Arusha', 'Korogwe', 'Lushoto', 'Moshi', 'Tanga'],
        'Pwani Zone': ['Dar es Salaam', 'Kibaha', 'Lindi', 'Mkuranga'],
        'Central Zone': ['Dodoma', 'Kilosa', 'Manyara', 'Morogoro', 'Singida']
      },
      'Cluster 2': {
        'Western Zone': ['Bariadi', 'Chato', 'Geita', 'Kahama', 'Shinyanga'],
        'Lake Victoria Zone': ['Bukoba', 'Musoma', 'Mwanza', 'Ukerewe'],
        'Highland Zone': ['Kasulu', 'Kigoma', 'Nzega', 'Tabora', 'Urambo']
      },
      'Cluster 3': {
        'Southern Highland Zone': ['Ifakara', 'Iringa', 'Mbeya', 'Mpanda', 'Sumbawanga', 'Vwawa'],
        'Nyasa Zone': ['Masasi', 'Mtwara', 'Nachingwea', 'Njombe', 'Songea', 'Tunduru']
      },
      'ZANZIBAR': {
        branches: ['Michenzani Mall Branch', 'Pemba Branch', 'Zanzibar Main Branch']
      },
      'CS Call center': {
        branches: ['CS Call center']
      }
    },
    LBF: {
      'Lbf Call Center': {
        branches: ['Lbf Call Center zone', 'LBF Call Center']
      },
      'Lbf Cluster': {
        branches: [
          'LBF Arusha Branch', 'LBF Babati Branch', 'LBF CITY CENTRE', 'LBF City Mall',
          'LBF Geita', 'LBF IRINGA BRANCH', 'LBF KIGAMBONI BRANCH', 'LBF Kahama Branch',
          'LBF Kigoma Branch', 'LBF MOROGORO BRANCH', 'LBF Mikocheni Branch', 'LBF Mlimani Branch',
          'LBF Musoma Branch', 'LBF Mwanza Branch', 'LBF NJOMBE', 'LBF Office Dodoma',
          'LBF TAZARA BRANCH', 'LBF Tabata', 'LBF Tanga', 'LBF Tegeta Branch', 'LBF office Mbeya'
        ]
      }
    },
    SME: {
      'SMEs': {
        branches: ['SME ARUSHA BRANCH', 'SME MBEYA BRANCH', 'SME MOROGORO BRANCH', 'SME Njombe', 'SME Tazara Branch']
      }
    }
  };

  return structure[type] || {};
};

/**
 * Get mapping for a branch name
 * Handles normalization (trim, case-insensitive, double spaces)
 */
export const getBranchMapping = (branchName) => {
  if (!branchName) return null;
  
  // Normalize: trim and replace multiple spaces with single space
  const normalized = branchName.trim().replace(/\s+/g, ' ');
  
  // Try exact match first
  if (branchMapping[normalized]) {
    return branchMapping[normalized];
  }
  
  // Try case-insensitive match
  const lowerNormalized = normalized.toLowerCase();
  for (const key in branchMapping) {
    if (key.toLowerCase() === lowerNormalized) {
      return branchMapping[key];
    }
  }
  
  // Try with original name
  if (branchMapping[branchName]) {
    return branchMapping[branchName];
  }
  
  return null;
};



