import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, UserPlus, CheckCircle2, FileSpreadsheet, LogIn, LogOut, Inbox } from 'lucide-react';
import { api, dubaiNow } from '../api/client';
import { useAnchoredMenu } from './anchoredMenu';

/**
 * The bell — everything this person has been sent, in one place.
 *
 * It reads the same notification_log the push notifications are written to, so
 * there is no second list and no second decision about who hears what. That also
 * means it works for the many people who never turn push on: the notice is there
 * the next time they open the app. The push only makes it arrive sooner.
 *
 * Opening it marks what is showing as read, which is what clears the number.
 * The notices themselves stay until the person clears them — and clearing hides
 * rather than deletes, like everything else here.
 */

const ICONS: Record<string, any> = {
  registration_new: UserPlus,
  registration_approved: CheckCircle2,
  hours_statement: FileSpreadsheet,
  check_in: LogIn,
  check_out: LogOut,
};

type Notice = {
  id: number;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  created_at: string;
  seen: number;
};

/**
 * "4:02 PM", "Yesterday", "23 Sep" — against the institute's clock, never the
 * device's, so a phone left on another country's time does not say a class this
 * afternoon happened tomorrow.
 */
function whenText(ts: string): string {
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const then = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
  const now = dubaiNow();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const clock = `${((Number(hh) + 11) % 12) + 1}:${mm} ${Number(hh) < 12 ? 'AM' : 'PM'}`;
  if (then >= midnight) return clock;
  if (then >= new Date(midnight.getTime() - 86400000)) return `Yesterday, ${clock}`;
  return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]}`;
}

export function NotificationBell({ label }: { label?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredMenu(open, btnRef, 340, 'right', 420);
  const qc = useQueryClient();
  const nav = useNavigate();

  // The count is polled; the list is only fetched once the bell is opened, so
  // the minute-by-minute cost is one counted index read and nothing else.
  const count = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api.get('/notifications/count').then((r) => Number(r.data.count) || 0),
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data.data as Notice[]),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/notifications/read', {}),
    onSuccess: () => qc.setQueryData(['notifications-count'], 0),
  });
  const clearAll = useMutation({
    mutationFn: () => api.post('/notifications/clear', {}),
    onSuccess: () => {
      qc.setQueryData(['notifications-count'], 0);
      qc.setQueryData(['notifications'], []);
    },
  });

  // Opening it is what counts as having looked. Sent once per opening, and only
  // when there is something unread, so idly opening the bell is not a write.
  useEffect(() => {
    if (open && (count.data || 0) > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Click anywhere else closes it — but not a click inside the panel itself,
  // which is in a portal and so is not a DOM descendant of the button.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current?.contains(t) || t.closest?.('[data-notification-panel]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const unread = count.data || 0;

  const go = (n: Notice) => {
    setOpen(false);
    if (n.url) nav(n.url);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={unread > 0 ? `${unread} new notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        aria-label="Notifications"
        className={`btn-ghost ${label ? 'flex-1' : ''} !px-2 grid place-items-center relative`}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 inline-flex items-center justify-center h-[17px] min-w-[17px] px-1 text-[10px] font-bold leading-none text-white rounded-full tabular-nums"
            style={{ background: 'var(--color-primary)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            data-notification-panel
            // data-anchored-menu: scrolling the list inside is not the page
            // moving, so the panel stays put instead of re-measuring per notch.
            data-anchored-menu
            className="fixed z-[60] card shadow-lg overflow-hidden flex flex-col animate-fade-in"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: 340, maxHeight: pos.maxHeight }}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
              <span className="font-bold text-sm">Notifications</span>
              {(list.data?.length || 0) > 0 && (
                <button
                  className="text-xs font-semibold muted hover:text-[var(--color-primary)]"
                  disabled={clearAll.isPending}
                  onClick={() => clearAll.mutate()}
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="overflow-y-auto">
              {list.isLoading ? (
                <div className="px-4 py-8 text-center text-sm muted">Loading…</div>
              ) : (list.data?.length || 0) === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Inbox size={26} className="mx-auto mb-2 muted opacity-60" />
                  <div className="text-sm muted">Nothing yet.</div>
                </div>
              ) : (
                list.data!.map((n) => {
                  const Icon = ICONS[n.kind] || Bell;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => go(n)}
                      className="w-full text-left flex gap-3 px-4 py-3 border-b last:border-b-0 transition-colors hover:bg-[var(--color-card-alt)]"
                      style={{
                        borderColor: 'var(--color-border)',
                        // Unread stays tinted until the next time the panel is
                        // opened, so what is new is still visible after the
                        // number itself has gone.
                        background: n.seen ? undefined : 'var(--color-card-alt)',
                      }}
                    >
                      <span className="grid place-items-center w-8 h-8 rounded-full shrink-0 mt-0.5"
                        style={{ background: 'var(--color-card)', color: 'var(--color-primary)' }}>
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="font-semibold text-sm truncate flex-1">{n.title}</span>
                          <span className="text-[11px] muted shrink-0">{whenText(n.created_at)}</span>
                        </span>
                        <span className="block text-xs muted mt-0.5">{n.body}</span>
                      </span>
                      {!n.seen && (
                        <span className="w-2 h-2 rounded-full shrink-0 mt-2" style={{ background: 'var(--color-primary)' }} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
