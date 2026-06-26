import { Router } from 'express';
import { query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { CREDITED_EXPR, CONSUMED_EXPR, PENDING_EXPR, LAST_LECTURE_EXPR, deriveHours } from '../utils/hoursSummary';

const router = Router();
router.use(requireAuth, requireRole('admin', 'faculty'));

// ---------------------------------------------------------------------------
// MANAGEMENT MASTER — one row per student with parent (who-pays), fee paid
// status, hours, assigned teachers. Optional ?month=YYYY-MM scopes the
// fees-paid / hours-in-month figures.
// ---------------------------------------------------------------------------
router.get(
  '/master',
  wrap(async (req, res) => {
    const month = (req.query.month as string) || null;
    const search = (req.query.search as string) || '';
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Number(req.query.limit || 20));
    const offset = (page - 1) * limit;

    const searchSql = search ? ' AND (s.full_name LIKE ? OR s.form_no LIKE ?)' : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

    const rows = await query(
      `SELECT
         s.id, s.form_no, s.full_name, s.status, s.year_grade, s.exam_board, s.school_name,
         s.relationship, s.profile_completed, s.profile_submitted_at,
         -- "Who pays": the attached parent based on relationship
         CASE s.relationship
           WHEN 'Mother' THEN s.mother_name
           WHEN 'Father' THEN s.father_name
           ELSE COALESCE(s.father_name, s.mother_name)
         END AS parent_name,
         s.relationship AS paid_by,
         s.parent_mobile,
         s.fees_received,
         -- hours summary, computed scoped to this student (no full-table view)
         ${CREDITED_EXPR} AS total_hours_credited,
         ${CONSUMED_EXPR} AS total_hours_consumed,
         ${PENDING_EXPR}  AS pending_fees,
         ${LAST_LECTURE_EXPR} AS last_attended_lecture,
         -- fees paid (all-time or in selected month)
         COALESCE((
           SELECT SUM(ft.amount) FROM fee_transactions ft
           WHERE ft.student_id = s.id AND ft.is_deleted = FALSE AND (? IS NULL OR ft.month = ?)
         ),0) AS fees_paid,
         -- hours consumed in selected month (or all-time)
         COALESCE((
           SELECT SUM(a.hours_consumed) FROM lecture_attendees a
           JOIN lecture_sessions l ON l.id = a.lecture_id
           WHERE a.student_id = s.id AND (? IS NULL OR l.month = ?)
         ),0) AS hours_in_period,
         -- assigned teachers
         (SELECT GROUP_CONCAT(DISTINCT t.name SEPARATOR ', ')
            FROM student_teacher_mapping m JOIN teachers t ON t.id = m.teacher_id
            WHERE m.student_id = s.id) AS teachers
       FROM students s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.is_deleted = FALSE${searchSql}
       ORDER BY CAST(s.form_no AS UNSIGNED)
       LIMIT ? OFFSET ?`,
      [month, month, month, month, ...searchParams, limit, offset]
    );
    const [{ total }] = await query<any>(
      `SELECT COUNT(*) AS total FROM students s WHERE s.is_deleted = FALSE${searchSql}`,
      searchParams
    );
    res.json({ data: rows.map(deriveHours), page, limit, total, month });
  })
);

// ---------------------------------------------------------------------------
// PER-STUDENT REPORT — date range. Per-day lecture log + fee receipts.
//   GET /api/management/student/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------
router.get(
  '/student/:id/report',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const from = (req.query.from as string) || '2000-01-01';
    const to = (req.query.to as string) || '2999-12-31';

    const studentRow = await queryOne<any>(
      `SELECT s.*,
              ${CREDITED_EXPR} AS total_hours_credited,
              ${CONSUMED_EXPR} AS total_hours_consumed,
              ${PENDING_EXPR}  AS pending_fees,
              COALESCE((SELECT MAX(rate_per_hour) FROM fee_packages WHERE student_id = s.id AND is_active = TRUE),0) AS rate_per_hour,
              CASE s.relationship WHEN 'Mother' THEN s.mother_name WHEN 'Father' THEN s.father_name
                   ELSE COALESCE(s.father_name, s.mother_name) END AS parent_name
       FROM students s
       WHERE s.id = ?`,
      [id]
    );
    if (!studentRow) return res.status(404).json({ error: 'Student not found' });
    const student = deriveHours(studentRow);

    // Per-day lecture log within range
    const lectures = await query(
      `SELECT l.session_date, l.month, l.time_in, l.time_out,
              a.hours_consumed AS no_of_hours, t.name AS teacher_name,
              sub.name AS subject_name, l.topic, l.subtopic, l.remark, l.venue,
              a.attendance_status
       FROM lecture_attendees a
       JOIN lecture_sessions l ON l.id = a.lecture_id
       LEFT JOIN teachers t ON t.id = l.teacher_id
       LEFT JOIN subjects sub ON sub.id = l.subject_id
       WHERE a.student_id = ? AND l.session_date BETWEEN ? AND ?
       ORDER BY l.session_date, l.time_in`,
      [id, from, to]
    );

    // Fee receipts within range
    const fees = await query(
      `SELECT payment_date, month, amount, parent_name, payment_source,
              transaction_reference, course_package_hours, notes
       FROM fee_transactions
       WHERE student_id = ? AND is_deleted = FALSE AND payment_date BETWEEN ? AND ?
       ORDER BY payment_date`,
      [id, from, to]
    );

    const hoursInRange = lectures.reduce((a: number, l: any) => a + Number(l.no_of_hours), 0);
    const feesInRange = fees.reduce((a: number, f: any) => a + Number(f.amount), 0);

    res.json({
      student,
      lectures,
      fees,
      summary: {
        from, to,
        lecture_count: lectures.length,
        hours_in_range: Math.round(hoursInRange * 100) / 100,
        fees_in_range: feesInRange,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// MONTHLY HOURS — all students, hours per month (the Hours section).
//   Returns a tall list the UI pivots; also returns the month columns.
// ---------------------------------------------------------------------------
router.get(
  '/hours-monthly',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT s.form_no, s.full_name AS student_name, s.status, l.month,
              SUM(a.hours_consumed) AS hours
       FROM lecture_attendees a
       JOIN lecture_sessions l ON l.id = a.lecture_id
       JOIN students s ON s.id = a.student_id
       WHERE l.month IS NOT NULL
       GROUP BY s.form_no, s.full_name, s.status, l.month
       ORDER BY CAST(s.form_no AS UNSIGNED), l.month`
    );
    const months = await query<any>(
      `SELECT DISTINCT month FROM lecture_sessions WHERE month IS NOT NULL ORDER BY month`
    );
    res.json({ rows, months: months.map((m: any) => m.month) });
  })
);

// Distinct months present across fees + lectures (for the month dropdown)
router.get(
  '/months',
  wrap(async (_req, res) => {
    const rows = await query<any>(
      `SELECT DISTINCT month FROM (
         SELECT month FROM fee_transactions WHERE month IS NOT NULL AND is_deleted = FALSE
         UNION SELECT month FROM lecture_sessions WHERE month IS NOT NULL
       ) m ORDER BY month DESC`
    );
    res.json({ data: rows.map((r: any) => r.month) });
  })
);

export default router;
