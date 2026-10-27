import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { User, Mail, Phone, Shield, BookOpen, Lock, LockOpen, Pencil } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { passwordProblem } from '../../lib/credentials';
import { MultiSelect } from '../../components/MultiSelect';
import { useStudentAccess } from '../../components/StudentLock';
import { toast } from '../../components/Toast';
import { NotificationsCard } from '../../components/NotificationsCard';

// A single read-only field (icon + label + value / "Not set").
function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    // Below lg each detail is a soft tile with its icon in a badge, and long
    // values (an email, three subjects) wrap instead of being cut off.
    <div className="flex items-start gap-3 py-3 max-lg:items-center max-lg:rounded-2xl max-lg:px-3.5 max-lg:bg-[var(--color-card-alt)]">
      <span className="mt-0.5 text-[var(--color-primary)] opacity-80 max-lg:mt-0 max-lg:opacity-100 max-lg:grid max-lg:place-items-center max-lg:w-10 max-lg:h-10 max-lg:rounded-xl max-lg:shrink-0 max-lg:bg-[var(--color-card)]">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs muted">{label}</div>
        {value ? <div className="font-semibold truncate max-lg:whitespace-normal max-lg:[overflow-wrap:anywhere]">{value}</div> : <div className="italic muted">Not set</div>}
      </div>
    </div>
  );
}

// Shared account settings — profile + change password. Used by admin/faculty/parent.
/**
 * Every student's dashboard at once - the super admin's switch.
 *
 * Locked, a student can still sign in, finish their profile, change their
 * password and check in to a class; their dashboard, hours, fees and lectures
 * are refused by the server as well, so it is not merely a hidden screen.
 */
