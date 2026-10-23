import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { deviceInfo } from '../utils/reqContext';
import { notify, pushConfigured, pushPublicKey } from '../utils/push';

/**
 * Turning notifications on, and off.
 *
 * A subscription belongs to a browser, not to a person: the same parent on their
 * phone and on their laptop is two rows, and allowing it on one says nothing
 * about the other. So every route here is about THIS device.
 *
 * Open to every role — the office, a teacher, a student, a parent. What each of
 * them is actually sent is decided where the event happens, not here.
 */
const router = Router();
router.use(requireAuth);

/**
 * What the browser needs before it can subscribe: the public half of the pair,
 * and whether push is switched on at all. The client asks first, so a server
 * with no keys shows "not set up" instead of a button that cannot work.
 */
router.get(
  '/key',
  wrap(async (_req, res) => {
    res.json({ configured: pushConfigured(), key: pushPublicKey() });
  })
);

const subSchema = z.object({
  endpoint: z.string().trim().url().max(500),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(255),
    auth: z.string().trim().min(1).max(255),
  }),
  // What the person will see when they look at their own devices. Generous:
  // whatever the browser could work out, or nothing.
  device: z.string().trim().max(120).optional().nullable(),
  // Set when the app is re-sending a subscription it already had, after a sign-in
  // — not when somebody pressed the button. No "notifications are on" buzz then:
  // nobody asked for one.
  silent: z.boolean().optional(),
});

/**
 * This browser is allowed to be notified.
 *
 * Writing the same endpoint again is the normal case, not an error: a browser
 * re-subscribes on its own when its keys rotate, and a person may press the
 * button twice. The endpoint is unique, so that updates the one row — and
 * reopens it if it had been retired as gone.
 */
router.post(
  '/subscribe',
  wrap(async (req, res) => {
    const b = subSchema.parse(req.body);
    if (!pushConfigured()) {
      return res.status(503).json({ error: 'Notifications are not set up on the server yet.', code: 'PUSH_OFF' });
    }
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key, device, user_agent)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth_key = VALUES(auth_key),
         device = VALUES(device), user_agent = VALUES(user_agent), is_deleted = FALSE`,
      [req.user!.userId, b.endpoint, b.keys.p256dh, b.keys.auth, b.device?.trim() || null, deviceInfo(req)]
    );
    const row = await queryOne<any>('SELECT id FROM push_subscriptions WHERE endpoint = ?', [b.endpoint]);
    await audit(req.user!.userId, 'PUSH_SUBSCRIBE', 'push_subscription', row?.id ?? 0, null, { device: b.device ?? null });

    // One straight away, so the person knows it worked rather than taking our
    // word for it. It is also the only honest test of the whole chain — browser,
    // push service, service worker — and it costs one message.
    if (!b.silent) {
      await notify([req.user!.userId], {
        kind: 'test',
        title: 'Notifications are on',
        body: 'This is how STEM Vision will reach you on this device.',
        url: '/',
      });
    }
    res.status(201).json({ ok: true });
  })
);

/** This browser, off again. Soft, like every delete here. */
router.post(
  '/unsubscribe',
  wrap(async (req, res) => {
    const b = z.object({ endpoint: z.string().trim().max(500) }).parse(req.body);
    await query(
      'UPDATE push_subscriptions SET is_deleted = TRUE WHERE endpoint = ? AND user_id = ?',
      [b.endpoint, req.user!.userId]
    );
    await audit(req.user!.userId, 'PUSH_UNSUBSCRIBE', 'push_subscription', 0, { endpoint_tail: b.endpoint.slice(-12) }, null);
    res.json({ ok: true });
  })
);

/**
 * The person's own devices, newest first — so "I turned it on at home but my
 * phone is quiet" has an answer on screen. The endpoint and the keys never leave
 * the server; they are this browser's address, not something to display.
 */
router.get(
  '/mine',
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT id, device, created_at, last_sent_at FROM push_subscriptions
        WHERE user_id = ? AND is_deleted = FALSE ORDER BY id DESC`,
      [req.user!.userId]
    );
    res.json({ data: rows, configured: pushConfigured() });
  })
);

export default router;
