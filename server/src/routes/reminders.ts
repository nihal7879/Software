import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireRole, requireSuperAdmin } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { raiseDueReminders, reminderConfig, clearReminderCache, renderMessage, KEYS } from '../utils/reminders';
// The same expressions Student Hours and the fee ledger read, so the hours on
// this screen cannot drift from the hours on those.
import { CREDITED_EXPR, CONSUMED_EXPR } from '../utils/hoursSummary';

/**
 * The fee-chasing list: every time an active student crosses an hours step,
 * a row lands here with the words the system wrote, and the office works down
 * it — call the parent, type what they said, tick it done.
 *
 * Admin only (S-02, like the fee ledger): it is every family's balance laid
 * out on one page, which is not a teacher's business.
 */
const router = Router();
router.use(requireAuth, requireRole('admin'));

const RANGES: Record<string, number | null> = { '7': 7, '30': 30, all: null };

/**
 * The list, newest first. The client groups it by day.
 *
 * New reminders are raised on the way in rather than by a scheduled job. There
 * is no scheduler on this deployment, and a list that is only correct after a
 * cron ran is a list the office stops trusting. With a few hundred students
 * the scan is a single indexed query; the insert loop does nothing at all on
 * the common case where no one has crossed a step since the last look.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    await raiseDueReminders();

    const state = ['all', 'open', 'done'].includes(String(req.query.state)) ? String(req.query.state) : 'all';
    const rangeKey = Object.prototype.hasOwnProperty.call(RANGES, String(req.query.days)) ? String(req.query.days) : '30';
    const days = RANGES[rangeKey];
    const search = String(req.query.search || '').trim();

    const where: string[] = [
      'r.is_deleted = FALSE',
      's.is_deleted = FALSE',
      // An inactive student drops off the list. The rows stay in the table —
      // nothing is deleted — they simply are not something to chase today.
      "s.is_active = TRUE AND s.status = 'Active'",
    ];
    const params: any[] = [];

    if (days != null) { where.push('r.raised_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'); params.push(days); }
    if (state === 'open') where.push('r.done_at IS NULL');
    if (state === 'done') where.push('r.done_at IS NOT NULL');
    if (search) {
      where.push('(s.full_name LIKE ? OR s.form_no LIKE ? OR s.father_name LIKE ? OR s.mother_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const rows = await query(
      `SELECT r.id, r.student_id, r.tier, r.hours_left, r.message, r.raised_at,
              r.done_at, r.follow_up_id, r.message_edited_at,
              eu.display_name AS message_edited_by_name,
              -- What the balance is NOW, not what it was when the reminder
              -- fired. Somebody about to ring a parent needs the figure that
              -- is true at the moment they dial, and it must be the SAME
              -- number Student Hours shows or the office will stop believing
              -- either screen — so it is the same expression, not a copy.
              ${CREDITED_EXPR} - ${CONSUMED_EXPR} AS hours_now,
              s.form_no, s.full_name, s.year_grade,
              u.display_name AS done_by_name,
              f.note AS note, f.created_at AS note_at,
              nu.display_name AS note_by_name
         FROM reminders r
         JOIN students s ON s.id = r.student_id
         LEFT JOIN users u ON u.id = r.done_by
         LEFT JOIN student_follow_ups f ON f.id = r.follow_up_id AND f.is_deleted = FALSE
         LEFT JOIN users nu ON nu.id = f.created_by
         LEFT JOIN users eu ON eu.id = r.message_edited_by
        WHERE ${where.join(' AND ')}
        ORDER BY r.raised_at DESC, r.id DESC
        LIMIT 500`,
      params
    );

    // The counts behind the three filter buttons, for the whole range rather
    // than the page — the button has to say how many it would show.
    const counts = await queryOne<any>(
      `SELECT COUNT(*) AS total,
              SUM(r.done_at IS NULL) AS open_count
         FROM reminders r
         JOIN students s ON s.id = r.student_id
        WHERE r.is_deleted = FALSE AND s.is_deleted = FALSE
          AND s.is_active = TRUE AND s.status = 'Active'
          ${days != null ? 'AND r.raised_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)' : ''}`,
      days != null ? [days] : []
    );

    res.json({
      data: rows,
      counts: {
        all: Number(counts?.total || 0),
        open: Number(counts?.open_count || 0),
        done: Number(counts?.total || 0) - Number(counts?.open_count || 0),
      },
    });
  })
);

/** How many still need a call — the number on the sidebar. */
router.get(
  '/open-count',
  wrap(async (_req, res) => {
    const row = await queryOne<any>(
      `SELECT COUNT(*) AS n
         FROM reminders r JOIN students s ON s.id = r.student_id
        WHERE r.is_deleted = FALSE AND r.done_at IS NULL
          AND s.is_deleted = FALSE AND s.is_active = TRUE AND s.status = 'Active'`
    );
    res.json({ count: Number(row?.n || 0) });
  })
);

