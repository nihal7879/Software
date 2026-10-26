import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
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

// ---------------------------------------------------------------------------
// The log — every notice the system has sent, for the office to look back at.
//
// The bell above answers "what have I been told?". This answers a different
// question, and one that gets asked: "was that parent ever told?" The push may
// have failed, the phone may never have been turned on for it, and nobody can
// tell from the outside — so what was sent, to whom, and whether it reached a
// device is all kept and all readable here.
//
// Grouped the way the office thinks about it rather than by the kind column:
// the money (anything waiting on the super admin, and the statements that go
// out), the new people (someone registered, someone was approved), and the
// classes (who checked in and out). A kind that belongs to none of them still
// shows under "Everything", so nothing can be sent and never appear.
// ---------------------------------------------------------------------------

const TOPICS: Record<string, string[]> = {
  finance: ['approval_request', 'approval_decided', 'hours_statement'],
  login: ['registration_new', 'registration_approved'],
  lecture: ['check_in', 'check_out'],
};

router.get(
  '/log',
  requireRole('admin'),
  wrap(async (req, res) => {
    const topic = String(req.query.topic || 'all');
    const kinds = TOPICS[topic];
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = ["n.kind <> 'test'"];
    const params: any[] = [];
    if (kinds) { where.push('n.kind IN (?)'); params.push(kinds); }
    if (q) {
      where.push(`(n.title LIKE ? OR n.body LIKE ? OR s.full_name LIKE ? OR s.form_no LIKE ?
                   OR u.email LIKE ? OR u.display_name LIKE ?)`);
      params.push(...Array(6).fill(`%${q}%`));
    }

    // Who it went to. A parent login can be attached to several children, so
    // the name is read with a subquery — joining the parents table would
    // reproduce one notice once per child.
    const rows = await query(
      `SELECT n.id, n.kind, n.title, n.body, n.url, n.status, n.devices, n.error,
              n.created_at, n.student_id, n.user_id,
              u.role AS to_role,
              COALESCE(NULLIF(u.display_name, ''), t.name, st.full_name,
                       (SELECT p.name FROM parents p
                         WHERE p.user_id = u.id AND p.is_deleted = FALSE LIMIT 1),
                       u.email) AS to_name,
              s.full_name AS student_name, s.form_no
         FROM notification_log n
         LEFT JOIN users u ON u.id = n.user_id
         LEFT JOIN teachers t ON t.user_id = u.id
         LEFT JOIN students st ON st.user_id = u.id
         LEFT JOIN students s ON s.id = n.student_id
        WHERE ${where.join(' AND ')}
        ORDER BY n.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // The numbers on the tabs, in one pass rather than a query per tab.
    const tally = await query<any>(
      "SELECT kind, COUNT(*) AS n FROM notification_log WHERE kind <> 'test' GROUP BY kind"
    );
    const counts: Record<string, number> = { all: 0, finance: 0, login: 0, lecture: 0 };
    for (const r of tally) {
      const n = Number(r.n);
      counts.all += n;
      for (const [name, list] of Object.entries(TOPICS)) if (list.includes(r.kind)) counts[name] += n;
    }

    res.json({ data: rows, counts });
  })
);

export default router;
