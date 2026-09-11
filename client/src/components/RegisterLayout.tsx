import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { AuthHero } from './AuthHero';
import { api } from '../api/client';
import { usernameProblem, passwordProblem, PASSWORD_MIN } from '../lib/credentials';
import { passwordTip } from '../lib/passwordTip';

// The frame every registration page shares — the sign-in screen's photo panel on
// the left, the form on the right, and a way back to sign-in underneath. Each
// role (student, parent, teacher) has its own page and link, so nobody reaches a
// form that asks them to pick a role they are not.
export function RegisterLayout({
  eyebrow,
  title,
  subtitle,
  children,
  showSignInLink = true,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Off on a finished page that carries its own "Back to sign in" button. */
  showSignInLink?: boolean;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <AuthHero />

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 text-2xl font-display font-bold mb-6" style={{ color: 'var(--color-primary)' }}>
            <GraduationCap size={24} /> STEM Vision
          </div>
          <div className="eyebrow mb-2">{eyebrow}</div>
          <h2 className="font-display text-3xl font-semibold mb-1.5">{title}</h2>
          {subtitle && <p className="muted text-sm mb-8">{subtitle}</p>}

          {children}

          {showSignInLink && (
            <div className="mt-5 text-sm">
              Already registered?{' '}
              <Link to="/login" className="font-semibold" style={{ color: 'var(--color-primary)' }}>Back to sign in</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type FieldOpts = { type?: string; placeholder?: string; required?: boolean; rules?: any };

// A labelled input bound to react-hook-form. It returns a function to *call*,
// not a component to render as <Field/>: a component created inside a page is
// a new type on every render, so React would rebuild the input and drop the
// cursor whenever validation re-renders the form.
export function makeField(register: UseFormRegister<any>, errors: FieldErrors<any>) {
  return (name: string, label: string, opts: FieldOpts = {}) => {
    const required = opts.required !== false;
    return (
      <div key={name}>
        <label className="text-sm font-semibold">{label}{required && ' *'}</label>
        <input
          className="input mt-1.5"
          type={opts.type || 'text'}
          autoComplete="off"
          placeholder={opts.placeholder || `Enter ${label.toLowerCase()}`}
          {...register(name, { ...(required ? { required: 'Required' } : {}), ...(opts.rules || {}) })}
        />
        {errors[name] && <span className="text-xs text-red-500">{String((errors[name] as any)?.message || 'Required')}</span>}
      </div>
    );
  };
}

// Asks the server whether a username is free. Shared by the live indicator and
// the submit-time rule so both give the same answer.
async function isUsernameFree(username: string): Promise<boolean> {
  const r = await api.get('/auth/username-available', { params: { username } });
  return !!r.data.available;
}

type Check = 'idle' | 'checking' | 'available' | 'taken' | 'error';

/**
 * The username people sign in with — the same on every registration page.
 *
 * Checked while they type (half a second after they stop), so a taken name is
 * flagged straight away instead of after the whole form is filled in. The same
 * check runs again as a validation rule on submit, so Register cannot go ahead
 * with a taken name even if the live check had not answered yet. Declared at
 * module level, so it is one stable component and keeps the cursor on re-render.
 */
export function UsernameField({
  register,
  errors,
  value,
}: {
  register: UseFormRegister<any>;
  errors: FieldErrors<any>;
  /** The current value, from watch('username'). */
  value?: string;
}) {
  const [check, setCheck] = useState<Check>('idle');
  const latest = useRef('');

  useEffect(() => {
    const u = String(value ?? '').trim().toLowerCase();
    latest.current = u;
    if (usernameProblem(u)) { setCheck('idle'); return; }
    setCheck('checking');
    const t = setTimeout(() => {
      isUsernameFree(u)
        // Only the answer for what is in the box now counts — a slow reply for
        // something typed earlier must not overwrite it.
        .then((free) => { if (latest.current === u) setCheck(free ? 'available' : 'taken'); })
        .catch(() => { if (latest.current === u) setCheck('error'); });
    }, 450);
    return () => clearTimeout(t);
  }, [value]);

  const u = String(value ?? '').trim().toLowerCase();
  const fieldError = errors.username ? String((errors.username as any)?.message || 'Required') : '';

  return (
    <div>
      <label className="text-sm font-semibold">Username *</label>
      <input
        className={`input mt-1.5 ${check === 'taken' && !fieldError ? '!border-red-500' : check === 'available' && !fieldError ? '!border-emerald-500' : ''}`}
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="e.g. aarav.shah"
        {...register('username', {
          required: 'Required',
          setValueAs: (v: string) => String(v ?? '').trim().toLowerCase(),
          validate: async (v: string) => {
            const rule = usernameProblem(v);
            if (rule) return rule;
            try {
              return (await isUsernameFree(v)) || 'This username is already taken — please choose another';
            } catch {
              return true; // the server checks again on register, so an outage here must not block the form
            }
          },
        })}
      />
      {/* A line is always reserved here, so the status appearing or changing
          as the person types never pushes the fields below it around. */}
      <div className="min-h-[18px] leading-[18px]">
      {fieldError ? (
        <span className="text-xs text-red-500">{fieldError}</span>
      ) : check === 'checking' ? (
        <span className="text-xs muted">Checking…</span>
      ) : check === 'available' ? (
        <span className="text-xs text-emerald-600 font-medium">✓ “{u}” is available</span>
      ) : check === 'taken' ? (
        <span className="text-xs text-red-500 font-medium">✗ “{u}” is already taken — please choose another</span>
      ) : u && usernameProblem(u) ? (
        // Say which rule it breaks as soon as it breaks one, not only on submit.
        <span className="text-xs text-red-500">{usernameProblem(u)}</span>
      ) : null}
      </div>
    </div>
  );
}

/**
 * Password + confirm, the same on every registration page. Nothing is written
 * under a good password; a simple one gets a suggestion of what to add.
 */
export function PasswordFields({
  register,
  errors,
  getValues,
  password,
  username,
}: {
  register: UseFormRegister<any>;
  errors: FieldErrors<any>;
  getValues: (name: string) => any;
  /** Current values, from watch(). */
  password?: string;
  username?: string;
}) {
  const tip = passwordTip(String(password ?? ''), username);
  const err = (n: string) => (errors[n] ? String((errors[n] as any)?.message || 'Required') : '');

  return (
    <>
      <div>
        <label className="text-sm font-semibold">Password *</label>
        <input
          className="input mt-1.5"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${PASSWORD_MIN} characters, with a letter and a number`}
          {...register('password', {
            required: 'Required',
            validate: (v: string) => passwordProblem(v, getValues('username')) || true,
          })}
        />
        {/* Reserved line — the suggestion comes and goes without moving anything. */}
        <div className="min-h-[18px] leading-[18px]">
          {err('password')
            ? <span className="text-xs text-red-500">{err('password')}</span>
            : tip && <span className="text-xs text-amber-600 dark:text-amber-400">{tip}</span>}
        </div>
      </div>
      <div>
        <label className="text-sm font-semibold">Confirm Password *</label>
        <input
          className="input mt-1.5"
          type="password"
          autoComplete="new-password"
          placeholder="Type the password again"
          {...register('confirm_password', {
            required: 'Required',
            validate: (v: string) => v === getValues('password') || 'Passwords do not match',
          })}
        />
        {err('confirm_password') && <span className="text-xs text-red-500">{err('confirm_password')}</span>}
      </div>
    </>
  );
}
