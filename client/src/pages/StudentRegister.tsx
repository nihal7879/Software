import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import { EMAIL_RE } from '../components/StudentRegistrationForm';
import { RegisterLayout, makeField, PasswordFields, UsernameField } from '../components/RegisterLayout';

// Student self-registration, on its own link (/register/student).
//
// Registering does not log anyone in. It sends a request to the administrator,
// who approves it as a Trial or an Enrolment; only then can the student sign in.
// So the page ends on a "waiting for the administrator" screen with a way back
// to sign-in, rather than on a dashboard.
export default function StudentRegister() {
  const [error, setError] = useState('');
  // Set when the email is already registered, or already waiting for approval —
  // neither is fixed by trying again, so the page points to sign-in instead.
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; username: string } | null>(null);
  const { register, handleSubmit, getValues, watch, formState: { errors } } = useForm<any>();
  const field = makeField(register, errors);

  const submit = async (b: any) => {
    setError(''); setKnown(false); setBusy(true);
    try {
      await api.post('/auth/register', {
        role: 'student',
        first_name: b.first_name,
        last_name: b.last_name,
        username: b.username,
        email: b.email.trim(),
        student_mobile: b.student_mobile,
        password: b.password,
      });
      setDone({ name: b.first_name, username: b.username });
    } catch (e: any) {
      const d = e.response?.data;
      setError(d?.error || 'Registration failed. Please try again.');
      setKnown(d?.code === 'EMAIL_REGISTERED' || d?.code === 'REGISTRATION_PENDING');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <RegisterLayout eyebrow="Registration received" title={`Thank you, ${done.name}`} showSignInLink={false}>
        <CheckCircle2 size={44} className="text-emerald-500 mb-4" />
        <div className="text-sm rounded-lg px-4 py-3 mb-6 bg-amber-500/15 text-amber-700 dark:text-amber-400">
          Your registration is <b>waiting for the administrator to confirm</b>. Once it is approved you can sign in
          with the username <b>{done.username}</b> and the password you just set.
        </div>
        <Link to="/login" className="btn-primary w-full !py-3 inline-flex justify-center">← Back to sign in</Link>
      </RegisterLayout>
    );
  }

  return (
    <RegisterLayout
      eyebrow="Student Registration"
      title={<>Join <span className="accent-word">STEM Vision</span></>}
      subtitle="Register as a student. The administrator will confirm your registration before you can sign in."
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" autoComplete="off">
        <div className="grid grid-cols-2 gap-3">
          {field('first_name', 'First Name')}
          {field('last_name', 'Last Name')}
        </div>
        <UsernameField register={register} errors={errors} value={watch('username')} />
        {field('email', 'Email', { type: 'email', placeholder: 'you@example.com', rules: { pattern: { value: EMAIL_RE, message: 'Enter a valid email' } } })}
        {field('student_mobile', 'Mobile', { type: 'tel', placeholder: 'e.g. +971 50 123 4567' })}
        <PasswordFields register={register} errors={errors} getValues={getValues} password={watch('password')} username={watch('username')} />

        {error && (known ? (
          <div className="text-sm rounded-lg px-3 py-2 bg-amber-500/15 text-amber-700 dark:text-amber-400">
            {error}{' '}
            <Link to="/login" className="font-semibold underline">Go to sign in</Link>
          </div>
        ) : (
          <div className="text-sm text-red-500 font-medium">{error}</div>
        ))}
        <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Submitting…' : 'Register →'}</button>
      </form>
    </RegisterLayout>
  );
}
