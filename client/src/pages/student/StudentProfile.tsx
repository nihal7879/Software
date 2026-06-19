import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { Spinner } from '../../components/ui';
import { Accordion } from '../../components/Accordion';
import { StudentRegistrationForm } from '../../components/StudentRegistrationForm';

// Profile = clickable sections (government-form style): Registration + Password.
export default function StudentProfile() {
  const { user } = useAuth();
  const id = user?.studentId!;
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const pw = useForm();

  const changePw = async (b: any) => {
    setPwMsg('');
    try {
      await api.post('/auth/change-password', { currentPassword: b.currentPassword, newPassword: b.newPassword });
      setPwMsg('✅ Password changed.');
      pw.reset();
    } catch (e: any) {
      setPwMsg(e.response?.data?.error || 'Failed');
    }
  };

  if (student.isLoading) return <Spinner />;
  const s = student.data;

  const completedBadge = s.profile_completed
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">Completed</span>
    : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Pending</span>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Profile</h1>
        {completedBadge}
      </div>

      {!s.profile_completed && (
        <div className="card p-4 text-sm font-medium" style={{ borderColor: 'var(--color-accent)' }}>
          ⚠️ Open “Registration / My Details” below, fill it in and submit — it goes to Management.
        </div>
      )}
      {saved && <div className="card p-3 text-sm text-emerald-600">✅ Saved & submitted to Management.</div>}

      <Accordion
        defaultOpen={s.profile_completed ? undefined : 'registration'}
        items={[
          {
            key: 'registration',
            icon: '📝',
            title: 'Registration / My Details',
            subtitle: 'Personal, academic, family & contact information',
            badge: completedBadge,
            content: (
              <StudentRegistrationForm
                studentId={id}
                initial={s}
                onSaved={() => { setSaved(true); qc.invalidateQueries({ queryKey: ['student', id] }); }}
              />
            ),
          },
          {
            key: 'password',
            icon: '🔒',
            title: 'Change Password',
            subtitle: 'Update your login password',
            content: (
              <>
                {pwMsg && <div className="text-sm mb-2">{pwMsg}</div>}
                <form onSubmit={pw.handleSubmit(changePw)} className="space-y-3 pt-2">
                  <div>
                    <label className="text-xs font-medium muted">Current Password</label>
                    <input type="password" className="input mt-1" {...pw.register('currentPassword', { required: true })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium muted">New Password</label>
                    <input type="password" className="input mt-1" {...pw.register('newPassword', { required: true, minLength: 6 })} />
                  </div>
                  <button className="btn-primary">Update Password</button>
                </form>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
