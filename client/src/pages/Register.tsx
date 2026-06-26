import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { MultiSelect } from '../components/MultiSelect';
import { Select } from '../components/Select';
import { CalendarPicker } from '../components/CalendarPicker';

type Role = 'student' | 'parent' | 'teacher';
const ROLES: { key: Role; label: string; icon: string; desc: string }[] = [
  { key: 'student', label: 'Student', icon: '🎓', desc: 'Track my hours & lectures' },
  { key: 'parent', label: 'Parent', icon: '👪', desc: "Follow my child's progress" },
  { key: 'teacher', label: 'Teacher', icon: '📚', desc: 'Manage my students & lectures' },
];
const HOME: Record<Role, string> = { student: '/student', parent: '/parent', teacher: '/faculty' };

export default function Register() {
  const { register: doRegister } = useAuth();
  const nav = useNavigate();
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<any>();
  const [subjects, setSubjects] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => { api.get('/auth/subjects').then((r) => setSubjects(r.data.data)).catch(() => {}); }, []);

  const submit = async (b: any) => {
    setError(''); setBusy(true);
    try {
      // GPS is captured in the background (ensureLocation in AuthContext) — we don't
      // block sign-up on it. IP/device are recorded server-side.
      await doRegister({ role, ...b });
      nav(HOME[role]);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Registration failed');
    } finally { setBusy(false); }
  };

  const Field = ({ name, label, type = 'text', required = false, placeholder = '' }: any) => (
    <div>
      <label className="text-sm font-semibold">{label}{required && ' *'}</label>
      <input className="input mt-1" type={type} autoComplete="off"
        placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        {...register(name, required ? { required: true } : {})} />
      {errors[name] && <span className="text-xs text-red-500">Required</span>}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 w-full max-w-lg">
        <div className="font-display font-extrabold text-2xl mb-1" style={{ color: 'var(--color-primary)' }}>🎓 Create your account</div>
        <p className="muted text-sm mb-5">Select your role to register.</p>

        {/* Role selector */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {ROLES.map((r) => {
            const active = role === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => { setRole(r.key); reset(); setError(''); }}
                className="rounded-xl border-2 p-3 text-center transition"
                style={{
                  borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                  background: active ? 'var(--color-card-alt)' : 'transparent',
                }}
              >
                <div className="text-2xl">{r.icon}</div>
                <div className="font-semibold text-sm mt-1">{r.label}</div>
                <div className="muted text-[11px] mt-0.5 leading-tight">{r.desc}</div>
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit(submit)} className="space-y-4">
          {/* role-specific fields */}
          {role === 'student' && (
            <div className="grid grid-cols-2 gap-3">
              <Field name="first_name" label="First Name" required />
              <Field name="last_name" label="Last Name" />
            </div>
          )}

          {role === 'teacher' && (
            <div className="grid grid-cols-2 gap-3">
              <Field name="name" label="Full Name" required />
              <div>
                <label className="text-sm font-semibold">Specialization</label>
                <input type="hidden" {...register('specialization')} />
                <div className="mt-1">
                  <MultiSelect
                    value={watch('specialization') || ''}
                    onChange={(v) => setValue('specialization', v)}
                    options={subjects.map((s) => ({ value: s.name, label: s.name }))}
                    placeholder="Select subject(s)…"
                    allowCustom
                  />
                </div>
              </div>
              <div className="col-span-2"><Field name="mobile" label="Mobile" /></div>
            </div>
          )}

          {role === 'parent' && (
            <>
              <div className="card p-3" style={{ background: 'var(--color-card-alt)' }}>
                <div className="text-xs font-semibold mb-2">🔗 Link to your child</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field name="child_form_no" label="Child's Form No" required placeholder="e.g. 20" />
                  <div>
                    <label className="text-sm font-semibold">Child's DOB</label>
                    <input type="hidden" {...register('child_dob')} />
                    <div className="mt-1">
                      <CalendarPicker value={watch('child_dob') || ''} onChange={(v) => setValue('child_dob', v)} placeholder="Select date of birth" />
                    </div>
                  </div>
                </div>
                <p className="muted text-[11px] mt-2">We use the Form No (and DOB if on file) to verify and link you to your child.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field name="name" label="Your Name" required />
                <div>
                  <label className="text-sm font-semibold">Relationship</label>
                  <input type="hidden" {...register('relationship')} />
                  <div className="mt-1">
                    <Select
                      value={watch('relationship') || ''}
                      onChange={(v) => setValue('relationship', v)}
                      options={['Father', 'Mother', 'Guardian'].map((r) => ({ value: r, label: r }))}
                      placeholder="Select…"
                    />
                  </div>
                </div>
                <div className="col-span-2"><Field name="mobile" label="Mobile" /></div>
              </div>
            </>
          )}

          {/* account */}
          <Field name="email" label="Email" type="email" required />
          <Field name="password" label="Password (min 6)" type="password" required />

          {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
          <button className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? 'Creating…' : `Register as ${ROLES.find((r) => r.key === role)!.label} →`}
          </button>
        </form>

        <div className="mt-5 text-sm">
          Have an account?{' '}
          <Link to="/login" className="font-semibold" style={{ color: 'var(--color-primary)' }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
