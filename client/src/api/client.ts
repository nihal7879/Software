import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

// Best-effort browser GPS, cached and attached to every request as headers so
// the server can record it in the audit trail. Silently skipped if denied or
// if the page isn't a secure context (geolocation needs HTTPS or localhost).
let coords: { lat: number; lng: number } | null = null;

// Resolves once we have (or fail to get) a fix. Safe to call on a user gesture
// such as the login/register submit — that's the most reliable way to prompt.
export function ensureLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(coords);
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      console.warn('Geolocation needs HTTPS or localhost — GPS will not be captured on this origin.');
      return resolve(coords);
    }
    navigator.geolocation.getCurrentPosition(
      (p) => { coords = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(coords); },
      () => resolve(coords),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  });
}
export const captureLocation = ensureLocation;
ensureLocation();

// Public (internet) IP — the server only sees a loopback/LAN address in dev or
// behind some proxies, so we look up the real one once and send it as a header.
let publicIp: string | null = null;
async function fetchPublicIp() {
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const j = await r.json();
    if (j?.ip) publicIp = String(j.ip);
  } catch { /* offline or blocked — server falls back to the connection IP */ }
}
fetchPublicIp();

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  if (coords) {
    cfg.headers['X-Gps-Lat'] = String(coords.lat);
    cfg.headers['X-Gps-Lng'] = String(coords.lng);
  }
  if (publicIp) cfg.headers['X-Public-Ip'] = publicIp;
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

export const rs = (n: number | string | null | undefined) =>
  `AED ${Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Plain number (no currency prefix) — use when the column/label already says AED.
export const num = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const hrs = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('en-AE', { maximumFractionDigits: 2 })} h`;

// Student dropdown option: main line = "Form — Name", sub line = Grade · Parent
// (mobile). The parent + mobile disambiguate two same-name students in the same
// class/school. Used as { value, label, sub } for the themed Select.
export const studentOption = (s: any) => {
  const parent = s.relationship === 'Mother' ? s.mother_name
    : s.relationship === 'Father' ? s.father_name
    : (s.father_name || s.mother_name);
  const sub = [
    s.year_grade || null,
    parent ? `${parent}${s.parent_mobile ? ` · ${s.parent_mobile}` : ''}` : (s.parent_mobile || null),
  ].filter(Boolean).join(' · ');
  return { value: s.id, label: `${s.form_no} — ${s.full_name}`, sub: sub || undefined };
};
