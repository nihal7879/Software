import { ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Wallet, GraduationCap, BarChart3,
  BookOpen, CalendarDays, User, LogOut, Moon, Sun, ChevronLeft, Menu, Settings,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { roleLabel } from './MonthSelector';
import { Toaster } from './Toast';

type Item = { to: string; label: string; icon: any };

const NAV: Record<string, Item[]> = {
  admin: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/students', label: 'Students', icon: Users },
    { to: '/admin/hours', label: 'Student Hours', icon: Clock },
    { to: '/admin/finance', label: 'Finance', icon: Wallet },
    { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
    { to: '/admin/pivots', label: 'Pivots', icon: BarChart3 },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ],
  faculty: [
    { to: '/faculty', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/faculty/students', label: 'My Students', icon: Users },
    { to: '/faculty/lecture', label: 'Lecture Entry', icon: BookOpen },
    { to: '/faculty/settings', label: 'Settings', icon: Settings },
  ],
  student: [
    { to: '/student', label: 'Dashboard', icon: LayoutDashboard },
    // Lecture calendar + hours summary now live on the dashboard.
    // Change-password + personal info now live under Profile (Settings removed).
    { to: '/student/profile', label: 'Profile', icon: User },
  ],
  parent: [
    { to: '/parent', label: 'Dashboard', icon: LayoutDashboard },
    // Lecture calendar + hours summary now live on the dashboard.
    { to: '/parent/hours', label: 'Fees Info', icon: Wallet },
    { to: '/parent/profile', label: 'Profile', icon: User },
  ],
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);        // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop collapse
  if (!user) return null;
  const items = NAV[user.role] || [];
  const home = items[0]?.to || '/';
  const goHome = () => { setOpen(false); setCollapsed(false); nav(home); };

  const Sidebar = ({ mini }: { mini: boolean }) => (
    <div
      className="h-full overflow-y-auto flex flex-col border-r"
      style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
    >
      {/* Brand — click to open dashboard (and expand if collapsed) */}
      <div className={`flex items-center gap-2.5 px-4 py-4 shrink-0 ${mini ? 'justify-center' : ''}`}>
        <button onClick={goHome} title="Go to dashboard"
          className="grid place-items-center w-9 h-9 rounded-lg text-white shrink-0 hover:opacity-90 transition"
          style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}>
          <GraduationCap size={20} />
        </button>
        {!mini && (
          <button onClick={goHome} className="flex-1 min-w-0 text-left" title="Go to dashboard">
            <div className="font-display font-bold leading-tight truncate">Class<span style={{ color: 'var(--color-primary)' }}>room</span></div>
            <div className="text-[10px] uppercase tracking-[0.15em] muted truncate">Institute Management</div>
          </button>
        )}
        {!mini && (
          <button className="hidden md:grid place-items-center w-7 h-7 rounded-lg hover:bg-[var(--color-card-alt)]" onClick={() => setCollapsed(true)} title="Collapse">
            <ChevronLeft size={18} className="muted" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 shrink-0">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to.split('/').length <= 2}
              onClick={() => setOpen(false)}
              title={mini ? it.label : ''}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${mini ? 'justify-center' : ''} ${
                  isActive ? '' : 'muted hover:bg-[var(--color-card-alt)]'
                }`
              }
              style={({ isActive }: any) => (isActive ? { background: 'var(--color-card-alt)', color: 'var(--color-primary)' } : {})}
            >
              <Icon size={19} className="shrink-0" />
              {!mini && <span className="truncate">{it.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`mt-auto p-3 shrink-0 ${mini ? 'px-2' : ''}`}>
        {!mini && (
          <div className="rounded-xl p-3 mb-2" style={{ background: 'var(--color-card-alt)' }}>
            <div className="text-[10px] uppercase tracking-wide muted">{roleLabel(user.role)}</div>
            <div className="text-sm font-semibold truncate">{user.displayName || user.email}</div>
          </div>
        )}
        <div className={`flex gap-2 ${mini ? 'flex-col' : ''}`}>
          <button className="btn-ghost flex-1 !px-2 grid place-items-center" onClick={toggle} title="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="btn-ghost flex-1 !px-2 grid place-items-center" onClick={() => { logout(); nav('/login'); }} title="Logout">
            <LogOut size={16} />
          </button>
          {mini && (
            <button className="btn-ghost flex-1 !px-2 grid place-items-center" onClick={() => setCollapsed(false)} title="Expand">
              <Menu size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className={`hidden md:block shrink-0 sticky top-0 h-screen overflow-hidden transition-[width] duration-200 ${collapsed ? 'w-20' : 'w-64'}`}>
        <Sidebar mini={collapsed} />
      </aside>

      {/* Mobile drawer — slides in from left */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 animate-fade-in" />
          <div className="absolute left-0 top-0 h-full w-64 animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <Sidebar mini={false} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between p-4 border-b sticky top-0 z-30" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
          <span className="font-display font-bold flex items-center gap-1.5" style={{ color: 'var(--color-primary)' }}>
            <GraduationCap size={18} /> STEM Vision
          </span>
          <button onClick={toggle}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}





