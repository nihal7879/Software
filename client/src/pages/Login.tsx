import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const timedOut = new URLSearchParams(window.location.search).get('reason') === 'timeout';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Hero panel — classroom photo with a dark overlay for legible text */}
      <div
        className="hidden lg:flex flex-col justify-center p-14 text-white relative overflow-hidden bg-cover bg-center"
        style={{
          backgroundImage:
            'linear-gradient(160deg, rgba(40,30,20,0.55) 0%, rgba(60,40,25,0.45) 50%, rgba(30,22,16,0.7) 100%), url(https://images.unsplash.com/photo-1606761568499-6d2451b23c66?auto=format&fit=crop&w=1400&q=80)',
        }}
      >
        <div className="relative z-10 max-w-md">
          <div className="inline-flex items-center gap-2.5 mb-10 font-display font-semibold text-2xl">
            <span className="grid place-items-center w-11 h-11 rounded-xl" style={{ background: '#f97316' }}>
              <GraduationCap size={24} />
            </span>
            STEM<span style={{ color: '#fdba74' }}>Vision</span>
          </div>
          <h1 className="font-display text-[2.75rem] font-semibold leading-[1.1] mb-5">
            Empowering Education<br />through <span style={{ color: '#fdba74' }}>Innovation</span>
          </h1>
          <p className="text-white/70 text-lg mb-10">
            Students, parents, faculty &amp; management — hours, fees and progress, all in one place.
          </p>
          <div className="space-y-3">
            <div className="pill !bg-white/10 px-5 py-3.5 text-sm text-white/90">
              <b className="text-white">Prepaid hours</b> tracked live — purchased, consumed &amp; remaining.
            </div>
            <div className="pill !bg-white/10 px-5 py-3.5 text-sm text-white/90 ml-6">
              <b className="text-white">Smart ledger</b> flags pending fees automatically.
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 text-2xl font-display font-bold mb-6" style={{ color: 'var(--color-primary)' }}>
            <GraduationCap size={24} /> STEM Vision
          </div>
          <div className="eyebrow mb-2">Welcome Back</div>
          <h2 className="font-display text-3xl font-semibold mb-1.5">Sign in to <span className="accent-word">STEM Vision</span></h2>
          <p className="muted text-sm mb-8">Access your dashboard to continue.</p>

          {timedOut && (
            <div className="mb-4 text-sm rounded-lg px-3 py-2 bg-amber-500/15 text-amber-700 dark:text-amber-400">
              You were signed out after 20 minutes of inactivity. Please sign in again.
            </div>
          )}
          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <div>
              <label className="text-sm font-semibold">Username</label>
              <input className="input mt-1.5" type="text" placeholder="Enter username or email" autoComplete="off"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-semibold">Password</label>
              <input className="input mt-1.5" type="password" placeholder="Enter password" autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <div className="text-sm text-red-500 font-medium">{error}</div>}
            <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
          </form>

          <div className="mt-5 text-sm">
            New here?{' '}
            <Link to="/register" className="font-semibold" style={{ color: 'var(--color-primary)' }}>
              Register →
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
