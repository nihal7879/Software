import { useEffect, useState } from 'react';
import { Bell, BellOff, Share, Smartphone } from 'lucide-react';
import { disablePush, enablePush, pushState, PUSH_ON_EVENT, type PushState } from '../lib/push';
import { toast } from './Toast';

/**
 * "Turn on notifications", on every role's settings screen.
 *
 * Per device, which is the thing people get wrong: allowing it on the office PC
 * does nothing for the phone in their pocket, so the card says so rather than
 * leaving them to work it out when the phone stays quiet.
 *
 * It explains a refusal instead of disappearing. A card that is simply absent on
 * an iPhone is a support call; a card that says "add it to your home screen
 * first" is two taps.
 */
export function NotificationsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => pushState().then(setState).catch(() => setState('unsupported'));
  useEffect(() => {
    refresh();
    // Turned on from the dashboard strip or by the automatic ask — this card
    // should not still be reading "Off" when they come here afterwards.
    const done = () => { refresh(); };
    window.addEventListener(PUSH_ON_EVENT, done);
    return () => window.removeEventListener(PUSH_ON_EVENT, done);
  }, []);

  const on = state === 'on';

  const flip = async () => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        toast('Notifications turned off for this device');
      } else {
        await enablePush();
        toast('Notifications are on for this device');
      }
      await refresh();
    } catch (e: any) {
      toast(e?.message || 'Could not change notifications', 'error');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // What each situation means, and what the person can do about it. Kept here
  // rather than in lib/push.ts so the wording sits beside the design.
  const copy: Record<PushState, { text: string; action?: string }> = {
    on: { text: 'This device will be notified about registrations, approvals, statements and check-ins.', action: 'Turn off for this device' },
    off: { text: 'Get a notification on this device when something happens — even with the app closed.', action: 'Turn on for this device' },
    blocked: { text: 'Notifications are blocked for this site. Allow them in your browser settings, then reload this page.' },
    'ios-needs-install': { text: 'On an iPhone or iPad, open the Share menu and choose "Add to Home Screen". Open STEM Vision from there, and this button will work.' },
    // Not the person's doing and not the office's either — the keys live on the
    // server. Nobody is sent to chase anyone.
    'not-configured': { text: 'Notifications are not available yet. This is set up on the server — there is nothing you need to do.' },
    unreachable: { text: 'Could not reach STEM Vision just now. Check your connection and reload the page.' },
    unsupported: { text: 'This browser cannot show notifications.' },
  };
  const here = state ? copy[state] : null;

  const icon =
    state === 'ios-needs-install' ? <Share size={20} />
    : on ? <Bell size={20} />
    : <BellOff size={20} />;

  return (
    <div className="card p-5 flex flex-wrap items-center gap-4">
      <span
        className="grid place-items-center w-11 h-11 rounded-full shrink-0"
        style={{ background: 'var(--color-card-alt)', color: on ? '#10b981' : 'var(--color-primary)' }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-bold flex items-center gap-2">
          Notifications on this device
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            on ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--color-card-alt)] muted'
          }`}>
            {state === null ? '…' : on ? 'On' : 'Off'}
          </span>
        </div>
        <p className="muted text-sm">{here?.text ?? 'Checking…'}</p>
        {/* Said once, plainly: it is the question everyone asks second. */}
        {(state === 'on' || state === 'off') && (
          <p className="muted text-xs mt-1 flex items-center gap-1.5">
            <Smartphone size={12} /> Each phone and computer is turned on separately.
          </p>
        )}
      </div>
      {here?.action && (
        <button className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" disabled={busy} onClick={flip}>
          {busy ? 'Working…' : here.action}
        </button>
      )}
    </div>
  );
}
