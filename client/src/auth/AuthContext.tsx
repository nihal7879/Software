import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api, ensureLocation } from '../api/client';
import { autoAskPush, resyncPush } from '../lib/push';

/**
 * How long a sign-in survives with nobody touching it.
 *
 * Twenty minutes for anyone who can see money or another family's details — the
 * office machine is shared, and that is what the rule is for.
 *
 * A student is a different case. The app is, to most of them, the thing that
 * scans the QR on a teacher's desk; being asked for a password at the classroom
 * door, on a phone, is the difference between the attendance being recorded and
 * not. They see their own attendance and nothing else, so fifteen days of not
 * opening it is the limit rather than twenty minutes. The server issues them a
 * longer token to match (config.jwtExpiresInStudent), and a password change
 * still throws every device out at once.
 */
const IDLE_LIMIT_MS = 20 * 60 * 1000;
const IDLE_LIMIT_STUDENT_MS = 15 * 24 * 60 * 60 * 1000;
const idleLimitFor = (role?: Role) => (role === 'student' ? IDLE_LIMIT_STUDENT_MS : IDLE_LIMIT_MS);
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
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    // If the browser was closed (or the tab left idle) for longer than the idle
    // limit, treat it as an expired session — don't silently log the user back in.
    const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (last && Date.now() - last > storedIdleLimit()) {
      localStorage.removeItem('token');
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      setLoading(false);
      return;
    }

    api
      .get('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    ensureLocation(); // fire-and-forget: starts the GPS fix, never blocks login. IP is server-side.
    const r = await api.post('/auth/login', { email, password });
    if (r.data.select) return { signedIn: false, ticket: r.data.ticket, options: r.data.options };
    localStorage.setItem('token', r.data.token);
    localStorage.setItem(IDLE_LIMIT_KEY, String(idleLimitFor(r.data.user?.role)));
    setUser(r.data.user);
    resyncPush();
    return { signedIn: true };
  };

  const selectAccount = async (ticket: string, index: number) => {
    const r = await api.post('/auth/login/select', { ticket, index });
    localStorage.setItem('token', r.data.token);
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

  const register = async (payload: any) => {
    ensureLocation();
    const r = await api.post('/auth/register', payload);
    localStorage.setItem('token', r.data.token);
    localStorage.setItem(IDLE_LIMIT_KEY, String(idleLimitFor(r.data.user?.role)));
    setUser(r.data.user);
  };

  const logout = async () => {
    ensureLocation();
    try { await api.post('/auth/logout'); } catch { /* token may be expired — ignore */ }
    localStorage.removeItem('token');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem(IDLE_LIMIT_KEY);
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

  // Auto sign-out after 20 minutes of inactivity (only while logged in).
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    const signOutIdle = () => {
      localStorage.removeItem('token');
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      setUser(null);
      location.href = '/login?reason=timeout';
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
