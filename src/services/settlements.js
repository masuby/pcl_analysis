/**
 * Settlements service (backend-managed Settlements XLSX files).
 *
 * Provides upload/get active/download/delete for the two settlement inputs:
 *   - kind: TRANSACTIONS  (monthly transactions export)
 *   - kind: ZONE_CLUSTER  (branch -> product mapping used for VLOOKUP)
 */

const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === undefined ? 'http://localhost:8080' : envApiUrl;

const getToken = () => localStorage.getItem('pcl_token');

const apiFetch = async (endpoint, options = {}) => {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    const hint = response.status === 404 ? ' Endpoint may not exist.' : '';
    throw new Error(`Server returned invalid response (${response.status})${hint}`);
  }
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
};

const uploadFile = async (endpoint, file, additionalData = {}) => {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(additionalData).forEach(([key, value]) => formData.append(key, value));

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    const preview = text ? text.slice(0, 200) : '';
    throw new Error(`Upload failed: server returned non-JSON response (${response.status}). Preview: ${preview}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || 'Upload failed');
  }
  return data;
};

export const settlementsAPI = {
  upload: async ({ kind, file }) => uploadFile('/api/settlements/upload', file, { kind }),

  getActive: async (kind) =>
    apiFetch(`/api/settlements/active?kind=${encodeURIComponent(kind)}`),

  getVersions: async (kind) =>
    apiFetch(`/api/settlements/versions?kind=${encodeURIComponent(kind)}`),

  remove: async (fileId) =>
    apiFetch(`/api/settlements/${encodeURIComponent(fileId)}`, { method: 'DELETE' }),

  downloadBlob: async (fileId) => {
    const token = getToken();
    const response = await fetch(
      `${API_URL}/api/settlements/${encodeURIComponent(fileId)}/download`,
      { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
    );
    if (!response.ok) {
      const text = await response.text();
      let msg = text;
      try {
        const parsed = JSON.parse(text);
        msg = parsed?.error || text;
      } catch (_) {}
      throw new Error(msg || 'Download failed');
    }
    return response.blob();
  },
};
