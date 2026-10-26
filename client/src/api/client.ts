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
  (r) => {
    // Changing a password signs every device out — the server raises the
    // account's token version, which kills every token already handed out,
    // including the one this browser just used. A fresh one comes back in the
    // same reply and is stored here rather than at each of the three screens
    // that offer a password change, so none of them can forget and leave the
    // person staring at a sign-in page straight after succeeding.
    if (r.config.url?.includes('/auth/change-password') && r.data?.token) {
      localStorage.setItem('token', r.data.token);
    }
    return r;
  },
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

/**
 * What a lecture takes off the student's balance.
 *
 * A class can be taught and deliberately not charged — a make-up for one the
 * institute cancelled, a free session before an exam. `hours_consumed` still
 * holds its real length, because the student was there and the teacher taught
 * it; it is simply not billed. So every running total has to ask this rather
 * than read the column, or the months will not add up to the balance.
 *
 * The server's own figures already work this way (utils/hoursSummary.ts). This
 * is for the totals the screens add up themselves from a list of lectures.
 */
export const chargedHours = (l: { hours_consumed?: number | string | null; is_billable?: number | boolean | null } | null | undefined) =>
  l?.is_billable === 0 || l?.is_billable === false ? 0 : Number(l?.hours_consumed ?? 0);

// Format a date as dd-mm-yy. Accepts a 'YYYY-MM-DD' string or Date; returns the
// input unchanged if it can't be parsed.
export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1].slice(2)}`;
  return s;
};

// Student dropdown option: main line = "Form — Name", sub line = Grade · Parent
// (mobile). The parent + mobile disambiguate two same-name students in the same
// class/school. Used as { value, label, sub } for the themed Select.
// Who pays: the parent named by the student's stated relationship, falling back
// to whichever parent is on file. Used both for the dropdown's sub-line and to
// pre-fill the payer on a payment.
export const parentOf = (s: any): string =>
  (s?.relationship === 'Mother' ? s.mother_name
    : s?.relationship === 'Father' ? s.father_name
    : s?.relationship === 'Guardian' ? s.guardian_name
    : (s?.father_name || s?.mother_name || s?.guardian_name)) || '';

export const studentOption = (s: any) => {
  const parent = parentOf(s);
  const sub = [
    s.year_grade || null,
    parent ? `${parent}${s.parent_mobile ? ` · ${s.parent_mobile}` : ''}` : (s.parent_mobile || null),
  ].filter(Boolean).join(' · ');
  return { value: s.id, label: `${s.form_no} — ${s.full_name}`, sub: sub || undefined };
};

/**
 * The institute's clock — Dubai, whatever the device is set to.
 *
 * The server and the database both work in Dubai time, so the app has to as
 * well: a teacher whose laptop is on India time would otherwise log a late
 * evening class on tomorrow's date, and a phone left on another country's time
 * would show the wrong day on a statement. Every "now" and "today" in the app
 * comes from here rather than from `new Date()`.
 *
 * The returned Date carries Dubai's wall-clock reading in its local fields, so
 * getFullYear(), getHours() and friends all give the institute's clock.
 */
export function dubaiNow(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dubai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Midnight comes back as hour 24 in some browsers.
  return new Date(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
}

/** Today in Dubai as YYYY-MM-DD (toISOString would give the UTC day). */
export function todayIso() {
  const d = dubaiNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * What went wrong, in words the office can act on.
 *
 * The server already answers with a sentence written for a person — zod gives
 * the first failed rule ("Amount is required"), and the error handler passes
 * through anything thrown. Screens were discarding all of it and printing
 * "Could not save — please check the fields", which names no field and sent
 * people hunting through a form that was perfectly valid.
 *
 * Returns the sentence, plus `detail` when the cause is technical rather than
 * something the person mistyped — so a real fault can be reported accurately
 * instead of being mistaken for a bad entry.
 */
export function apiError(e: any, fallback = 'Something went wrong.'): { message: string; detail?: string } {
  const res = e?.response;

  // Never reached the server at all.
  if (!res) {
    return { message: 'Could not reach STEM Vision. Check your connection and try again.' };
  }

  const data = res.data || {};
  const said = String(data.error || '').trim();

  // zod names the fields it refused; listing them beats a general plea to
  // "check the fields".
  const fields = data.details?.fieldErrors as Record<string, string[]> | undefined;
  if (fields) {
    const named = Object.keys(fields).filter((k) => fields[k]?.length);
    if (named.length) {
      const pretty = named.map((k) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
      return { message: `${said || 'Please check these fields'} — ${pretty.join(', ')}` };
    }
  }

  // A database or server fault is not the person's mistake, and telling them to
  // check the fields sends them looking for a problem that is not there.
  const technical = /unknown column|ER_[A-Z_]+|SQL syntax|ECONNREFUSED|ETIMEDOUT|cannot read/i.test(said);
  if (technical || res.status >= 500) {
    return {
      message: 'The server could not save this. Nothing has been changed — please report this to support.',
      detail: said || `HTTP ${res.status}`,
    };
  }

  if (res.status === 401) return { message: 'Your session has ended. Please sign in again.' };
  if (res.status === 403) return { message: said || 'You do not have permission to do that.' };
  if (res.status === 404) return { message: said || 'That record no longer exists — it may have been removed.' };

  return { message: said || fallback };
}
