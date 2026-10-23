import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, Users, ChevronRight } from 'lucide-react';
import { AuthHero, AuthBanner } from '../components/AuthHero';
import { useAuth, type AccountChoice } from '../auth/AuthContext';

export default function Login() {
  const { login, selectAccount } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const timedOut = new URLSearchParams(window.location.search).get('reason') === 'timeout';
  const [error, setError] = useState('');
  // A registered student who is not approved yet is not a failed sign-in, so
  // their notice is shown as information rather than as an error.
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when the email opened more than one account — a parent with several
  // children, or siblings sharing an email — and one has to be chosen.
  const [choice, setChoice] = useState<{ ticket: string; options: AccountChoice[] } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPending('');
    setBusy(true);
    try {
      const r = await login(email, password);
      if (!r.signedIn) setChoice({ ticket: r.ticket, options: r.options });
    } catch (err: any) {
      const d = err.response?.data;
      // Not failures, but instructions: waiting for approval, or an email shared
      // by siblings that has to be swapped for the username.
      if (d?.registration_status === 'Pending' || d?.code === 'EMAIL_SHARED') setPending(d.error);
      else setError(d?.error || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (index: number) => {
    if (!choice) return;
    setError(''); setBusy(true);
    try {
      await selectAccount(choice.ticket, index);
    } catch (err: any) {
      // An expired pass (they waited too long) sends them back to the form.
      setError(err.response?.data?.error || 'Could not sign in. Please try again.');
      setChoice(null);
    } finally {
      setBusy(false);
    }
  };

  // Parents choose a child; anyone else a whole account.
  const allParents = !!choice && choice.options.every((o) => o.role === 'parent');

  return (
    <div className="min-h-screen flex flex-col lg:grid lg:grid-cols-2">
      <AuthHero />
      <AuthBanner />

      {/* Form panel. Below lg it is a sheet pulled up over the banner's edge. */}
      <div className="flex-1 relative -mt-8 lg:mt-0 rounded-t-[2rem] lg:rounded-none flex items-start lg:items-center justify-center px-6 pt-8 pb-10 lg:p-6"
        style={{ background: 'var(--color-bg)' }}>
        <div className="w-full max-w-md">
          {choice ? (
            <div>
              <div className="eyebrow mb-2">One more step</div>
              <h2 className="font-display text-3xl font-semibold mb-1.5">
                {allParents ? 'Which child?' : 'Choose an account'}
              </h2>
              <p className="muted text-sm mb-6">
                {allParents
                  ? 'Your sign-in is linked to more than one child. Pick whose details to open.'
                  : 'This email is used by more than one account. Pick the one you want to open.'}
              </p>
              <div className="space-y-2">
                {choice.options.map((o) => (
                  <button
                    key={o.index}
                    type="button"
                    disabled={busy}
                    onClick={() => choose(o.index)}
                    className="card w-full p-4 flex items-center gap-3 text-left transition hover:shadow-md hover:border-[var(--color-primary)] disabled:opacity-60"
                  >
                    <span className="grid place-items-center w-10 h-10 rounded-full shrink-0" style={{ background: 'var(--color-card-alt)', color: 'var(--color-primary)' }}>
                      {o.role === 'parent' ? <Users size={18} /> : <UserRound size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold truncate">{o.label}</span>
                      <span className="block text-xs muted truncate">{o.sub}</span>
                    </span>
                    <ChevronRight size={18} className="muted shrink-0" />
                  </button>
                ))}
              </div>
              {error && <div className="text-sm text-red-500 font-medium mt-3">{error}</div>}
              <button type="button" className="btn-ghost w-full mt-4" onClick={() => { setChoice(null); setError(''); }}>
                ← Back
              </button>
            </div>
          ) : (
          <>
          <div className="eyebrow mb-2">Welcome Back</div>
          <h2 className="font-display text-[1.75rem] sm:text-3xl font-semibold mb-1.5">Sign in to <span className="accent-word">STEM Vision</span></h2>
          <p className="muted text-sm mb-6 sm:mb-8">Access your dashboard to continue.</p>

          {timedOut && (
            <div className="mb-4 text-sm rounded-lg px-3 py-2 bg-amber-500/15 text-amber-700 dark:text-amber-400">
              You were signed out after a spell of inactivity. Please sign in again.
            </div>
          )}
          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <div>
              <label className="text-sm font-semibold">Username or email</label>
              <input className="input mt-1.5 !py-3 lg:!py-2" type="text" placeholder="Enter username or email" autoComplete="off"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-semibold">Password</label>
                <Link to="/forgot-password" className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
                  Forgotten password?
                </Link>
              </div>
              {/* No show/hide toggle — the client asked for the password to stay masked. */}
              <input className="input mt-1.5 !py-3 lg:!py-2" type="password" placeholder="Enter password" autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {pending && (
              <div className="text-sm rounded-lg px-3 py-2 bg-amber-500/15 text-amber-700 dark:text-amber-400">{pending}</div>
            )}
            {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
            <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
          </form>
          </>
          )}


        </div>
      </div>
    </div>
  );
}







































