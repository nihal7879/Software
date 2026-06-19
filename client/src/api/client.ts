import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const aed = (n: number | string | null | undefined) =>
  `AED ${Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const hrs = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('en-AE', { maximumFractionDigits: 2 })} h`;