function StudentAccessCard() {
  const qc = useQueryClient();
  const access = useStudentAccess();
  const [confirming, setConfirming] = useState(false);
  const locked = access.data !== false;

  const flip = useMutation({
    mutationFn: (next: boolean) => api.put('/settings/student-access', { locked: next }).then((r) => !!r.data.locked),
    onSuccess: (next) => {
      qc.setQueryData(['student-access'], next);
      toast(next ? 'Student dashboards locked' : 'Student dashboards unlocked');
      setConfirming(false);
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change student access', 'error'),
  });

  return (
    <div className="card p-5 flex flex-wrap items-center gap-4">
      <span
        className="grid place-items-center w-11 h-11 rounded-full shrink-0"
        style={{ background: 'var(--color-card-alt)', color: locked ? '#ef4444' : '#10b981' }}
      >
        {locked ? <Lock size={20} /> : <LockOpen size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-bold flex items-center gap-2">
          Student dashboards
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            locked ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          }`}>
            {access.isLoading ? '…' : locked ? 'Locked' : 'Open'}
          </span>
        </div>
        <p className="muted text-sm">
          {locked
            ? 'Students can sign in, finish their profile, change their password and check in — their dashboard, hours, fees and lectures are locked.'
            : 'Students can see their dashboard, hours, fees and lectures.'}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-sm">{locked ? 'Open every student dashboard?' : 'Lock every student dashboard?'}</span>
          <button className="btn-primary !py-1.5 !px-3 text-sm" disabled={flip.isPending} onClick={() => flip.mutate(!locked)}>
            {flip.isPending ? 'Saving…' : locked ? 'Yes, unlock' : 'Yes, lock'}
          </button>
          <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button
          className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap"
          disabled={access.isLoading}
          onClick={() => setConfirming(true)}
        >
          {locked ? 'Unlock for all students' : 'Lock for all students'}
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'info' | 'password'>('info');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const isFaculty = user?.role === 'faculty';
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data), enabled: isFaculty });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data), enabled: isFaculty });

  const name = (isFaculty ? me.data?.name : user?.displayName) || user?.email || '—';
  const username = user?.email || '';
  // Logins can be a plain username (e.g. "sofia") OR a real email. Only treat it
  // as an email if it actually looks like one; otherwise Email is "Not set".
  const email = username.includes('@') ? username : '';
  const mobile = isFaculty ? me.data?.mobile : null;
  const specialization = isFaculty ? me.data?.specialization : null;
  const initials = String(name).split(/\s+/).map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  // Faculty profile edit
  const prof = useForm<any>();
  useEffect(() => {
    if (me.data) prof.reset({ name: me.data.name || '', mobile: me.data.mobile || '', specialization: me.data.specialization || '' });
  }, [me.data]);
  const saveProfile = useMutation({
    mutationFn: (b: any) => api.patch('/teachers/me', { name: b.name, mobile: b.mobile || null, specialization: b.specialization || null }),
    onSuccess: () => { toast('Profile updated'); qc.invalidateQueries({ queryKey: ['teacher-me'] }); setEditing(false); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not update profile', 'error'),
  });

  // Password
  const { register, handleSubmit, reset, watch } = useForm<any>();
  const change = useMutation({
    mutationFn: (b: any) => api.post('/auth/change-password', { currentPassword: b.currentPassword, newPassword: b.newPassword }),
    onSuccess: () => { toast('Password changed'); reset(); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not change password'),
  });
  const onSubmitPassword = (b: any) => {
    setError('');
    if (b.newPassword !== b.confirmPassword) { setError('New password and confirmation do not match'); return; }
    // Today's password rules — the same ones the server enforces (lib/credentials).
    const weak = passwordProblem(b.newPassword, user?.email);
    if (weak) { setError(weak); return; }
    change.mutate(b);
  };

  const roleLabel = user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : '';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Profile Settings</h1>
        <p className="muted text-sm">Your personal information and account security.</p>
      </div>

      {/* Locking every student dashboard is the super admin's switch. */}
      {user?.role === 'superadmin' && <StudentAccessCard />}

      {/* Per device, not per person — see components/NotificationsCard.tsx.
          The office has it on their Notifications page instead, beside the log
          of what was actually sent, which is where the question "did this
          reach anyone?" is asked. A teacher has no such page, so for them it
          stays here. */}
      {user?.role !== 'admin' && user?.role !== 'superadmin' && <NotificationsCard />}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        {/* Phones and tablets: who is signed in, in one row. The contact lines
            are in Personal Information just below, so they are not repeated. */}
        <div className="lg:hidden card p-4 flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-full grid place-items-center text-lg font-bold shrink-0 ring-2 ring-emerald-400/60"
            style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>
            {initials || <User size={22} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-lg leading-tight truncate">{name}</div>
            <div className="muted text-sm truncate">{email || username}</div>
          </div>
          <span className="shrink-0 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">● Active</span>
        </div>

        {/* Left — profile summary card */}
        <div className="card p-6 hidden lg:flex flex-col items-center text-center h-full">
          <div className="w-24 h-24 rounded-full grid place-items-center text-2xl font-bold mb-3 ring-4 ring-emerald-400/60"
            style={{ background: 'var(--color-card-alt)' }}>
            {initials || <User size={28} />}
          </div>
          <div className="font-bold text-lg">{name}</div>
          <div className="muted text-sm">{email || username}</div>
          <span className="mt-2 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">● Active</span>
          <div className="w-full border-t mt-4 pt-4 space-y-2 text-sm text-left" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 muted"><Mail size={15} /> <span className="truncate">{email || 'Not set'}</span></div>
            <div className="flex items-center gap-2 muted"><Phone size={15} /> <span>{mobile || 'Not set'}</span></div>
          </div>

          {/* The two sections, in the card rather than as a rule across the
              page beside them. They belong to the person on this card, and a
              column of two reads as a place to go; a two-item tab bar above a
              single panel reads as decoration. Phones keep the pill tabs — a
              column of buttons there would push the content off the screen. */}
          <nav className="w-full border-t mt-4 pt-4 space-y-1 text-left" style={{ borderColor: 'var(--color-border)' }}>
            {([
              { key: 'info', label: 'Personal Information', Icon: User },
              { key: 'password', label: 'Change Password', Icon: Lock },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors"
                style={tab === key
                  ? { color: 'var(--color-primary)' }
                  : { color: 'var(--color-text)' }}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Right — tabs + content */}
        <div className="space-y-4">
          <div className="flex gap-1 p-1 rounded-2xl bg-[var(--color-card-alt)] lg:hidden">
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap lg:flex-none lg:justify-start lg:px-0 lg:pt-0 lg:pb-2 lg:rounded-none lg:whitespace-normal lg:border-b-2 lg:-mb-px ${tab === 'info' ? 'bg-[var(--color-card)] shadow-sm text-[var(--color-primary)] lg:bg-transparent lg:shadow-none lg:border-[var(--color-primary)]' : 'muted lg:border-transparent'}`}
              onClick={() => setTab('info')}
            >
              <User size={15} className="hidden sm:block" /> Personal Info
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap lg:flex-none lg:justify-start lg:px-0 lg:pt-0 lg:pb-2 lg:rounded-none lg:whitespace-normal lg:border-b-2 lg:-mb-px ${tab === 'password' ? 'bg-[var(--color-card)] shadow-sm text-[var(--color-primary)] lg:bg-transparent lg:shadow-none lg:border-[var(--color-primary)]' : 'muted lg:border-transparent'}`}
              onClick={() => setTab('password')}
            >
              <Lock size={15} className="hidden sm:block" /> <span className="lg:hidden">Password</span><span className="hidden lg:inline">Change Password</span>
            </button>
          </div>

          {tab === 'info' ? (
            <div className="card overflow-hidden">
              {/* A banded header, so the panel has a top edge and the heading
                  is not a line of text floating above the fields. */}
              <div className="flex items-start justify-between gap-3 p-4 sm:px-6 sm:py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-9 h-9 rounded-xl grid place-items-center"
                    style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>
                    <User size={17} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-bold text-lg leading-tight">Personal Information</h2>
                    <p className="muted text-sm">Your account details</p>
                  </div>
                </div>
                {isFaculty && !editing && (
                  <button className="btn-ghost !py-1.5 !px-3 text-sm flex items-center gap-1.5 shrink-0" onClick={() => setEditing(true)}>
                    <Pencil size={14} /> Edit
                  </button>
                )}
              </div>

              <div className="p-4 sm:p-6">
              {editing && isFaculty ? (
                <form onSubmit={prof.handleSubmit((b) => saveProfile.mutate(b))} className="m-form space-y-3 max-w-md">
                  <div>
                    <label className="text-xs font-medium muted">Name *</label>
                    <input className="input mt-1" {...prof.register('name', { required: true })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium muted">Mobile Number</label>
                    <input className="input mt-1" placeholder="e.g. 971 5X XXX XXXX" {...prof.register('mobile')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium muted block mb-1">Specialization (subjects you teach)</label>
                    <input type="hidden" {...prof.register('specialization')} />
                    <MultiSelect
                      value={prof.watch('specialization') || ''}
                      onChange={(v) => prof.setValue('specialization', v)}
                      options={(subjects.data || []).map((s: any) => ({ value: s.name, label: s.name }))}
                      placeholder="Select subject(s)…"
                      allowCustom
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button className="btn-primary max-lg:flex-1 max-lg:!py-2.5" disabled={saveProfile.isPending}>{saveProfile.isPending ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="btn-ghost max-lg:flex-1 max-lg:!py-2.5" onClick={() => { setEditing(false); if (me.data) prof.reset({ name: me.data.name, mobile: me.data.mobile || '', specialization: me.data.specialization || '' }); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 divide-y sm:divide-y-0 max-lg:gap-2 max-lg:divide-y-0" style={{ borderColor: 'var(--color-border)' }}>
                  <Field icon={<User size={16} />} label="Name" value={name} />
                  <Field icon={<Mail size={16} />} label="Email" value={email} />
                  <Field icon={<Phone size={16} />} label="Mobile" value={mobile} />
                  <Field icon={<Shield size={16} />} label="Username" value={username} />
                  {isFaculty && <Field icon={<BookOpen size={16} />} label="Specialization" value={specialization} />}
                  <Field icon={<Shield size={16} />} label="Role" value={roleLabel} />
                </div>
              )}
              </div>
            </div>
          ) : (
            <div className="card overflow-hidden max-w-md">
              <div className="flex items-center gap-3 p-4 sm:px-6 sm:py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="shrink-0 w-9 h-9 rounded-xl grid place-items-center"
                  style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>
                  <Lock size={17} />
                </span>
                <div className="min-w-0">
                  <h2 className="font-bold text-lg leading-tight">Change Password</h2>
                  <p className="muted text-sm">Update your account password.</p>
                </div>
              </div>
              <div className="p-4 sm:p-6">
              <form onSubmit={handleSubmit(onSubmitPassword)} className="m-form space-y-3">
                <div>
                  <label className="text-xs font-medium muted">Current Password *</label>
                  <input className="input mt-1" type="password" autoComplete="current-password" {...register('currentPassword', { required: true })} />
                </div>
                <div>
                  <label className="text-xs font-medium muted">New Password * (8+ characters, a letter and a number)</label>
                  <input className="input mt-1" type="password" autoComplete="new-password" {...register('newPassword', { required: true })} />
                </div>
                <div>
                  <label className="text-xs font-medium muted">Confirm New Password *</label>
                  <input className="input mt-1" type="password" autoComplete="new-password" {...register('confirmPassword', { required: true })} />
                </div>
                {error && <div className="text-sm text-red-500">{error}</div>}
                <button className="btn-primary max-lg:w-full max-lg:!py-2.5" disabled={change.isPending || !watch('newPassword')}>
                  {change.isPending ? 'Saving…' : 'Update Password'}
                </button>
              </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
