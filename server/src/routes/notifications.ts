import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../middleware/error';

/**
 * The bell — the same notices, read inside the app.
 *
 * It reads notification_log, which utils/push.ts already writes one row of per
 * person per notice. So there is no second system and no second decision about
 * who hears what: anything worth pushing is in the bell, whether the push
 * arrived, failed, or was never sent because that person has no device.
 *
 * That last case is the point. Push is opt-in per device and most people will
 * not turn it on; without the bell, everything we send them goes nowhere. With
 * it, the news always reaches them — the push only makes it arrive sooner.
 *
 * Everyone has one: the office, the super admin, a teacher, a student, a parent.
 * What each of them receives was decided where the event happened.
 */
const router = Router();
router.use(requireAuth);

// 'test' is the buzz that confirms a device works. It is not news, so it stays
// out of the list — it would otherwise be the first thing in everyone's bell.
const FEED = `
  FROM notification_log
 WHERE user_id = ? AND dismissed_at IS NULL AND kind <> 'test'`;

/**
 * How many they have not read. Polled, so it is one counted index read and
 * nothing else — no bodies, no join.
 */
router.get(
  '/count',
  wrap(async (req, res) => {
    const r = await queryOne<any>(`SELECT COUNT(*) AS n ${FEED} AND read_at IS NULL`, [req.user!.userId]);
    res.json({ count: Number(r?.n || 0) });
  })
);

/**
 * The list, newest first. Capped: a bell is the recent past, not an archive, and
 * nobody scrolls to the four hundredth check-in.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
    const rows = await query(
      `SELECT id, kind, title, body, url, created_at, read_at IS NOT NULL AS seen
       ${FEED} ORDER BY id DESC LIMIT ${limit}`,
      [req.user!.userId]
    );
    res.json({ data: rows });
  })
);

/**
 * Read — everything, or one.
 *
 * Opening the bell sends this for the whole list, which is what the person means
 * by having looked: the count goes, the notices stay until they clear them.
 */
router.post(
  '/read',
  wrap(async (req, res) => {
    const b = z.object({ id: z.number().int().positive().optional() }).parse(req.body ?? {});
    await query(
      `UPDATE notification_log SET read_at = NOW()
        WHERE user_id = ? AND read_at IS NULL ${b.id ? 'AND id = ?' : ''}`,
      b.id ? [req.user!.userId, b.id] : [req.user!.userId]
    );
    res.json({ ok: true });
  })
);

/**
 * Cleared away — off the list, out of the count, still in the table.
 *
 * "Was this parent told their child checked in?" has to be answerable long
 * after they have tidied their own bell, so this hides rather than deletes —
 * the same rule as everything else here.
 */
router.post(
  '/clear',
  wrap(async (req, res) => {
    const b = z.object({ id: z.number().int().positive().optional() }).parse(req.body ?? {});
    await query(
      `UPDATE notification_log SET dismissed_at = NOW(), read_at = COALESCE(read_at, NOW())
        WHERE user_id = ? AND dismissed_at IS NULL ${b.id ? 'AND id = ?' : ''}`,
      b.id ? [req.user!.userId, b.id] : [req.user!.userId]
    );
    res.json({ ok: true });
  })
);

export default router;
