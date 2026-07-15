import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { User, Mail, Phone, Shield, Lock } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { Spinner } from '../../components/ui';
import { StudentRegistrationForm } from '../../components/StudentRegistrationForm';
import { toast } from '../../components/Toast';

// Profile now carries BOTH personal info (registration form) and account security
// (change password) — the Settings-style layout with a summary card + tabs.
export default function StudentProfile() {
  const { user } = useAuth();
  const id = user?.studentId!;
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'info' | 'password'>('info');
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

  if (student.isLoading) return <Spinner />;
  const s = student.data;

  const name = s.full_name || user?.displayName || user?.email || '—';
  const username = user?.email || '';
  const email = s.email || (username.includes('@') ? username : '');
  const mobile = s.student_mobile || s.mobile || null;
  const initials = String(name).split(/\s+/).map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="muted text-sm">Your personal information and account security.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Left — profile summary card */}
        <div className="card p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 rounded-full grid place-items-center text-2xl font-bold mb-3 ring-4 ring-emerald-400/60"
            style={{ background: 'var(--color-card-alt)' }}>
            {initials || <User size={28} />}
          </div>
          <div className="font-bold text-lg">{name}</div>
          <div className="muted text-sm truncate max-w-full">{email || username}</div>
          <span className={`mt-2 text-xs px-2.5 py-0.5 rounded-full ${s.profile_completed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
            {s.profile_completed ? '● Profile completed' : '● Profile pending'}
          </span>
          <div className="w-full border-t mt-4 pt-4 space-y-2 text-sm text-left" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 muted"><Mail size={15} /> <span className="truncate">{email || 'Not set'}</span></div>
            <div className="flex items-center gap-2 muted"><Phone size={15} /> <span>{mobile || 'Not set'}</span></div>
            <div className="flex items-center gap-2 muted"><Shield size={15} /> <span>Student{s.form_no ? ` · Form ${s.form_no}` : ''}</span></div>
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
              <div className="mb-4">
                <h2 className="font-bold text-lg">Registration / My Details</h2>
                <p className="muted text-sm">Fill in your details and submit — it goes to the institute.</p>
              </div>
              {!s.profile_completed && (
                <div className="card p-3 mb-4 text-sm font-medium" style={{ borderColor: 'var(--color-accent)' }}>
                  ⚠️ Your profile is incomplete. Please complete the form below.
                </div>
              )}
              {saved && <div className="card p-3 mb-4 text-sm text-emerald-600">✅ Saved & submitted to the institute.</div>}
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
