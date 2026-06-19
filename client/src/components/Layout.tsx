import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

const NAV: Record<string, { to: string; label: string }[]> = {
  admin: [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/students', label: 'Students' },
    { to: '/admin/ledger', label: 'Hours Ledger' },
    { to: '/admin/finance', label: 'Finance' },
    { to: '/admin/teachers', label: 'Teachers' },
    { to: '/admin/pivots', label: 'Pivots' },
  ],
  faculty: [
    { to: '/faculty', label: 'Dashboard' },
    { to: '/faculty/students', label: 'My Students' },
    { to: '/faculty/lecture', label: 'Lecture Entry' },
  ],
  student: [
    { to: '/student', label: 'Dashboard' },
    { to: '/student/lectures', label: 'Lecture History' },
    { to: '/student/fees', label: 'Fees' },
    { to: '/student/profile', label: 'Profile' },
  ],
  parent: [
    { to: '/parent', label: 'Dashboard' },
    { to: '/parent/lectures', label: 'Lectures' },
    { to: '/parent/fees', label: 'Fees' },
  ],
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  if (!user) return null;
  const items = NAV[user.role] || [];

  return (
    <div className="min-h-screen flex">
      {/* Sidebar — deep navy brand rail */}
      <aside
        className="w-64 shrink-0 p-5 flex flex-col text-white/90"
        style={{ background: 'linear-gradient(180deg, #1e2a6e 0%, #161f54 100%)' }}
      >
        <div className="flex items-center gap-2 font-display font-extrabold text-xl mb-1 text-white">
          <span className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: 'var(--color-accent)' }}>🎓</span>
          Tuition<span className="text-[var(--color-accent)]">ERP</span>
        </div>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-6 ml-1">Institute Management</div>

        <nav className="flex flex-col gap-1 flex-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to.split('/').length <= 2}
              className={({ isActive }) =>
                `relative px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full" style={{ background: 'var(--color-accent)' }} />
                  )}
                  {it.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="rounded-xl bg-white/5 p-3 mb-3">
          <div className="text-[11px] uppercase tracking-wide text-white/40 capitalize">{user.role}</div>
          <div className="text-sm font-semibold truncate text-white">{user.displayName || user.email}</div>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold bg-white/10 hover:bg-white/20 transition" onClick={toggle}>
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold bg-white/10 hover:bg-white/20 transition" onClick={() => { logout(); nav('/login'); }}>
            Logout
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 p-8 max-w-[1440px]">{children}</main>
    </div>
  );
}
