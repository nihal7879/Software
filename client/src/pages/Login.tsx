import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const DEMO = [
  ['Management', 'admin@tuition.ae'],
  ['Faculty', 'sachin@tuition.ae'],
  ['Student', 'sofia@tuition.ae'],
  ['Parent', 'zelia@tuition.ae'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      {/* Hero panel */}
      <div
        className="hidden lg:flex flex-col justify-center p-14 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #1e2a6e 0%, #161f54 60%, #10173f 100%)' }}
      >
        <div className="absolute -right-24 -top-24 w-80 h-80 rounded-full opacity-20" style={{ background: '#f7a823' }} />
        <div className="absolute -right-10 bottom-10 w-56 h-56 rounded-full opacity-10 bg-white" />
        <div className="relative z-10 max-w-md">
          <div className="inline-flex items-center gap-2 mb-8 font-display font-extrabold text-2xl">
            <span className="grid place-items-center w-11 h-11 rounded-2xl" style={{ background: '#f7a823' }}>🎓</span>
            Tuition<span style={{ color: '#f7a823' }}>ERP</span>
          </div>
          <h1 className="font-display font-extrabold text-4xl leading-tight mb-4">
            Empowering Education<br />through <span style={{ color: '#f7a823' }}>Innovation</span>
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
          <div className="lg:hidden text-2xl font-display font-extrabold mb-6" style={{ color: 'var(--color-primary)' }}>🎓 TuitionERP</div>
          <h2 className="font-display text-3xl font-extrabold mb-1">Welcome back</h2>
          <p className="muted text-sm mb-8">Sign in to your dashboard</p>

          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <div>
              <label className="text-sm font-semibold">Email</label>
              <input className="input mt-1.5" type="email" placeholder="Enter email" autoComplete="off"
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

          <div className="mt-8 text-xs muted">
            <div className="mb-2 font-semibold">Demo accounts · password <code className="px-1.5 py-0.5 rounded bg-[var(--color-card-alt)]">password123</code></div>
            <div className="flex flex-wrap gap-2">
              {DEMO.map(([role, em]) => (
                <button key={em} className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { setEmail(em); setPassword('password123'); }}>
                  {role}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
