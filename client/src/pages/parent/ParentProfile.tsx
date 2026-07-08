import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { User, Mail, Phone, Shield, Lock, GraduationCap } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { Spinner } from '../../components/ui';
import { StudentRegistrationForm } from '../../components/StudentRegistrationForm';
import { toast } from '../../components/Toast';

// A single read-only field (icon + label + value / "Not set").
function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-[var(--color-primary)] opacity-80">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs muted">{label}</div>
        {value != null && value !== '' ? <div className="font-semibold break-words">{value}</div> : <div className="italic muted">Not set</div>}
      </div>
    </div>
  );
}

// Parent Profile — parent account details + the child student's profile form + change password.
export default function ParentProfile() {
  const { user } = useAuth();
  const id = user?.studentId;
  const qc = useQueryClient();
  const [tab, setTab] = useState<'info' | 'student' | 'password'>('info');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });

  // Password change
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

  if (!id) return <p className="muted p-6">No student linked to this parent account.</p>;
  if (student.isLoading) return <Spinner />;
  const s = student.data || {};

  // Parent account (this login) vs the linked student.
  const username = user?.email || '';
  const dn = (user?.displayName || '').trim();
  // Prefer a real display name; if it's just the username, fall back to the
  // linked student's full name so the parent sees a full name, not "zelia".
  const parentName = dn && dn.toLowerCase() !== username.toLowerCase() ? dn : (s.full_name || dn || username || '—');
  const parentEmail = (username.includes('@') ? username : '') || s.email || '';
  const parentMobile = s.parent_mobile || s.extra_mobile || '';
  const initials = String(parentName).split(/\s+/).map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="muted text-sm">Your child's details and your account security.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Left — summary card */}
        <div className="card p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 rounded-full grid place-items-center text-2xl font-bold mb-3 ring-4 ring-emerald-400/60"
            style={{ background: 'var(--color-card-alt)' }}>
            {initials || <User size={28} />}
          </div>
          <div className="font-bold text-lg">{parentName}</div>
          <div className="muted text-sm truncate max-w-full">{username}</div>
          <span className="mt-2 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">● Active</span>
          <div className="w-full border-t mt-4 pt-4 space-y-2 text-sm text-left" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 muted"><Mail size={15} /> <span className="truncate">{parentEmail || 'Not set'}</span></div>
            <div className="flex items-center gap-2 muted"><Phone size={15} /> <span>{parentMobile || 'Not set'}</span></div>
            <div className="flex items-center gap-2 muted"><Shield size={15} /> <span>Parent</span></div>
          </div>
        </div>

        {/* Right — tabs */}
        <div className="space-y-4">
          <div className="flex items-center gap-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <button
              className={`flex items-center gap-1.5 pb-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === 'info' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent muted'}`}
              onClick={() => setTab('info')}
            >
              <User size={15} /> Personal Info
            </button>
            <button
              className={`flex items-center gap-1.5 pb-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === 'student' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent muted'}`}
              onClick={() => setTab('student')}
            >
              <GraduationCap size={15} /> Student Info
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
              <div className="mb-4">
                <h2 className="font-bold text-lg">Personal Information</h2>
                <p className="muted text-sm">Your account details</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 divide-y sm:divide-y-0" style={{ borderColor: 'var(--color-border)' }}>
                <Field icon={<User size={16} />} label="Name" value={parentName} />
                <Field icon={<Mail size={16} />} label="Email" value={parentEmail} />
                <Field icon={<Phone size={16} />} label="Mobile" value={parentMobile} />
                <Field icon={<Shield size={16} />} label="Username" value={username} />
                <Field icon={<Shield size={16} />} label="Role" value="Parent" />
              </div>
            </div>
          ) : tab === 'student' ? (
            <div className="card p-6">
              <div className="mb-4">
                <h2 className="font-bold text-lg">Student Profile</h2>
                <p className="muted text-sm">Your child's registered details{s.full_name ? ` — ${s.full_name}` : ''}</p>
              </div>
              {saved && <div className="card p-3 mb-4 text-sm text-emerald-600">✅ Saved & submitted to Management.</div>}
              <StudentRegistrationForm
                studentId={id}
                initial={s}
                onSaved={() => { setSaved(true); qc.invalidateQueries({ queryKey: ['student', id] }); }}
              />
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
