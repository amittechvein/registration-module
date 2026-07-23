import axios from 'axios';

export const adminApi = axios.create({ baseURL: '/api/admin' });
adminApi.interceptors.request.use((cfg) => {
  const t = sessionStorage.getItem('adminToken');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
adminApi.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && window.location.pathname.startsWith('/admin') && !window.location.pathname.includes('login')) {
      window.location.href = '/admin/login';
    }
    return Promise.reject(e);
  }
);

export const publicApi = axios.create({ baseURL: '/api/public' });
publicApi.interceptors.request.use((cfg) => {
  const t = sessionStorage.getItem('applicantToken');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

/** Permission helper: owners can do everything; staff need the specific grant. */
export function hasPerm(key) {
  if (sessionStorage.getItem('adminRole') === 'owner') return true;
  try { return !!JSON.parse(sessionStorage.getItem('adminPerms') || '{}')[key]; } catch { return false; }
}

export function storeAdminSession(data) {
  sessionStorage.setItem('adminToken', data.token);
  sessionStorage.setItem('adminName', data.name);
  sessionStorage.setItem('adminRole', data.adminRole || 'owner');
  sessionStorage.setItem('adminPerms', JSON.stringify(data.perms || {}));
}

export const errMsg = (e) =>
  e.response?.data?.error || (e.response?.data?.errors || []).join('; ') || e.message || 'Something went wrong';

export async function downloadBlob(url, filename, tokenKey = 'adminToken') {
  const t = sessionStorage.getItem(tokenKey);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
