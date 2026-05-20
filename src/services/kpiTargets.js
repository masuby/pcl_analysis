/**
 * KPI Targets service (backend-managed KPI target XLSX).
 *
 * Provides upload/list/get parsed/activate/delete/download for:
 * - product: CS / LBF / SME
 * - kind: TOTAL / CLUSTER
 */

const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === undefined ? 'http://localhost:8080' : envApiUrl;

const getToken = () => localStorage.getItem('pcl_token');

const apiFetch = async (endpoint, options = {}, isRetry = false) => {
  const token = getToken();
  const headers = {
    ...options.headers
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

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

  Object.entries(additionalData).forEach(([key, value]) => {
    formData.append(key, value);
  });

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: formData
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    // Helps diagnose cases where the backend returns partial/invalid JSON.
    const preview = text ? text.slice(0, 200) : '';
    throw new Error(`Upload failed: server returned non-JSON response (${response.status}). Preview: ${preview}`);
  }

  if (!response.ok) {
    throw new Error(data?.error || 'Upload failed');
  }

  return data;
};

export const kpiTargetsAPI = {
  upload: async ({ product, kind, file }) => {
    return uploadFile('/api/kpi-targets/upload', file, { product, kind });
  },

  getVersions: async ({ product, kind }) => {
    return apiFetch(`/api/kpi-targets/versions?product=${encodeURIComponent(product)}&kind=${encodeURIComponent(kind)}`);
  },

  getActive: async ({ product, kind }) => {
    return apiFetch(`/api/kpi-targets/active?product=${encodeURIComponent(product)}&kind=${encodeURIComponent(kind)}`);
  },

  getParsed: async (fileId) => {
    return apiFetch(`/api/kpi-targets/${encodeURIComponent(fileId)}/parsed`);
  },

  activate: async (fileId) => {
    return apiFetch(`/api/kpi-targets/${encodeURIComponent(fileId)}/activate`, { method: 'POST', headers: {} });
  },

  remove: async (fileId) => {
    return apiFetch(`/api/kpi-targets/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  },

  downloadBlob: async (fileId) => {
    const token = getToken();
    const response = await fetch(`${API_URL}/api/kpi-targets/${encodeURIComponent(fileId)}/download`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
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
  }
};

