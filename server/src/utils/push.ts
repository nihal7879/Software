import webpush from 'web-push';
import { config } from '../config';
import { query } from '../db';

/**
 * Web push — the notification that arrives on a phone or a laptop with the app
 * closed, and the record of every one we sent (notification_log).
 *
 * Shaped like utils/audit.ts and utils/mailer.ts on purpose: one call, it never
 * throws into the caller, and a failure is written down instead. A check-in must
 * not fail because a parent's old phone has stopped accepting notifications.
 *
 * WHAT GOES IN THE TEXT. A notification is read off a lock screen by whoever is
 * holding the phone, and it can land on a device whose sign-in expired weeks
 * ago. So: no amounts, no balances, no other family's name. "Your hours
 * statement has been updated" and a tap opens the app, where they sign in and
 * see the figures.
 *
 * WHO GETS IT. Nobody, until they press "Turn on notifications" themselves, on
 * each device. Most people will not, which is why nothing in the app depends on
 * a push having arrived — it is an extra, never the only way something is said.
 */

export type PushKind =
  | 'registration_new'       // → admin + super admin: someone has registered
  | 'registration_approved'  // → the student, and their parents
  | 'hours_statement'        // → the parents: a statement has gone out
  | 'check_in'               // → the teacher, and the parents
  | 'check_out'              // → the parents
  | 'approval_request'       // → the super admin, and the office that asked
  | 'approval_decided'       // → the admin who asked: approved or not
  | 'test';                  // → whoever just pressed "turn on notifications"

export type PushStatus = 'sent' | 'no_device' | 'failed' | 'not_configured';

/** Whether the VAPID pair is set. Empty means push is switched off, not broken. */
export function pushConfigured(): boolean {
  return !!(config.push.publicKey && config.push.privateKey);
}

/** The half of the pair the browser needs in order to subscribe. */
export function pushPublicKey(): string {
  return config.push.publicKey;
}

let ready = false;
function configure() {
  if (ready) return;
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
  ready = true;
}

type Notice = {
  kind: PushKind;
  title: string;
  body: string;
  /** Where tapping it opens — a path, not a full URL, so it works on any host. */
  url?: string;
  studentId?: number | null;
};