/**
 * The rule itself: when a reminder fires and what it says.
 *
 * Any admin may read it — the screen shows "first warning at 5 hours" so the
 * office knows what it is looking at, and a number nobody can see is a number
 * nobody trusts.
 */
router.get(
  '/config',
  wrap(async (_req, res) => res.json(await reminderConfig()))
);

/**
 * Changing it is the super admin's, like every other institute-wide switch.
 * Moving the first warning from 5 hours to 8 changes who gets chased across
 * the whole institute; that is not a thing one admin should do alone.
 */
router.put(
  '/config',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const b = z
      .object({
        enabled: z.boolean(),
        // Above 40 is most of a package: the warning would fire the day they pay.
        firstHours: z.number().min(0).max(40),
        // At or below zero, or the rule contradicts itself. The test at scan
        // time is "hours_left <= this", so -2 catches -3, -6 and anything worse.
        overdraftFrom: z.number().min(-100).max(0),
        // Generous: these carry the greeting, the request and the reason, and
        // the institute writes longer than a developer expects. setting_value
        // is TEXT now, so the limit is politeness, not storage.
        textFirst: z.string().trim().min(1).max(2000),
        textZero: z.string().trim().min(1).max(2000),
        textOver: z.string().trim().min(1).max(2000),
        // Bank details and sign-off. Changing a bank should be one edit here,
        // not the same block corrected in four places.
        signature: z.string().trim().max(2000),
      })
      .parse(req.body);

    const before = await reminderConfig();
    const pairs: [string, string][] = [
      [KEYS.enabled, b.enabled ? '1' : '0'],
      [KEYS.firstHours, String(b.firstHours)],
      [KEYS.overdraftFrom, String(b.overdraftFrom)],
      [KEYS.textFirst, b.textFirst],
      [KEYS.textZero, b.textZero],
      [KEYS.textOver, b.textOver],
      [KEYS.signature, b.signature],
    ];
    for (const [k, v] of pairs) {
      await query(
        `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [k, v, req.user!.userId]
      );
    }
    clearReminderCache();
    // The audit carries the whole rule as it was, not only what changed: six
    // months later "why was this family chased at 8 hours" is answerable.
    await audit(req.user!.userId, 'EDIT_REMINDER_RULE', 'settings', 0, before, b);
    res.json(await reminderConfig());
  })
);

const find = (id: string) =>
  queryOne<any>('SELECT * FROM reminders WHERE id = ? AND is_deleted = FALSE', [id]);

/**
 * Edit the wording of one reminder before it is sent.
 *
 * The system cannot know the package amount — AED 4200 for 30 hours for most,
 * 2100 for 15, 4200 for 35 for one long-standing family — so the office adds
 * it, along with whatever else a particular parent needs said.
 *
 * The original system wording goes into the audit trail, because a user edit
 * that overwrites something the system recorded must always carry the
 * original. Editing is allowed after the reminder is ticked done as well: the
 * office sometimes tidies what they sent, and refusing would only mean the
 * record and the message drift apart.
 */
router.put(
  '/:id/message',
  wrap(async (req, res) => {
    const b = z
      .object({ message: z.string().trim().min(1, 'The message cannot be empty.').max(4000, 'Please keep the message under 4000 characters.') })
      .parse(req.body);
    const r = await find(req.params.id);
    if (!r) return res.status(404).json({ error: 'Reminder not found' });
    if (b.message === r.message) return res.json({ ok: true, unchanged: true });

    await query('UPDATE reminders SET message = ?, message_edited_at = NOW(), message_edited_by = ? WHERE id = ?', [b.message, req.user!.userId, r.id]);
    await audit(req.user!.userId, 'EDIT_REMINDER_MESSAGE', 'student', r.student_id,
      { reminder_id: r.id, message: r.message, edited_before: r.message_edited_at },
      { message: b.message });
    res.json({ ok: true });
  })
);

/** Put the system's own wording back, using the templates as they stand today. */
router.delete(
  '/:id/message',
  wrap(async (req, res) => {
    const r = await find(req.params.id);
    if (!r) return res.status(404).json({ error: 'Reminder not found' });
    const s = await queryOne<any>('SELECT full_name, form_no FROM students WHERE id = ?', [r.student_id]);
    const cfg = await reminderConfig();
    const message = renderMessage(Number(r.tier), Number(r.hours_left), s, cfg);
    await query('UPDATE reminders SET message = ?, message_edited_at = NULL, message_edited_by = NULL WHERE id = ?', [message, r.id]);
    await audit(req.user!.userId, 'RESET_REMINDER_MESSAGE', 'student', r.student_id, { message: r.message }, { message });
    res.json({ ok: true, message });
  })
);

/**
 * Tick it done.
 *
 * Done means a person SPOKE TO THE PARENT — not that somebody opened the
 * screen. That is the whole reason this is a tick and not a read flag: on a
 * shared front-office login, "read" would be set by the first person to look
 * and the parent would never be called.
 */
router.post(
  '/:id/done',
  wrap(async (req, res) => {
    const r = await find(req.params.id);
    if (!r) return res.status(404).json({ error: 'Reminder not found' });
    if (r.done_at) return res.json({ ok: true, already: true });
    await query('UPDATE reminders SET done_at = NOW(), done_by = ? WHERE id = ?', [req.user!.userId, r.id]);
    await audit(req.user!.userId, 'REMINDER_DONE', 'student', r.student_id, { done_at: null }, { reminder_id: r.id, tier: r.tier });
    res.json({ ok: true });
  })
);

/** Ticked by mistake. The audit carries who had marked it, and when. */
router.delete(
  '/:id/done',
  wrap(async (req, res) => {
    const r = await find(req.params.id);
    if (!r) return res.status(404).json({ error: 'Reminder not found' });
    await query('UPDATE reminders SET done_at = NULL, done_by = NULL WHERE id = ?', [r.id]);
    await audit(req.user!.userId, 'REMINDER_UNDONE', 'student', r.student_id, { done_at: r.done_at, done_by: r.done_by }, { reminder_id: r.id });
    res.json({ ok: true });
  })
);

/**
 * What the parent said.
 *
 * It is written into student_follow_ups — the table Student Hours already
 * reads — and the reminder only points at it. The office types it where they
 * are standing, and it turns up where anyone would look for it later. A second
 * notes system living only on this screen would be a place notes go to be lost.
 */
router.post(
  '/:id/note',
  wrap(async (req, res) => {
    const b = z.object({ note: z.string().trim().min(1, 'Write the note first').max(500, 'Please keep the note under 500 characters.') }).parse(req.body);
    const r = await find(req.params.id);
    if (!r) return res.status(404).json({ error: 'Reminder not found' });

    if (r.follow_up_id) {
      // Editing the note that is already on the student, not writing a second
      // one — the office is correcting what they typed a minute ago.
      const before = await queryOne<any>('SELECT * FROM student_follow_ups WHERE id = ? AND is_deleted = FALSE', [r.follow_up_id]);
      if (before) {
        await query('UPDATE student_follow_ups SET note = ? WHERE id = ?', [b.note, r.follow_up_id]);
        await audit(req.user!.userId, 'EDIT_FOLLOW_UP', 'student', r.student_id, before, { note: b.note, from_reminder: r.id });
        return res.json({ ok: true, follow_up_id: r.follow_up_id });
      }
    }

    const ins: any = await query(
      'INSERT INTO student_follow_ups (student_id, note, follow_up_on, created_by) VALUES (?,?,NULL,?)',
      [r.student_id, b.note, req.user!.userId]
    );
    await query('UPDATE reminders SET follow_up_id = ? WHERE id = ?', [ins.insertId, r.id]);
    await audit(req.user!.userId, 'ADD_FOLLOW_UP', 'student', r.student_id, null, { note: b.note, from_reminder: r.id, tier: r.tier });
    res.status(201).json({ ok: true, follow_up_id: ins.insertId });
  })
);

export default router;
