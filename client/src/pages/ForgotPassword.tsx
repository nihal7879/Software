import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check, Phone } from 'lucide-react';
import { AuthHero } from '../components/AuthHero';
import { Logo } from '../components/Logo';
import { api } from '../api/client';

/**
 * Forgotten password, in two steps: a code to the email on file, then a password
 * the system makes up.
 *
 * IT ASKS FOR THE USERNAME, not the email, and that is deliberate. Thirty
 * addresses on file belong to more than one account — two children and their
 * father on one Gmail — so an address does not say whose password to reset. The
 * username is the only thing that is unique.
 *
 * Most accounts have no email saved at all today, and those are told to ring the
 * office rather than left waiting for a code that is never coming.
 */
export default function ForgotPassword() {
  const [step, setStep] = useState<'ask' | 'code' | 'done'>('ask');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // The "there is no email on file, ring the office" case: not a failure of
  // theirs, and shown as guidance rather than in red.
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot', { username: username.trim().toLowerCase() });
      setSentTo(data.sent_to || '');
      setStep('code');
    } catch (err: any) {
      const d = err.response?.data;
      if (d?.code === 'NO_EMAIL' || d?.code === 'MAIL_FAILED') setNotice(d.error);
      else setError(d?.error || 'Could not send a code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const useCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot/reset', { username: username.trim().toLowerCase(), otp });
      setPassword(data.password);
      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.error || 'That code did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* an older browser, or permission refused — the password is on screen anyway */
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <AuthHero />

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Logo height={29} className="lg:hidden mb-6" />

          {/* ---- step 1: who are you ---------------------------------------- */}
          {step === 'ask' && (
            <>
              <div className="eyebrow mb-2">Forgotten password</div>
              <h2 className="font-display text-3xl font-semibold mb-1.5">Get back in</h2>
              <p className="muted text-sm mb-8">
                Type your username and we will email a code to the address saved for your account.
              </p>

              <form onSubmit={sendCode} className="space-y-4">
                <div>
                  <label className="text-sm font-semibold">Username</label>
                  <input
                    className="input mt-1.5"
                    type="text"
                    placeholder="e.g. aarav.shah"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  {/* Said before they get it wrong, not after. */}
                  <p className="muted text-xs mt-1.5">
                    Your username, not your email — one email can belong to a whole family.
                  </p>
                </div>
                {notice && (
                  <div className="text-sm rounded-lg px-3 py-2.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 flex gap-2">
                    <Phone size={16} className="shrink-0 mt-0.5" />
                    <span>{notice}</span>
                  </div>
                )}
                {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
                <button className="btn-primary w-full !py-3" disabled={busy || !username.trim()}>
                  {busy ? 'Sending…' : 'Send me a code'}
                </button>
              </form>
            </>
          )}

          {/* ---- step 2: the code ------------------------------------------- */}
          {step === 'code' && (
            <>
              <div className="eyebrow mb-2">Check your email</div>
              <h2 className="font-display text-3xl font-semibold mb-1.5">Enter the code</h2>
              <p className="muted text-sm mb-8">
                {sentTo
                  ? <>A six-digit code is on its way to <b>{sentTo}</b>. It works for 10 minutes.</>
                  : <>If that login exists and has an email saved, a six-digit code is on its way. It works for 10 minutes.</>}
              </p>

              <form onSubmit={useCode} className="space-y-4">
                <div>
                  <label className="text-sm font-semibold">Six-digit code</label>
                  <input
                    className="input mt-1.5 text-center text-2xl tracking-[0.4em] font-semibold"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    autoFocus
                    placeholder="------"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
                <button className="btn-primary w-full !py-3" disabled={busy || otp.length < 6}>
                  {busy ? 'Checking…' : 'Set a new password'}
                </button>
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => { setStep('ask'); setOtp(''); setError(''); }}
                >
                  <ArrowLeft size={15} /> Use a different username
                </button>
              </form>
            </>
          )}

          {/* ---- step 3: the password, shown once ---------------------------- */}
          {step === 'done' && (
            <>
              <div className="eyebrow mb-2">Done</div>
              <h2 className="font-display text-3xl font-semibold mb-1.5">Your new password</h2>
              <p className="muted text-sm mb-6">
                Write this down now — it is shown once and is not in any email.
              </p>

              <div className="card p-5 mb-4">
                <div className="text-xs muted mb-1">Username</div>
                <div className="font-semibold mb-4">{username.trim().toLowerCase()}</div>
                <div className="text-xs muted mb-1">Password</div>
                <div className="flex items-center gap-2">
                  <code className="text-2xl font-semibold tracking-wide flex-1 break-all">{password}</code>
                  <button type="button" className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={copy}>
                    {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                  </button>
                </div>
              </div>

              <div className="text-sm rounded-lg px-3 py-2.5 mb-5 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                Sign in with this, and the app will ask you to choose a password of your own.
              </div>

              <Link to="/login" className="btn-primary w-full !py-3 justify-center">Sign in →</Link>
            </>
          )}

          {step !== 'done' && (
            <div className="text-center mt-6">
              <Link to="/login" className="text-sm muted hover:text-[var(--color-primary)]">← Back to sign in</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
