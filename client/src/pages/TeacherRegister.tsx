import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { MultiSelect } from '../components/MultiSelect';
import { RegisterLayout, makeField, PasswordFields, UsernameField } from '../components/RegisterLayout';

// Teacher self-registration, on its own link (/register/teacher). The account is
// live straight away — teacher registrations are not yet held for an
// administrator the way students' are.
export default function TeacherRegister() {
  const { register: doRegister } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [subjects, setSubjects] = useState<{ id: number; name: string }[]>([]);
  const { register, handleSubmit, getValues, watch, setValue, formState: { errors } } = useForm<any>();
  const field = makeField(register, errors);

  useEffect(() => { api.get('/auth/subjects').then((r) => setSubjects(r.data.data)).catch(() => {}); }, []);

  const submit = async ({ confirm_password: _confirm, ...b }: any) => {
    setError(''); setBusy(true);
    try {
      await doRegister({ role: 'teacher', ...b, email: b.email.trim() });
      nav('/faculty');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Registration failed. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <RegisterLayout
      eyebrow="Teacher Registration"
      title={<>Teach with <span className="accent-word">STEM Vision</span></>}
      subtitle="Create a teacher account to log lectures and follow your students."
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" autoComplete="off">
        {field('name', 'Full Name')}
        <div>
          <label className="text-sm font-semibold">Specialization</label>
          <input type="hidden" {...register('specialization')} />
          <div className="mt-1.5">
            <MultiSelect
              value={watch('specialization') || ''}
              onChange={(v) => setValue('specialization', v)}
              options={subjects.map((s) => ({ value: s.name, label: s.name }))}
              placeholder="Select subject(s)…"
              allowCustom
            />
          </div>
        </div>
        {field('mobile', 'Mobile', { type: 'tel', required: false, placeholder: 'e.g. +971 50 123 4567' })}
        <UsernameField register={register} errors={errors} value={watch('username')} />
        {field('email', 'Email', { type: 'email', placeholder: 'you@example.com' })}
        <PasswordFields register={register} errors={errors} getValues={getValues} password={watch('password')} username={watch('username')} />

        {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
        <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Creating…' : 'Register as Teacher →'}</button>
      </form>
    </RegisterLayout>
  );
}
