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

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Family: at least one contact — father, mother or guardian — and each one given
// needs both a name and a number, since neither half is usable on its own.
// Returns the problem to show, or '' when the family details are acceptable.
// Shared with the admin's Add Student drawer so both forms apply one rule.
export function familyProblem(b: any): string {
  const t = (v: any) => String(v ?? '').trim();
  const pairs = [
    ['father', t(b.father_name), t(b.father_mobile)],
    ['mother', t(b.mother_name), t(b.mother_mobile)],
    ['guardian', t(b.guardian_name), t(b.guardian_mobile)],
  ] as const;
  const half = pairs.find(([, n, m]) => (n && !m) || (!n && m));
  if (half) return half[1] ? `Enter the ${half[0]}'s mobile number.` : `Enter the ${half[0]}'s name.`;
  if (!pairs.some(([, n]) => n)) return 'Enter at least one — father, mother or guardian — with their mobile number.';
  return '';
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
  const [familyError, setFamilyError] = useState('');
  const [busy, setBusy] = useState(false);
  const masters = useMasters();

  // Pre-fill the contact email from the login the student registered with,
  // but only if it's a real email (usernames like "akanksha" are ignored).
  const initialValues = useMemo(() => {
    if (!initial) return initial;
    const loginEmail = initial.login_email;
    const email = initial.email || (loginEmail && String(loginEmail).includes('@') ? loginEmail : '');
    // Profiles saved before the form asked for each contact's own number hold a
    // single parent_mobile. Put it beside the person it most likely belongs to —
    // the stated payer if they are named, else the first person named — so it is
    // visible and correctable, rather than silently lost from the form.
    const hasOwnNumbers = initial.father_mobile || initial.mother_mobile || initial.guardian_mobile;
    const carried: Record<string, string> = {};
    if (!hasOwnNumbers && initial.parent_mobile) {
      const slots = [
        ['Father', 'father_name', 'father_mobile'],
        ['Mother', 'mother_name', 'mother_mobile'],
        ['Guardian', 'guardian_name', 'guardian_mobile'],
      ] as const;
      const stated = slots.find(([rel, nameKey]) => initial.relationship === rel && initial[nameKey]);
      const slot = stated || slots.find(([, nameKey]) => initial[nameKey]) || slots[0];
      carried[slot[2]] = initial.parent_mobile;
    }
    return { ...initial, email, ...carried };
  }, [initial]);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<any>({ values: initialValues });
  const first = watch('first_name'); const middle = watch('middle_name'); const last = watch('last_name');
  const dob = watch('dob');
  const fullName = useMemo(() => [first, middle, last].filter(Boolean).join(' '), [first, middle, last]);
  const age = useMemo(() => ageFromDob(dob), [dob]);

  const submit = async (b: any) => {
    const fe = familyProblem(b);
    setFamilyError(fe);
    if (fe) return;
    setError(''); setBusy(true);
    try {
      // relationship and parent_mobile are no longer asked; the server derives
      // both from the family contacts, so the stale copies are not sent back.
      const { relationship: _relationship, parent_mobile: _parentMobile, ...rest } = b;
      await api.patch(`/students/${studentId}/complete-profile`, {
        ...rest,
        age: age ? Number(age) : null,
      });
      onSaved?.();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not save. Please check the fields.');
    } finally { setBusy(false); }
  };

  // F and SelectField are called as plain functions, not rendered as <F/>: a
  // component declared inside this one is a new type on every render, and this
  // form re-renders on each keystroke in the name and DOB fields (they feed Full
  // Name and Age), so React would rebuild those inputs and drop the cursor.
  const F = ({ name, label, type = 'text', required = false, placeholder = '', rules = {} }: any) => (
    <div key={name}>
      <label className="text-xs font-semibold muted">{label}{required && ' *'}</label>
      <input className="input mt-1" type={type} autoComplete="off"
        placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        {...register(name, { ...(required ? { required: 'Required' } : {}), ...rules })} />
      {errors[name] && <span className="text-xs text-red-500">{String((errors[name] as any)?.message || 'Required')}</span>}
    </div>
  );

  // A dropdown-backed field — values stay text, but the user picks from a list
  // (or types a custom one via allowCustom).
  const SelectField = ({ name, label, options, placeholder = 'Select…', required = true, allowCustom = true }: any) => (
    <div key={name}>
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
          {F({ name: 'first_name', label: 'First Name', required: true })}
          {F({ name: 'middle_name', label: 'Middle Name', required: true })}
          {F({ name: 'last_name', label: 'Last Name', required: true })}
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
          {F({ name: 'nationality', label: 'Nationality', required: true })}
        </div>
      </section>

      {/* Academic */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Academic</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SelectField({ name: 'year_grade', label: 'Year / Grade', placeholder: 'Select year / grade…', options: masters.year_grades })}
          {SelectField({ name: 'school_name', label: 'School', placeholder: 'Select school…', options: masters.schools })}
          {SelectField({ name: 'exam_board', label: 'Exam Board', placeholder: 'Select exam board…', options: masters.exam_boards })}
        </div>
      </section>

      {/* Family — each contact beside their own number */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-1">Family *</h4>
        <p className="muted text-xs mb-3">At least one — father, mother or guardian — with their mobile number.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {F({ name: 'father_name', label: 'Father Name' })}
          {F({ name: 'father_mobile', label: 'Father Mob No', type: 'tel' })}
          {F({ name: 'mother_name', label: 'Mother Name' })}
          {F({ name: 'mother_mobile', label: 'Mother Mob No', type: 'tel' })}
          {F({ name: 'guardian_name', label: 'Guardian Name' })}
          {F({ name: 'guardian_mobile', label: 'Guardian Mob No', type: 'tel' })}
        </div>
        {familyError && <div className="text-xs text-red-500 font-medium mt-2">{familyError}</div>}
      </section>

      {/* Contact — the student's own */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Contact</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {F({ name: 'email', label: 'Student Email id', type: 'email', required: true, rules: { pattern: { value: EMAIL_RE, message: 'Enter a valid email' } } })}
          {F({ name: 'student_mobile', label: 'Student Mob No', type: 'tel', required: true })}
          {F({ name: 'extra_mobile', label: 'Extra Mob No 2', type: 'tel' })}
        </div>
      </section>

      {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
      <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
