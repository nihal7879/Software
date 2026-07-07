import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { User, Mail, Phone, Shield, BookOpen, Lock, Pencil } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { MultiSelect } from '../../components/MultiSelect';
import { toast } from '../../components/Toast';

// A single read-only field (icon + label + value / "Not set").
function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-[var(--color-primary)] opacity-80">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs muted">{label}</div>
        {value ? <div className="font-semibold truncate">{value}</div> : <div className="italic muted">Not set</div>}
      </div>
    </div>
  );
}

// Shared account settings — profile + change password. Used by admin/faculty/parent.
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
    change.mutate(b);
  };

  const roleLabel = user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : '';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Profile Settings</h1>
        <p className="muted text-sm">Manage your personal information and account security.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Left — profile summary card */}
        <div className="card p-6 flex flex-col items-center text-center">
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
            <div className="flex items-center gap-2 muted"><Shield size={15} /> <span>{roleLabel}</span></div>
          </div>
        </div>

        {/* Right — tabs + content */}
        <div className="space-y-4">
          <div className="flex items-center gap-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <button
              className={`flex items-center gap-1.5 pb-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === 'info' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent muted'}`}
              onClick={() => setTab('info')}
            >
              <User size={15} /> Personal Info
            </button>
            <button
              className={`flex items-center gap-1.5 pb-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === 'password' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent muted'}`}
              onClick={() => setTab('password')}
            >
              <Lock size={15} /> Change Password
            </button>
          </div>

          {tab === 'info' ? (
            <div className="card p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-bold text-lg">Personal Information</h2>
                  <p className="muted text-sm">Your account details</p>
                </div>
                {isFaculty && !editing && (
                  <button className="btn-ghost !py-1.5 !px-3 text-sm flex items-center gap-1.5" onClick={() => setEditing(true)}>
                    <Pencil size={14} /> Edit
                  </button>
                )}
              </div>

              {editing && isFaculty ? (
                <form onSubmit={prof.handleSubmit((b) => saveProfile.mutate(b))} className="space-y-3 max-w-md">
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
                    <button className="btn-primary" disabled={saveProfile.isPending}>{saveProfile.isPending ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="btn-ghost" onClick={() => { setEditing(false); if (me.data) prof.reset({ name: me.data.name, mobile: me.data.mobile || '', specialization: me.data.specialization || '' }); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 divide-y sm:divide-y-0" style={{ borderColor: 'var(--color-border)' }}>
                  <Field icon={<User size={16} />} label="Name" value={name} />
                  <Field icon={<Mail size={16} />} label="Email" value={email} />
                  <Field icon={<Phone size={16} />} label="Mobile" value={mobile} />
                  <Field icon={<Shield size={16} />} label="Username" value={username} />
                  {isFaculty && <Field icon={<BookOpen size={16} />} label="Specialization" value={specialization} />}
                  <Field icon={<Shield size={16} />} label="Role" value={roleLabel} />
                </div>
              )}
            </div>
          ) : (
            <div className="card p-6 max-w-md">
              <h2 className="font-bold text-lg mb-1">Change Password</h2>
              <p className="muted text-sm mb-4">Update your account password.</p>
              <form onSubmit={handleSubmit(onSubmitPassword)} className="space-y-3">
                <div>
                  <label className="text-xs font-medium muted">Current Password *</label>
                  <input className="input mt-1" type="password" autoComplete="current-password" {...register('currentPassword', { required: true })} />
                </div>
                <div>
                  <label className="text-xs font-medium muted">New Password * (min 6 characters)</label>
                  <input className="input mt-1" type="password" autoComplete="new-password" {...register('newPassword', { required: true, minLength: 6 })} />
                </div>
                <div>
                  <label className="text-xs font-medium muted">Confirm New Password *</label>
                  <input className="input mt-1" type="password" autoComplete="new-password" {...register('confirmPassword', { required: true })} />
                </div>
                {error && <div className="text-sm text-red-500">{error}</div>}
                <button className="btn-primary" disabled={change.isPending || !watch('newPassword')}>
                  {change.isPending ? 'Saving…' : 'Update Password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
