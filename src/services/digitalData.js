/**
 * DIGITAL DATA service — the cleaned lead warehouse.
 *
 * The three call-centre workbooks (LBF / CS / SME) are cleaned server-side into
 * `digital_leads`; this module is the read/act surface for that data plus the
 * Zone & Clusters directory used to distribute leads to agents.
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

/** Turn a filter object into a query string, dropping empty values. */
const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

const digitalDataService = {
  /**
   * Run the cleaner over every workbook. Reads ~93k rows, so it can take a
   * couple of minutes; re-running is safe (unchanged rows are skipped).
   * @param {{ includePayroll?: boolean, dayFirst?: boolean }} opts
   */
  ingest: (opts = {}) =>
    apiFetch('/api/digital-data/ingest', { method: 'POST', body: JSON.stringify(opts) }),

  getRuns: (limit = 20) => apiFetch(`/api/digital-data/runs?limit=${limit}`),

  getSummary: (filters) => apiFetch(`/api/digital-data/summary${qs(filters)}`),

  getQuality: (filters) => apiFetch(`/api/digital-data/quality${qs(filters)}`),

  getLeads: (filters) => apiFetch(`/api/digital-data/leads${qs(filters)}`),

  getFilters: () => apiFetch('/api/digital-data/filters'),

  /** Refresh the people directory from the Zone & Clusters workbook. */
  syncDirectory: () => apiFetch('/api/digital-data/directory/sync', { method: 'POST' }),

  /** @param {{ product?: string, channel?: string, role?: string, cluster?: string }} f */
  getDirectory: (f) => apiFetch(`/api/digital-data/directory${qs(f)}`),

  /**
   * Spread leads across the chosen people round-robin.
   *
   * Pass EITHER `leadIds` (explicit per-lead control) OR `filter` (the whole
   * dropdown scope, resolved server-side — this is how a 20,000-lead
   * distribution happens without posting 20,000 ids).
   *
   * A lead that already has an owner moves to the new one, so this is also the
   * "update distribution" path.
   *
   * @param {{ leadIds?: string[], filter?: object, assigneeIds: string[],
   *           product?: string, note?: string }} payload
   */
  distribute: (payload) =>
    apiFetch('/api/digital-data/distribute', { method: 'POST', body: JSON.stringify(payload) }),

  getDistributions: (limit = 20) => apiFetch(`/api/digital-data/distributions?limit=${limit}`),

  /**
   * Email each assignee their own leads as an .xlsx attachment.
   * Scope by `batchId` (what was just distributed) or `filter`.
   * `dryRun` reports who would receive what, without sending.
   *
   * @param {{ batchId?: string, filter?: object, assigneeIds?: string[],
   *           includeAlreadySent?: boolean, dryRun?: boolean, note?: string }} payload
   */
  sendDistribution: (payload) =>
    apiFetch('/api/digital-data/send-distribution', { method: 'POST', body: JSON.stringify(payload) }),

  getSendLog: (limit = 30) => apiFetch(`/api/digital-data/send-log?limit=${limit}`),
};

export default digitalDataService;
