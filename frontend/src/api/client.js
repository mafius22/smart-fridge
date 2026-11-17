import axios from 'axios';

// Domyslnie /api przez proxy Vite (ta sama domena = ciasteczka sesji bez CORS)
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
});

function getCookie(name) {
  const row = document.cookie.split('; ').find((r) => r.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : null;
}

// Ochrona CSRF: token z ciasteczka (czytelnego dla JS) w naglowku kazdej zmiany
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const isRefresh = config.url?.includes('/auth/refresh');
    const token = getCookie(isRefresh ? 'csrf_refresh_token' : 'csrf_access_token');
    if (token) config.headers['X-CSRF-TOKEN'] = token;
  }
  return config;
});

const NO_RETRY = ['/auth/login', '/auth/refresh', '/auth/logout'];
let refreshPromise = null;

// Wygasly token dostepu (15 min): jedno odswiezenie dla wszystkich rownoleglych zapytan i ponowienie
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const skip = !response || response.status !== 401 || !config || config._retry
      || NO_RETRY.some((url) => config.url?.includes(url));
    if (skip) return Promise.reject(error);

    config._retry = true;
    try {
      if (!refreshPromise) {
        refreshPromise = api.post('/auth/refresh').finally(() => { refreshPromise = null; });
      }
      await refreshPromise;
      return api(config);
    } catch {
      window.dispatchEvent(new Event('auth:expired'));
      return Promise.reject(error);
    }
  },
);

export function apiError(error, fallback = 'Wystąpił błąd') {
  return error?.response?.data?.error || error?.message || fallback;
}

export default api;
