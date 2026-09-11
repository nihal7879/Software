import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../auth/AuthContext';
import { Select } from '../components/Select';
import { CalendarPicker } from '../components/CalendarPicker';
import { RegisterLayout, makeField, PasswordFields, UsernameField } from '../components/RegisterLayout';

// Parent self-registration, on its own link (/register/parent). The parent is
// linked to their child by the child's Form No (and date of birth, when the
// institute has one on file). The account is live straight away — parent
// registrations are not yet held for an administrator the way students' are.
export default function ParentRegister() {
  const { register: doRegister } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, getValues, watch, setValue, formState: { errors } } = useForm<any>();
  const field = makeField(register, errors);

  const submit = async ({ confirm_password: _confirm, ...b }: any) => {
    setError(''); setBusy(true);
    try {
      await doRegister({ role: 'parent', ...b, email: b.email.trim() });
      nav('/parent');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Registration failed. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <RegisterLayout
      eyebrow="Parent Registration"
      title={<>Follow your child on <span className="accent-word">STEM Vision</span></>}
      subtitle="Create a parent account linked to your child's record."
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" autoComplete="off">
        <div className="card p-3" style={{ background: 'var(--color-card-alt)' }}>
          <div className="text-xs font-semibold mb-2">🔗 Link to your child</div>
          <div className="grid grid-cols-2 gap-3">
            {field('child_form_no', "Child's Form No", { placeholder: 'e.g. 20' })}
            <div>
              <label className="text-sm font-semibold">Child's DOB</label>
              <input type="hidden" {...register('child_dob')} />
              <div className="mt-1.5">
                <CalendarPicker value={watch('child_dob') || ''} onChange={(v) => setValue('child_dob', v)} placeholder="Select date of birth" />
              </div>
            </div>
          </div>
          <p className="muted text-[11px] mt-2">We use the Form No (and DOB if on file) to verify and link you to your child.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {field('name', 'Your Name')}
          <div>
            <label className="text-sm font-semibold">Relationship to the child</label>
            <input type="hidden" {...register('relationship')} />
            <div className="mt-1.5">
              <Select
                value={watch('relationship') || ''}
                onChange={(v) => setValue('relationship', v)}
                options={['Father', 'Mother', 'Guardian'].map((r) => ({ value: r, label: r }))}
                placeholder="Select…"
              />
            </div>
          </div>
        </div>
        {field('mobile', 'Mobile', { type: 'tel', required: false, placeholder: 'e.g. +971 50 123 4567' })}
        <UsernameField register={register} errors={errors} value={watch('username')} />
        {field('email', 'Email', { type: 'email', placeholder: 'you@example.com' })}
        <PasswordFields register={register} errors={errors} getValues={getValues} password={watch('password')} username={watch('username')} />

        {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
        <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Creating…' : 'Register as Parent →'}</button>
      </form>
    </RegisterLayout>
  );
}