async function logNotice(userId: number | null, n: Notice, status: PushStatus, devices: number, error?: string) {
  try {
    await query(
      `INSERT INTO notification_log (kind, user_id, title, body, url, status, devices, error, student_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [n.kind, userId, n.title.slice(0, 160), n.body.slice(0, 255), n.url ?? null, status, devices,
        error ? error.slice(0, 500) : null, n.studentId ?? null]
    );
  } catch (e) {
    console.error('notification_log write failed:', e);
  }
}

/**
 * Send one notice to everyone in `userIds`, on every browser each of them has
 * allowed. Duplicates and nulls are ignored, so callers can pass whatever they
 * have — "the teacher and the parents" is often one id and a list.
 *
 * Awaited by its callers, not fired and forgotten: on Vercel the function can be
 * frozen the moment the response goes out, which would cut off a send still in
 * flight. It is cheap, and it cannot throw.
 */
export async function notify(userIds: (number | null | undefined)[], n: Notice): Promise<void> {
  // Wrapped whole: the comment above has always promised callers this cannot
  // throw, but the subscription lookup is a database read like any other. A
  // payment must not fail to save because the push table was briefly
  // unreachable, and the caller has nothing useful to do with the error.
  try {
    await send(userIds, n);
  } catch (e) {
    console.error('notify failed:', e);
  }
}

async function send(userIds: (number | null | undefined)[], n: Notice): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is number => typeof id === 'number' && id > 0))];
  if (ids.length === 0) return;

  if (!pushConfigured()) {
    // Recorded once for the whole notice, not per person: there is nothing
    // person-specific about "push is not set up".
    await logNotice(ids[0], n, 'not_configured', 0, 'VAPID keys are not set in server/.env');
    return;
  }
  configure();

  const subs = await query<any>(
    `SELECT id, user_id, endpoint, p256dh, auth_key FROM push_subscriptions
      WHERE user_id IN (?) AND is_deleted = FALSE`,
    [ids]
  );

  // The payload the service worker reads. Short: push services cap the message,
  // and Apple's is the strictest.
  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/', kind: n.kind });

  for (const id of ids) {
    const mine = subs.filter((s) => s.user_id === id);
    if (mine.length === 0) {
      // Not a failure — this person has simply never turned notifications on.
      // Worth recording: it is the usual reason a notice "did not arrive".
      await logNotice(id, n, 'no_device', 0);
      continue;
    }
    let delivered = 0;
    const failures: string[] = [];
    for (const s of mine) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
          payload,
          // TTL: a check-in notice is worthless tomorrow, so the push service
          // stops trying after a day rather than queueing it indefinitely.
          { TTL: 24 * 60 * 60 }
        );
        delivered++;
        await query('UPDATE push_subscriptions SET last_sent_at = NOW() WHERE id = ?', [s.id]);
      } catch (e: any) {
        const code = Number(e?.statusCode) || 0;
        // 404/410 is the push service saying this browser is gone — cleared,
        // uninstalled, or notifications turned off in the browser itself. The
        // row is retired rather than retried forever. Soft, like every delete
        // here: what was sent to it still reads in the log.
        if (code === 404 || code === 410) {
          await query('UPDATE push_subscriptions SET is_deleted = TRUE WHERE id = ?', [s.id]);
        } else {
          failures.push(`${code || '?'}: ${String(e?.body || e?.message || e).slice(0, 120)}`);
        }
      }
    }
    await logNotice(
      id, n,
      delivered > 0 ? 'sent' : failures.length > 0 ? 'failed' : 'no_device',
      delivered,
      failures.length ? failures.join(' | ') : undefined
    );
  }
}

// ---------------------------------------------------------------------------
// Who to tell. Each of these answers with user ids, so notify() takes them
// straight — and each filters soft deletes and switched-off logins, because a
// notification to a closed account is a notification to whoever has that phone.
// ---------------------------------------------------------------------------

/** The office and the super admin — for anything waiting to be dealt with. */
export async function adminUserIds(): Promise<number[]> {
  const rows = await query<any>(
    "SELECT id FROM users WHERE role IN ('admin', 'superadmin') AND is_active = TRUE AND is_deleted = FALSE"
  );
  return rows.map((r) => r.id);
}

/**
 * The super admin alone — for the things only they can act on.
 *
 * Separate from adminUserIds() on purpose: an approval request is addressed to
 * the person who can approve it, and sending it to the whole office would put
 * "waiting for your approval" in front of five people who cannot give it.
 */
export async function superAdminUserIds(): Promise<number[]> {
  const rows = await query<any>(
    "SELECT id FROM users WHERE role = 'superadmin' AND is_active = TRUE AND is_deleted = FALSE"
  );
  return rows.map((r) => r.id);
}

/** Every parent login linked to this child. */
export async function parentUserIds(studentId: number): Promise<number[]> {
  const rows = await query<any>(
    `SELECT DISTINCT p.user_id AS id FROM parents p JOIN users u ON u.id = p.user_id
      WHERE p.student_id = ? AND p.is_deleted = FALSE AND u.is_active = TRUE AND u.is_deleted = FALSE`,
    [studentId]
  );
  return rows.map((r) => r.id);
}

/** The student's own login, if they have one. */
export async function studentUserId(studentId: number): Promise<number | null> {
  const r = await query<any>(
    `SELECT s.user_id AS id FROM students s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.is_deleted = FALSE AND u.is_active = TRUE AND u.is_deleted = FALSE`,
    [studentId]
  );
  return r[0]?.id ?? null;
}

/** The teacher's own login, if they have one. */
export async function teacherUserId(teacherId: number): Promise<number | null> {
  const r = await query<any>(
    `SELECT t.user_id AS id FROM teachers t JOIN users u ON u.id = t.user_id
      WHERE t.id = ? AND t.is_deleted = FALSE AND u.is_active = TRUE AND u.is_deleted = FALSE`,
    [teacherId]
  );
  return r[0]?.id ?? null;
}
