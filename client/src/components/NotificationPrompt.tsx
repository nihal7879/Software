import { useEffect, useState } from 'react';
import { Bell, Share, X } from 'lucide-react';
import { enablePush, pushState, PUSH_ON_EVENT, type PushState } from '../lib/push';
import { useAuth } from '../auth/AuthContext';
import { toast } from './Toast';

/**
 * "Turn on notifications" — the strip at the top of the dashboard, straight
 * after signing in.
 *
 * WHY THIS EXISTS RATHER THAN SIMPLY ASKING ON LOGIN. The browser's permission
 * box is one shot: if someone taps Block, we can never ask again — only they
 * can undo it, buried in browser settings. And a request that does not come
 * from a tap is ignored outright by Firefox and by Safari, so asking
 * automatically would reach nobody on an iPhone while costing us everyone who
 * blocked a box they were not expecting.
 *
 * So the strip appears by itself, and the browser's box only follows a press.
 * From the person's side it is still "it asked me when I opened the app"; the
 * difference is that it works on every browser and almost nobody says no.
 *
 * It shows only while notifications are off, and "Not now" keeps it quiet for a
 * week rather than for ever — a teacher who was busy on Monday is asked again
 * the following week, and only then.
 */

const SNOOZE_DAYS = 7;
const key = (userId?: number) => `notifyPrompt:${userId ?? 'anon'}`;

/** Per account, so dismissing it on a shared office PC does not hide it for the next person. */
function snoozed(userId?: number): boolean {
  try {
    const until = Number(localStorage.getItem(key(userId)) || 0);
    return until > Date.now();
  } catch {
    // Private window, or storage blocked. Better to show it than to assume.
    return false;
  }
}

function snooze(userId?: number) {
  try {
    localStorage.setItem(key(userId), String(Date.now() + SNOOZE_DAYS * 86400000));
  } catch { /* nothing to do — it will be offered again next time */ }
}

export function NotificationPrompt({ what = 'something happens' }: { what?: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(() => snoozed(user?.id));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hidden) return;
    pushState().then(setState).catch(() => setState('unsupported'));
  }, [hidden]);

  // The automatic ask (lib/push.ts) can succeed a moment after this strip has
  // already decided to show. Then it is no longer wanted.
  useEffect(() => {
    const done = () => setHidden(true);
    window.addEventListener(PUSH_ON_EVENT, done);
    return () => window.removeEventListener(PUSH_ON_EVENT, done);
  }, []);

  // Only two situations are worth interrupting someone for: they can turn it on
  // and have not, or they are on an iPhone and cannot until the app is on their
  // home screen. Blocked, unsupported, or no keys on the server are all things
  // this strip cannot fix, so it stays out of the way and Settings explains.
  const askable = state === 'off';
  const iosFirst = state === 'ios-needs-install';
  if (hidden || (!askable && !iosFirst)) return null;

  const dismiss = () => { snooze(user?.id); setHidden(true); };

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      toast('Notifications are on for this device');
      setHidden(true);
    } catch (e: any) {
      toast(e?.message || 'Could not turn on notifications', 'error');
      // A refusal is not something to ask about again tomorrow.
      snooze(user?.id);
      setHidden(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="card p-4 flex flex-wrap items-center gap-3 border-l-4"
      style={{ borderLeftColor: 'var(--color-primary)' }}
    >
      <span className="grid place-items-center w-10 h-10 rounded-full shrink-0"
        style={{ background: 'var(--color-card-alt)', color: 'var(--color-primary)' }}>
        {iosFirst ? <Share size={18} /> : <Bell size={18} />}
      </span>

      <div className="min-w-0 flex-1">
        {iosFirst ? (
          <>
            <div className="font-bold">Get notifications on this iPhone</div>
            <p className="muted text-sm">
              Tap the Share button, choose <b>Add to Home Screen</b>, then open STEM Vision from
              the new icon — notifications can be turned on from there.
            </p>
          </>
        ) : (
          <>
            <div className="font-bold">Turn on notifications</div>
            <p className="muted text-sm">
              Know as soon as {what} — even when STEM Vision is closed. This device only.
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {askable && (
          <button className="btn-primary !py-1.5 !px-4 text-sm" disabled={busy} onClick={turnOn}>
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        )}
        <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={dismiss}>
          Not now
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="grid place-items-center w-7 h-7 rounded-lg muted hover:bg-[var(--color-card-alt)]"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
