import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QrCode, X } from 'lucide-react';
import { api } from '../api/client';

const SEEN = 'checkin-nudge-shown';
const SHOW_FOR_MS = 15_000;

/**
 * A check-in button at the top of the screen after a student signs in or opens
 * the app on a phone. It stays until they close it, or for 15 seconds.
 *
 * Asked for by the institute: signing in is almost always to check in, and the
 * tab-bar button sits at the bottom, where students were reaching down for it.
 * So it is offered where the eye lands first, then gets out of the way — once
 * per sign-in or opening of the app, not on every page, or it becomes noise.
 *
 * What is remembered is the tail of the sign-in token, in session storage: a
 * new sign-in is a new token and a fresh launch is a fresh session, so either
 * brings it back. If storage is blocked it simply shows on each page.
 */
export function CheckInNudge() {
  const nav = useNavigate();
  const [show, setShow] = useState(() => {
    // Below lg only, matching the tab bar. Checked here rather than left to
    // lg:hidden alone: a sign-in first seen on a wide window used to mark the
    // button as shown, so it never appeared once the window was a phone's.
    if (!window.matchMedia('(max-width: 1023px)').matches) return false;
    try {
      const login = (localStorage.getItem('token') || '').slice(-12);
      if (sessionStorage.getItem(SEEN) === login) return false;
      sessionStorage.setItem(SEEN, login);
    } catch { /* storage blocked: show it anyway */ }
    return true;
  });

  // Same list the check-in page reads, so it can say "check out" when a class
  // is already open rather than send them to check in twice.
  const mine = useQuery({
    queryKey: ['my-checkins'],
    queryFn: () => api.get('/checkin/mine').then((r) => r.data.data as any[]),
    enabled: show,
  });
  const checkedIn = (mine.data || []).some((r: any) => !r.out_at && r.status === 'Pending');

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), SHOW_FOR_MS);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;

  return (
    <div className="lg:hidden mb-4 flex items-center gap-2 animate-fade-in">
      <button
        className="tap flex-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-white font-semibold"
        style={{
          background: 'linear-gradient(135deg,#fb923c,#ea580c)',
          boxShadow: '0 10px 22px -8px rgba(234,88,12,0.6)',
        }}
        onClick={() => { setShow(false); nav('/student/checkin'); }}
      >
        <QrCode size={20} />
        {checkedIn ? 'Scan to check out' : 'Scan to check in'}
      </button>
      <button
        className="tap grid place-items-center w-11 h-11 shrink-0 rounded-2xl"
        style={{ background: 'var(--color-card-alt)' }}
        onClick={() => setShow(false)}
        aria-label="Hide"
      >
        <X size={18} />
      </button>
    </div>
  );
}
