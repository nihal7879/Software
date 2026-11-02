import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../api/client';
import { MultiSelect } from '../components/MultiSelect';
import { RegisterLayout, makeField, PasswordFields, UsernameField } from '../components/RegisterLayout';
import { RegistrationReceived } from '../components/RegistrationReceived';

// Teacher self-registration, on its own link (/register/teacher). It used to
// sign the teacher in on the spot; it is now a request the administrator
// approves, as a student's is, and nobody is signed in until then.
export default function TeacherRegister() {
  const [done, setDone] = useState<{ name: string; username: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [subjects, setSubjects] = useState<{ id: number; name: string }[]>([]);
  const { register, handleSubmit, getValues, watch, setValue, formState: { errors } } = useForm<any>();
  const field = makeField(register, errors);

  useEffect(() => { api.get('/auth/subjects').then((r) => setSubjects(r.data.data)).catch(() => {}); }, []);

  const submit = async ({ confirm_password: _confirm, ...b }: any) => {
    setError(''); setBusy(true);
    try {
      await api.post('/auth/register', { role: 'teacher', ...b, email: b.email.trim() });
      setDone({ name: String(b.name || '').trim().split(/\s+/)[0] || 'you', username: String(b.username).trim().toLowerCase() });
    } catch (e: any) {
      setError(e.response?.data?.error || 'Registration failed. Please try again.');
    } finally { setBusy(false); }
  };

  if (done) return <RegistrationReceived name={done.name} username={done.username} />;

  return (
    <RegisterLayout
      eyebrow="Teacher Registration"
      title={<>Teach with <span className="accent-word">STEM Vision</span></>}
      subtitle="Register as a teacher. The administrator will confirm your registration before you can sign in."
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



