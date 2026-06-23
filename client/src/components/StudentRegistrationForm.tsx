import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../api/client';

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
  submitLabel = 'Save & Submit to Management',
}: {
  studentId: number;
  initial?: any;
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<any>({ values: initial });
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

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      {/* Identity */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Personal Details</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="first_name" label="First Name" required />
          <F name="middle_name" label="Middle Name" />
          <F name="last_name" label="Last Name" />
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold muted">Full Name (auto)</label>
            <input className="input mt-1 opacity-70" value={fullName} readOnly />
          </div>
          <div>
            <label className="text-xs font-semibold muted">Gender</label>
            <select className="input mt-1" {...register('gender')}>
              <option value="">—</option><option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <F name="dob" label="DOB" type="date" />
          <div>
            <label className="text-xs font-semibold muted">Age (auto)</label>
            <input className="input mt-1 opacity-70" value={age} readOnly />
          </div>
          <F name="nationality" label="Nationality" />
        </div>
      </section>

      {/* Academic */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Academic</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="year_grade" label="Year / Grade" placeholder="Y11" />
          <F name="school_name" label="School" />
          <F name="exam_board" label="Exam Board" placeholder="IB / IAL / AQA" />
        </div>
      </section>

      {/* Family */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Family</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="father_name" label="Father Name" />
          <F name="mother_name" label="Mother Name" />
          <div>
            <label className="text-xs font-semibold muted">Relationship (who pays)</label>
            <select className="input mt-1" {...register('relationship')}>
              <option value="">—</option><option>Father</option><option>Mother</option><option>Guardian</option>
            </select>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h4 className="font-display font-bold accent-underline mb-3">Contact</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <F name="email" label="Email id" type="email" />
          <F name="student_mobile" label="Student Mob No" />
          <F name="parent_mobile" label="Parent Mob No" />
          <F name="extra_mobile" label="Extra Mob No 2" />
        </div>
      </section>

      {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
      <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
