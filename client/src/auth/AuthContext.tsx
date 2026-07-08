import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api, ensureLocation } from '../api/client';

// Auto-logout after this many minutes of no user interaction.
const IDLE_LIMIT_MS = 20 * 60 * 1000;
// localStorage key holding the timestamp (ms) of the last user activity.
// Persisted so idle time is honoured even across full browser close/reopen.
const LAST_ACTIVITY_KEY = 'lastActivity';

export type Role = 'student' | 'parent' | 'faculty' | 'admin';
export interface AuthUser {
  id: number;
  role: Role;
  email: string;
  displayName?: string;
  studentId?: number | null;
  teacherId?: number | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: any) => Promise<void>;
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
    if (last && Date.now() - last > IDLE_LIMIT_MS) {
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

  const login = async (email: string, password: string) => {
    ensureLocation(); // fire-and-forget: starts the GPS fix, never blocks login. IP is server-side.
    const r = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', r.data.token);
    setUser(r.data.user);
  };

  const register = async (payload: any) => {
    ensureLocation();
    const r = await api.post('/auth/register', payload);
    localStorage.setItem('token', r.data.token);
    setUser(r.data.user);
  };

  const logout = async () => {
    ensureLocation();
    try { await api.post('/auth/logout'); } catch { /* token may be expired — ignore */ }
    localStorage.removeItem('token');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    setUser(null);
    location.href = '/login';
  };

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
    const reset = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(signOutIdle, IDLE_LIMIT_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset(); // start the countdown
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user]);

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}
