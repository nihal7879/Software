import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { AuthHero } from '../components/AuthHero';
import { Logo } from '../components/Logo';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { passwordProblem } from '../lib/credentials';

/**
 * The only screen a reset account sees until it has a password of its own.
 *
 * A reset hands out a password the system made up, and that password is in a
 * WhatsApp message or a screenshot within the hour — so it is deliberately
 * temporary. The server sets users.must_change_password, App.tsx shows this
 * instead of every route, and the server clears the flag when a password is
 * actually set.
 *
 * Sign out is the one way past it, because somebody has to be able to leave a
 * shared computer.
 */
export default function ChangePasswordRequired() {
  const { user, refresh, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) return setError('The two new passwords do not match.');
    // The same rules the server applies, so the answer comes without a round trip.
    const weak = passwordProblem(next, user?.email);
    if (weak) return setError(weak);

    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      // The reply carried a fresh token (the change signed every device out,
      // this one included) — api/client.ts has already stored it. Re-reading the
      // account is what clears this screen.
      await refresh();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <AuthHero />

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Logo height={29} className="lg:hidden mb-6" />

          <div className="eyebrow mb-2">One last step</div>
          <h2 className="font-display text-3xl font-semibold mb-1.5">Choose your own password</h2>
          <p className="muted text-sm mb-8">
            The password you just used was made for you, so it should not stay. Pick one only you know.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm font-semibold">The password you signed in with</label>
              <input className="input mt-1.5" type="password" autoComplete="current-password" autoFocus
                value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-semibold">New password</label>
              <input className="input mt-1.5" type="password" autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)} />
              <p className="muted text-xs mt-1.5">At least 8 characters, with a letter and a number.</p>
            </div>
            <div>
              <label className="text-sm font-semibold">New password again</label>
              <input className="input mt-1.5" type="password" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
            <button className="btn-primary w-full !py-3" disabled={busy || !current || !next}>
              {busy ? 'Saving…' : 'Save and continue →'}
            </button>
          </form>

          <button type="button" className="btn-ghost w-full mt-4" onClick={logout}>
            <LogOut size={15} /> Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
