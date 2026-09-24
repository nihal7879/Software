import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import { codeFromScan, PENDING_SCAN } from '../lib/qr';

/**
 * Where the printed QR points. Scanning it with the phone camera lands here:
 * the code is put aside, and the student carries on through whatever login they
 * already have. The check-in screen picks the code up and sends it.
 */
export default function Scan() {
  const [params] = useSearchParams();
  const { user, loading } = useAuth();

  useEffect(() => {
    const code = codeFromScan(params.get('c') || '');
    if (code) localStorage.setItem(PENDING_SCAN, code);
  }, [params]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'student') return <Navigate to="/student/checkin" replace />;
  // Anybody else scanned it out of curiosity: send them home.
  return <Navigate to="/" replace />;
}
