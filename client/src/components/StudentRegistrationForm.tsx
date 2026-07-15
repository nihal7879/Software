import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../api/client';
import { useMasters } from '../api/masters';
import { Select } from './Select';
import { CalendarPicker } from './CalendarPicker';

// The full "Student Registration / Complete Profile" form.
// Used by the post-login popup AND the editable Registration page.
// Saves via PATCH /students/:id/complete-profile (flags profile_completed → Management sees it).
function ageFromDob(dob?: string) {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '';
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? String(a) : '';
}

export function StudentRegistrationForm({
  studentId,
  initial,
  onSaved,
  submitLabel = 'Save & Submit to the Institute',
}: {
  studentId: number;
  initial?: any;
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const masters = useMasters();

  // Pre-fill the contact email from the login the student registered with,
  // but only if it's a real email (usernames like "akanksha" are ignored).
  const initialValues = useMemo(() => {
    if (!initial) return initial;
    const loginEmail = initial.login_email;
    const email = initial.email || (loginEmail && String(loginEmail).includes('@') ? loginEmail : '');
    return { ...initial, email };
  }, [initial]);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<any>({ values: initialValues });
  const first = watch('first_name'); const middle = watch('middle_name'); const last = watch('last_name');
  const dob = watch('dob');
  const fullName = useMemo(() => [first, middle, last].filter(Boolean).join(' '), [first, middle, last]);
  const age = useMemo(() => ageFromDob(dob), [dob]);

  const submit = async (b: any) => {
    setError(''); setBusy(true);
    try {
      await api.patch(`/students/${studentId}/complete-profile`, {
        ...b,
        age: age ? Number(age) : null,
      });
      onSaved?.();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not save. Please check the fields.');
    } finally { setBusy(false); }
  };

  const F = ({ name, label, type = 'text', required = false, placeholder = '' }: any) => (
    <div>
      <label className="text-xs font-semibold muted">{label}{required && ' *'}</label>
      <input className="input mt-1" type={type} autoComplete="off"
        placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        {...register(name, required ? { required: true } : {})} />
      {errors[name] && <span className="text-xs text-red-500">Required</span>}
    </div>
  );

  // A dropdown-backed field — values stay text, but the user picks from a list
  // (or types a custom one via allowCustom).
  const SelectField = ({ name, label, options, placeholder = 'Select…', required = true, allowCustom = true }: any) => (
    <div>
      <label className="text-xs font-semibold muted block mb-1">{label}{required && ' *'}</label>
      <input type="hidden" {...register(name, required ? { required: true } : {})} />
      <Select
        value={watch(name) || ''}
        onChange={(v) => setValue(name, v, { shouldValidate: true })}
        options={options.map((o: string) => ({ value: o, label: o }))}
        placeholder={placeholder}
        allowCustom={allowCustom}
      />
      {errors[name] && <span className="text-xs text-red-500">Required</span>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      {/* Identity */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Personal Details</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="first_name" label="First Name" required />
          <F name="middle_name" label="Middle Name" required />
          <F name="last_name" label="Last Name" required />
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold muted">Full Name (auto)</label>
            <input className="input mt-1 opacity-70" value={fullName} readOnly />
          </div>
          <div>
            <label className="text-xs font-semibold muted block mb-1">Gender *</label>
            <input type="hidden" {...register('gender', { required: true })} />
            <Select value={watch('gender') || ''} onChange={(v) => setValue('gender', v, { shouldValidate: true })} options={['Male', 'Female', 'Other'].map((v) => ({ value: v, label: v }))} placeholder="Select gender…" />
            {errors.gender && <span className="text-xs text-red-500">Required</span>}
          </div>
          <div>
            <label className="text-xs font-semibold muted block mb-1">DOB *</label>
            <input type="hidden" {...register('dob', { required: true })} />
            <CalendarPicker value={watch('dob') || ''} onChange={(v) => setValue('dob', v, { shouldValidate: true })} placeholder="Select date of birth" />
            {errors.dob && <span className="text-xs text-red-500">Required</span>}
          </div>
          <div>
            <label className="text-xs font-semibold muted">Age (auto)</label>
            <input className="input mt-1 opacity-70" value={age} readOnly />
          </div>
          <F name="nationality" label="Nationality" required />
        </div>
      </section>

      {/* Academic */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Academic</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SelectField name="year_grade" label="Year / Grade" placeholder="Select year / grade…"
            options={masters.year_grades} />
          <SelectField name="school_name" label="School" placeholder="Select school…"
            options={masters.schools} required={false} />
          <SelectField name="exam_board" label="Exam Board" placeholder="Select exam board…"
            options={masters.exam_boards} />
        </div>
      </section>

      {/* Family */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Family</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="father_name" label="Father Name" required />
          <F name="mother_name" label="Mother Name" required />
          <div>
            <label className="text-xs font-semibold muted block mb-1">Relationship (who pays) *</label>
            <input type="hidden" {...register('relationship', { required: true })} />
            <Select value={watch('relationship') || ''} onChange={(v) => setValue('relationship', v, { shouldValidate: true })} options={['Father', 'Mother', 'Guardian'].map((v) => ({ value: v, label: v }))} placeholder="Select…" />
            {errors.relationship && <span className="text-xs text-red-500">Required</span>}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Contact</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="email" label="Email id" />
          <F name="student_mobile" label="Student Mob No" required />
          <F name="parent_mobile" label="Parent Mob No" required />
          <F name="extra_mobile" label="Extra Mob No 2" />
        </div>
      </section>

      {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
      <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
