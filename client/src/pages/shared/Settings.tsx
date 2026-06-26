import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Section } from '../../components/ui';
import { toast } from '../../components/Toast';

// Shared account settings — change password. Used by admin, faculty and parent.
export default function Settings() {
  const { user } = useAuth();
  const { register, handleSubmit, reset, watch } = useForm<any>();
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: (b: any) =>
      api.post('/auth/change-password', { currentPassword: b.currentPassword, newPassword: b.newPassword }),
    onSuccess: () => { toast('Password changed'); reset(); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not change password'),
  });

  const onSubmit = (b: any) => {
    setError('');
    if (b.newPassword !== b.confirmPassword) { setError('New password and confirmation do not match'); return; }
    change.mutate(b);
  };

  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="muted text-sm">Signed in as <b>{user?.displayName || user?.email}</b>.</p>

      <Section title="Change Password">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
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
      </Section>
    </div>
  );
}
