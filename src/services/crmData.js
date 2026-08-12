/**
 * CRM service — the accumulating lead store.
 *
 * Unlike DIGITAL DATA (rebuilt from Google Sheets on each ingest), this store
 * ACCUMULATES: every uploaded Lead_Report is merged into it, matched on the
 * client's phone number. New numbers are appended, numbers already held are
 * updated in place.
 *
 * Leads are distributed to the Team Leader of their own branch.
 */

const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === undefined ? 'http://localhost:8080' : envApiUrl;

const getToken = () => localStorage.getItem('pcl_token');

const apiFetch = async (endpoint, options = {}) => {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const hint = response.status === 404 ? ' Endpoint may not exist.' : '';
    throw new Error(`Server returned invalid response (${response.status})${hint}`);
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

const crmDataService = {
  /**
   * Merge a Lead_Report workbook into the store.
   * Returns { inserted, updated, skipped, badPhones, totalInStore }.
   *
   * @param {File} file
   * @param {(pct:number)=>void} [onProgress] upload progress, 0-100
   */
  upload: (file, onProgress) =>
    new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);

      // XHR rather than fetch: a Lead_Report is ~13 MB and the user needs to see
      // that something is happening.
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/api/crm/upload`);
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* keep {} */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    }),

  getUploads: (limit = 20) => apiFetch(`/api/crm/uploads?limit=${limit}`),
  getSummary: (filters) => apiFetch(`/api/crm/summary${qs(filters)}`),
  getLeads: (filters) => apiFetch(`/api/crm/leads${qs(filters)}`),
  getFilters: () => apiFetch('/api/crm/filters'),

  /** Team Leaders, with the branches and lead counts each covers. */
  getTeamLeaders: () => apiFetch('/api/crm/team-leaders'),

  /**
   * Assign leads to Team Leaders.
   * BY_BRANCH (default) gives each lead to a TL of its own branch.
   * ROUND_ROBIN spreads the selection across explicitly chosen TLs.
   *
   * @param {{ leadIds?: string[], filter?: object, assigneeIds?: string[],
   *           method?: 'BY_BRANCH'|'ROUND_ROBIN'|'MANUAL', note?: string }} payload
   */
  distribute: (payload) =>
    apiFetch('/api/crm/distribute', { method: 'POST', body: JSON.stringify(payload) }),

  getDistributions: (limit = 20) => apiFetch(`/api/crm/distributions?limit=${limit}`),

  /** Email each Team Leader their own leads. `dryRun` previews without sending. */
  send: (payload) => apiFetch('/api/crm/send', { method: 'POST', body: JSON.stringify(payload) }),

  getSendLog: (limit = 30) => apiFetch(`/api/crm/send-log?limit=${limit}`),
};

export default crmDataService;
