import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

// Per-request context so audit() can pick up IP / GPS / device without every call
// site having to thread the request object through.
export type ReqCtx = { ip: string | null; lat: number | null; lng: number | null; device: string | null };

const als = new AsyncLocalStorage<ReqCtx>();

export const getReqCtx = (): ReqCtx | undefined => als.getStore();

const clean = (ip: string) => ip.trim().replace(/^::ffff:/i, '');

// Loopback / private-range addresses — not useful as the "internet" IP.
function isLocalOrPrivate(ip: string): boolean {
  if (!ip) return true;
  return /^(127\.|::1$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(ip);
}

// Robust client IP — proxy headers (Vercel/Cloudflare/nginx) first, then the
// socket. If that's only a loopback/LAN address (e.g. local dev), fall back to
// the public IP the client looked up and sent as X-Public-Ip. Returns IPv4 or
// IPv6, whichever is available.
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const derived = clean(
    (h['cf-connecting-ip'] as string) ||
    (h['true-client-ip'] as string) ||
    (h['x-real-ip'] as string) ||
    ((h['x-forwarded-for'] as string) || '').split(',')[0] ||
    req.ip ||
    req.socket?.remoteAddress ||
    ''
  );
  const clientPublic = clean((h['x-public-ip'] as string) || '');
  if (isLocalOrPrivate(derived) && clientPublic) return clientPublic;
  return derived || clientPublic || null;
}

// Parse a User-Agent into a friendly "Browser · OS · DeviceType" string.
export function deviceInfo(req: Request): string | null {
  const ua = req.headers['user-agent'] as string;
  if (!ua) return null;

  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Version\/.*Safari/.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let device = 'Desktop';
  if (/iPad|Tablet/.test(ua)) device = 'Tablet';
  else if (/Mobi|Android|iPhone|iPod/.test(ua)) device = 'Mobile';

  return `${browser} · ${os} · ${device}`;
}

const num = (v: any): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Runs each request inside an ALS context carrying IP + device + (client) GPS.
export function requestContext(req: Request, _res: Response, next: NextFunction) {
  const ctx: ReqCtx = {
    ip: clientIp(req),
    lat: num(req.headers['x-gps-lat']),
    lng: num(req.headers['x-gps-lng']),
    device: deviceInfo(req),
  };
  als.run(ctx, () => next());
}
