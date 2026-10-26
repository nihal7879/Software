import { ReactNode, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Wallet, GraduationCap, BarChart3,
  BookOpen, User, LogOut, Moon, Sun, ChevronLeft, Menu, Settings, Lock, QrCode, KeyRound, Plus, BellRing,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { getLastSeenRegistration } from '../lib/registrationsSeen';
import { useStudentAccess } from './StudentLock';
import { useTheme } from '../theme/ThemeContext';
import { roleLabel } from './MonthSelector';
import { Toaster } from './Toast';
import { NotificationBell } from './NotificationBell';
import { Logo } from './Logo';

// `short` is the label under the icon in the phone tab bar, where there is room
// for one word. `primary` is the role's main action, raised in the middle.
// `also` is a path prefix for pages that belong to the tab without being it —
// one student's details sit under My Students, though the path is /student/.
type Item = { to: string; label: string; icon: any; short?: string; primary?: boolean; also?: string };

const NAV: Record<string, Item[]> = {
  // The admin runs students, hours, fees and teachers. Pivots report on money,
  // so they belong to the super admin below.
  admin: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/students', label: 'Students', icon: Users },
    { to: '/admin/hours', label: 'Student Hours', icon: Clock },
    { to: '/admin/finance', label: 'Finance', icon: Wallet },
    { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
    { to: '/admin/attendance', label: 'Attendance', icon: QrCode },
    { to: '/admin/notifications', label: 'Notifications', icon: BellRing, short: 'Alerts' },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ],
  superadmin: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/students', label: 'Students', icon: Users },
    { to: '/admin/hours', label: 'Student Hours', icon: Clock },
    { to: '/admin/finance', label: 'Finance', icon: Wallet },
    { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
    { to: '/admin/pivots', label: 'Pivots', icon: BarChart3 },
    { to: '/admin/attendance', label: 'Attendance', icon: QrCode },
    { to: '/admin/approvals', label: 'Approvals', icon: KeyRound },
    { to: '/admin/notifications', label: 'Notifications', icon: BellRing, short: 'Alerts' },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ],
  faculty: [
    { to: '/faculty', label: 'Dashboard', icon: LayoutDashboard, short: 'Home' },
    { to: '/faculty/students', label: 'My Students', icon: Users, short: 'Students', also: '/faculty/student/' },
    { to: '/faculty/lecture', label: 'Lecture Entry', icon: BookOpen, short: 'Lecture', primary: true },
    // Scans from the desk QR, waiting to be confirmed into lectures.
    { to: '/faculty/attendance', label: 'Attendance', icon: QrCode },
    { to: '/faculty/settings', label: 'Settings', icon: Settings },
  ],
  student: [
    { to: '/student', label: 'Dashboard', icon: LayoutDashboard, short: 'Home' },
    { to: '/student/checkin', label: 'Check in', icon: QrCode, primary: true },
    // Lecture calendar + hours summary now live on the dashboard.
    // Change-password + personal info now live under Profile (Settings removed).
    { to: '/student/profile', label: 'Profile', icon: User },
  ],
  parent: [
    { to: '/parent', label: 'Dashboard', icon: LayoutDashboard, short: 'Home' },
    // Lecture calendar + hours summary now live on the dashboard.
    { to: '/parent/hours', label: 'Fees Info', icon: Wallet, short: 'Fees' },
    { to: '/parent/profile', label: 'Profile', icon: User },
  ],
};

// These roles are mostly used on a phone, so below lg they get an app shell —
// top bar and bottom tabs — instead of the office's sidebar drawer.
const APP_ROLES = ['faculty', 'student', 'parent'];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);        // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop collapse
  const [sheet, setSheet] = useState(false);       // phone account sheet
  const { pathname } = useLocation();
  // New student registrations, as a badge on Students — only ones this admin has
  // not seen yet, so it clears once they open Registrations and comes back only
  // for a fresh one. Above the early return below, as hooks must run every render.
  const pendingRegs = useQuery({
    queryKey: ['registrations-count', 'unseen'],
    queryFn: () =>
      api.get('/registrations/count', { params: { since: getLastSeenRegistration(user?.id) } })
        .then((r) => Number(r.data.unseen) || 0),
    enabled: user?.role === 'admin' || user?.role === 'superadmin',
    refetchInterval: 60_000,
  });
  const pendingApprovals = useQuery({
    queryKey: ['approvals-count'],
    queryFn: () => api.get('/approvals/count').then((r) => Number(r.data.count) || 0),
    enabled: user?.role === 'superadmin',
    refetchInterval: 60_000,
  });
  // Registrations has no menu entry of its own — they are reached from the
  // dashboard — so the waiting count rides on Students, as it did before.
  const badgeFor = (to: string) =>
    to === '/admin/students' ? pendingRegs.data || 0
    : to === '/admin/approvals' ? pendingApprovals.data || 0
    : 0;
  const badgeTitle = (to: string, n: number) =>
    to === '/admin/approvals'
      ? `${n} waiting for approval`
      : `${n} new registration${n === 1 ? '' : 's'}`;
  // Students see a lock on Dashboard while an admin has student dashboards locked.
  const studentAccess = useStudentAccess(user?.role === 'student');
  const lockedFor = (to: string) => user?.role === 'student' && to === '/student' && studentAccess.data !== false;
  if (!user) return null;
  const items = NAV[user.role] || [];
  const home = items[0]?.to || '/';
  const goHome = () => { setOpen(false); setCollapsed(false); nav(home); };
  const app = APP_ROLES.includes(user.role);
  // The tab this page belongs to: the longest menu path it starts with. A page
  // with no tab of its own (one student's detail) gets a back arrow instead.
  const belongs = (it: Item) => !!it.also && pathname.startsWith(it.also);
  const current = items.find(belongs) || [...items].sort((a, b) => b.to.length - a.to.length)
    .find((it) => pathname === it.to || pathname.startsWith(it.to + '/'));
  const isTab = items.some((it) => it.to === pathname);
  const name = user.displayName || user.email;
  const initials = String(name).split(/[\s@._]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const signOut = () => { setSheet(false); logout(); nav('/login'); };

  const Sidebar = ({ mini }: { mini: boolean }) => (
    <div
      className="h-full overflow-y-auto flex flex-col border-r"
      style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
    >
      {/* Brand — click to open dashboard (and expand if collapsed) */}
      <div className={`flex items-center gap-2.5 px-4 py-4 shrink-0 ${mini ? 'justify-center' : ''}`}>
        {/* The wordmark is five times as wide as it is tall, so it cannot go in
            a collapsed 80px rail. Open, the whole mark; collapsed, the brain
            from inside the O — the one piece of it that is square. */}
        {mini ? (
          <button onClick={goHome} title="Go to dashboard" aria-label="Go to dashboard"
            className="grid place-items-center w-9 h-9 shrink-0 hover:opacity-80 transition">
            <img src="/stemvision-mark.png" alt="" className="w-8 h-8 object-contain" draggable={false} />
          </button>
        ) : (
          <button onClick={goHome} className="flex-1 min-w-0 text-left" title="Go to dashboard">
            <Logo height={30} />
          </button>
        )}
        {!mini && (
          <button className={`hidden ${app ? 'lg:grid' : 'md:grid'} place-items-center w-7 h-7 rounded-lg hover:bg-[var(--color-card-alt)]`} onClick={() => setCollapsed(true)} title="Collapse">
            <ChevronLeft size={18} className="muted" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 shrink-0">
        {items.map((it) => {
          const Icon = it.icon;
          const badge = badgeFor(it.to);
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
              <span className="relative shrink-0">
                <Icon size={19} />
                {/* Collapsed menu: a dot on the icon, since there is no room for the number. */}
                {mini && badge > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
                )}
              </span>
              {!mini && <span className="truncate">{it.label}</span>}
              {!mini && lockedFor(it.to) && <Lock size={14} className="ml-auto muted shrink-0" aria-label="Locked" />}
              {!mini && badge > 0 && (
                <span
                  className="ml-auto inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 text-[11px] font-bold leading-none text-white rounded-full tabular-nums"
                  style={{ background: 'var(--color-primary)' }}
                  title={badgeTitle(it.to, badge)}
                >
                  {badge}
                </span>
              )}
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
          {/* Everything this person has been sent. There is no top bar on
              desktop, so it lives with the other global actions. */}
          <NotificationBell label />
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
      <aside className={`hidden ${app ? 'lg:block' : 'md:block'} shrink-0 sticky top-0 h-screen overflow-hidden transition-[width] duration-200 ${collapsed ? 'w-20' : 'w-64'}`}>
        <Sidebar mini={collapsed} />
      </aside>

      {/* Mobile drawer — slides in from left (office roles only) */}
      {open && !app && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 animate-fade-in" />
          <div className="absolute left-0 top-0 h-full w-64 animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <Sidebar mini={false} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {app ? (
          /* Phone / tablet app bar */
          <header className="lg:hidden sticky top-0 z-30 glass-bar border-b pt-safe" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3 px-4 h-14">
              {isTab ? (
                <button onClick={goHome} aria-label="Home"
                  className="tap grid place-items-center w-9 h-9 shrink-0">
                  <img src="/stemvision-mark.png" alt="" className="w-8 h-8 object-contain" draggable={false} />
                </button>
              ) : (
                <button onClick={() => nav(-1)} aria-label="Back"
                  className="tap grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: 'var(--color-card-alt)' }}>
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                {pathname === home ? (
                  <Logo height={22} />
                ) : (
                  <div className="font-display font-bold text-[1.05rem] leading-tight truncate">
                    {current?.label || 'STEM Vision'}
                  </div>
                )}
                <div className="text-[11px] muted truncate leading-tight">{roleLabel(user.role)}</div>
              </div>
              {/* Beside the account button, where a phone expects it. */}
              <NotificationBell />
              <button onClick={() => setSheet(true)} aria-label="Account"
                className="tap grid place-items-center w-9 h-9 rounded-full text-xs font-bold shrink-0"
                style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>
                {initials || <User size={16} />}
              </button>
            </div>
          </header>
        ) : (
          /* Mobile top bar */
          <header className="md:hidden flex items-center justify-between p-4 border-b sticky top-0 z-30" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
            <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
            <Logo height={26} />
            <span className="flex items-center gap-1">
              <NotificationBell />
              <button onClick={toggle}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
            </span>
          </header>
        )}

        {/* The extra bottom padding keeps the last row clear of the tab bar. */}
        <main className={`flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full ${app ? 'pb-28 sm:pb-28 lg:pb-8' : ''}`}>{children}</main>
      </div>

      {app && (
        /* Bottom tab bar. The role's main action sits raised in the middle. */
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass-bar border-t pb-safe"
          style={{ borderColor: 'var(--color-border)' }} aria-label="Main">
          <div className="flex items-end justify-around max-w-xl mx-auto px-2 h-16">
            {items.map((it) => {
              const Icon = it.icon;
              const label = it.short || it.label;
              if (it.primary) {
                return (
                  <NavLink key={it.to} to={it.to} className="tap flex flex-col items-center self-start -mt-5 w-16 shrink-0" aria-label={it.label}>
                    {({ isActive }) => (
                      <>
                        <span className="grid place-items-center w-14 h-14 rounded-2xl text-white"
                          style={{
                            background: 'linear-gradient(135deg,#fb923c,#ea580c)',
                            boxShadow: '0 0 0 4px var(--color-bg), 0 10px 22px -8px rgba(234,88,12,0.6)',
                          }}>
                          {user.role === 'faculty' ? <Plus size={26} strokeWidth={2.4} /> : <Icon size={24} />}
                        </span>
                        <span className="text-[11px] font-semibold mt-1" style={{ color: isActive ? 'var(--color-primary)' : 'var(--color-muted)' }}>{label}</span>
                      </>
                    )}
                  </NavLink>
                );
              }
              return (
                <NavLink key={it.to} to={it.to} end={it.to.split('/').length <= 2}
                  className="tap flex flex-col items-center justify-center flex-1 min-w-0 h-full gap-1">
                  {({ isActive: exact }) => { const isActive = exact || belongs(it); return (
                    <>
                      <span className="grid place-items-center w-12 h-7 rounded-full transition-colors"
                        style={{ background: isActive ? 'var(--color-accent-soft)' : 'transparent', color: isActive ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                        <Icon size={20} strokeWidth={isActive ? 2.3 : 1.9} />
                      </span>
                      <span className="text-[11px] font-semibold truncate max-w-full flex items-center gap-0.5"
                        style={{ color: isActive ? 'var(--color-text)' : 'var(--color-muted)' }}>
                        {label}
                        {lockedFor(it.to) && <Lock size={10} aria-label="Locked" />}
                      </span>
                    </>
                  ); }}
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}

      {sheet && (
        /* Account sheet: who is signed in, theme, sign out. */
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-black/40 animate-fade-in" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl px-5 pt-3 animate-sheet-up"
            style={{ background: 'var(--color-card)', paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Account">
            <div className="mx-auto mb-5 w-10 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }} />
            <div className="flex items-center gap-3 mb-5">
              <span className="grid place-items-center w-12 h-12 rounded-full text-sm font-bold shrink-0"
                style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>{initials || <User size={18} />}</span>
              <div className="min-w-0">
                <div className="font-display font-bold truncate">{name}</div>
                <div className="text-xs muted">{roleLabel(user.role)}</div>
              </div>
            </div>
            <div className="space-y-2">
              <button className="tap w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-medium" style={{ background: 'var(--color-card-alt)' }} onClick={toggle}>
                {dark ? <Sun size={18} /> : <Moon size={18} />}
                <span className="flex-1">{dark ? 'Light theme' : 'Dark theme'}</span>
              </button>
              <button className="tap w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-medium text-red-600 dark:text-red-400" style={{ background: 'var(--color-card-alt)' }} onClick={signOut}>
                <LogOut size={18} /> <span className="flex-1">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}



























