import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { Section, Spinner } from '../../components/ui';

export default function StudentProfile() {
  const { user } = useAuth();
  const id = user?.studentId;
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const { register, handleSubmit } = useForm({ values: student.data });
  const pw = useForm();

  const save = async (b: any) => {
    setMsg('');
    await api.patch(`/students/${id}/profile`, {
      email: b.email, student_mobile: b.student_mobile, parent_mobile: b.parent_mobile, extra_mobile: b.extra_mobile,
    });
    setMsg('✅ Contact details updated.');
  };

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

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Profile</h1>

      <Section title="Contact Details">
        {msg && <div className="text-sm text-emerald-600 mb-2">{msg}</div>}
        <form onSubmit={handleSubmit(save)} className="space-y-3">
          {[['email', 'Email'], ['student_mobile', 'Student Mobile'], ['parent_mobile', 'Parent Mobile'], ['extra_mobile', 'Extra Mobile']].map(([n, l]) => (
            <div key={n}>
              <label className="text-xs font-medium muted">{l}</label>
              <input className="input mt-1" {...register(n)} />
            </div>
          ))}
          <button className="btn-primary">Save</button>
        </form>
      </Section>

      <Section title="Change Password">
        {pwMsg && <div className="text-sm mb-2">{pwMsg}</div>}
        <form onSubmit={pw.handleSubmit(changePw)} className="space-y-3">
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
      </Section>
    </div>
  );
}
