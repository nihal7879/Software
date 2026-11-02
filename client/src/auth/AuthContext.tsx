import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api, ensureLocation, LEGACY_TOKEN_KEY, SIGNED_IN_KEY } from '../api/client';
import { autoAskPush, resyncPush } from '../lib/push';

/**
 * How long a sign-in survives with nobody touching it: fifteen days, for every
 * role. The server issues a token of the same length (config.sessionLength),
 * and a password change still throws every device out at once.
 *
 * Students had this first — being asked for a password at the classroom door
 * is the difference between attendance being recorded and not. Everyone else
 * was signed out after twenty idle minutes, because the office machine is
 * shared and an admin sees every family's fees. The institute asked (Nov 2026)
 * for teachers, parents and both admins to stay signed in for fifteen days too.
 * On a shared computer, signing out is now the person's own job.
 *
 * Kept as a function of the role so a role can be given its own limit again
 * without touching the callers.
 */
const IDLE_LIMIT_MS = 15 * 24 * 60 * 60 * 1000;
const idleLimitFor = (_role?: Role) => IDLE_LIMIT_MS;
// The limit that applied to whoever is signed in, kept beside the token: on
// opening the app the role is not known yet (that is what /auth/me is for) and
// the decision has to be made before the token is used.
const IDLE_LIMIT_KEY = 'idleLimitMs';
const storedIdleLimit = () => Number(localStorage.getItem(IDLE_LIMIT_KEY)) || IDLE_LIMIT_MS;
// localStorage key holding the timestamp (ms) of the last user activity.
// Persisted so idle time is honoured even across full browser close/reopen.
const LAST_ACTIVITY_KEY = 'lastActivity';

export type Role = 'student' | 'parent' | 'faculty' | 'admin' | 'superadmin';
export interface AuthUser {
  id: number;
  role: Role;
  email: string;
  displayName?: string;
  studentId?: number | null;
  teacherId?: number | null;
  /**
   * The password came out of a reset, so it is one the system made up. Until a
   * password of their own is set, App.tsx shows nothing but the change-password
   * screen — see pages/ChangePasswordRequired.tsx.
   */
  mustChangePassword?: boolean;
}

// When an email opens more than one account (siblings sharing it, or a parent
// with more than one child), sign-in pauses and offers these to choose from.
export type AccountChoice = { index: number; role: Role; label: string; sub: string };
export type LoginResult = { signedIn: true } | { signedIn: false; ticket: string; options: AccountChoice[] };

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Finish a sign-in that returned a choice. */
  selectAccount: (ticket: string, index: number) => Promise<void>;
  register: (payload: any) => Promise<void>;
  /** Re-read the account from the server — after changing a password, say. */
  refresh: () => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The session itself is an httpOnly cookie this code cannot see. Whether to
    // ask the server about it: someone signed in on this browser, or it still
    // holds a token from before the cookie (sent once, then swapped for one).
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacy && !localStorage.getItem(SIGNED_IN_KEY)) { setLoading(false); return; }

    // If the browser was closed (or the tab left idle) for longer than the idle
    // limit, treat it as an expired session — don't silently log the user back
    // in. Signed out on the server too, so the cookie is cancelled, not kept.
    const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (last && Date.now() - last > storedIdleLimit()) {
      api.post('/auth/logout', {}, { quiet401: true } as any).catch(() => {});
      clearLocal();
      setLoading(false);
      return;
    }

    api
      .get('/auth/me', { quiet401: true } as any)
      .then((r) => {
        setUser(r.data);
        // The server has set the cookie now; the old copy goes.
        localStorage.removeItem(LEGACY_TOKEN_KEY);
        localStorage.setItem(SIGNED_IN_KEY, '1');
      })
      .catch(() => clearLocal())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    ensureLocation(); // fire-and-forget: starts the GPS fix, never blocks login. IP is server-side.
    const r = await api.post('/auth/login', { email, password });
    if (r.data.select) return { signedIn: false, ticket: r.data.ticket, options: r.data.options };
    // The token arrived as an httpOnly cookie; only the fact of signing in is kept.
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.setItem(SIGNED_IN_KEY, '1');
    localStorage.setItem(IDLE_LIMIT_KEY, String(idleLimitFor(r.data.user?.role)));
    setUser(r.data.user);
    resyncPush();
    return { signedIn: true };
  };

  const selectAccount = async (ticket: string, index: number) => {
    const r = await api.post('/auth/login/select', { ticket, index });
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.setItem(SIGNED_IN_KEY, '1');
    localStorage.setItem(IDLE_LIMIT_KEY, String(idleLimitFor(r.data.user?.role)));
    setUser(r.data.user);
    resyncPush();
  };

  /**
   * Re-read the account. Used after a password change, where the server has
   * cleared must_change_password and the app has to stop showing that screen.
   */
  const refresh = async () => {
    const r = await api.get('/auth/me');
    setUser(r.data);
  };

  // Registering no longer signs anyone in — every role waits for approval — so
  // this only sends the request; the pages show "waiting for approval".
  const register = async (payload: any) => {
    ensureLocation();
    await api.post('/auth/register', payload);
  };

  // What this browser keeps about a sign-in, none of it the token itself.
  const clearLocal = () => {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(SIGNED_IN_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem(IDLE_LIMIT_KEY);
  };

  // The server cancels this session's token and clears the cookie; the rest
  // of the person's devices stay signed in.
  const logout = async () => {
    ensureLocation();
    try { await api.post('/auth/logout', {}, { quiet401: true } as any); } catch { /* already signed out — fine */ }
    clearLocal();
    setUser(null);
    location.href = '/login';
  };

  /**
   * Just after signing in, offer notifications without being asked — the same
   * way the location box already appears on this app.
   *
   * Here rather than on each dashboard so it covers every way of arriving:
   * signing in, choosing a child, and reopening the app on a session that was
   * still alive. lib/push.ts does it once per account and only on the browsers
   * that permit a box nobody pressed for; everywhere else the dashboard strip
   * is what asks.
   *
   * Delayed a little so the dashboard has drawn first. A permission box over a
   * half-loaded screen is the kind people dismiss without reading, and a
   * dismissal is not a thing we get back.
   */
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => autoAskPush(user.id), 1500);
    return () => clearTimeout(t);
  }, [user?.id]);

  // Auto sign-out after fifteen days of inactivity (only while logged in).
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    const signOutIdle = () => {
      // Through the server, so the cookie is cleared and the token cancelled —
      // clearing this browser's notes alone would leave the cookie signed in.
      api.post('/auth/logout', {}, { quiet401: true } as any).catch(() => {}).finally(() => {
        clearLocal();
        setUser(null);
        location.href = '/login?reason=timeout';
      });
    };
    const limit = idleLimitFor(user.role);
    localStorage.setItem(IDLE_LIMIT_KEY, String(limit));
    const reset = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      // setTimeout tops out around 24 days; fifteen is inside that, and the
      // check on opening the app is what really enforces it anyway.
      idleTimer.current = setTimeout(signOutIdle, limit);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset(); // start the countdown
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user]);

  return <Ctx.Provider value={{ user, loading, login, selectAccount, register, refresh, logout }}>{children}</Ctx.Provider>;
}
