import { Router } from 'express';
import { query } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';

const router = Router();
// Institute-wide analytics are Management-only. Faculty use /teachers/me instead.
router.use(requireAuth, requireRole('admin'));

// Management dashboard KPIs
router.get(
  '/overview',
  wrap(async (_req, res) => {
    // Run independent aggregates concurrently — against a remote DB the round
    // trips dominate, so parallel is ~5x faster than awaiting one at a time.
    // student_hours_summary (a view) is scanned once and reused for both the
    // hours and pending figures.
    const [studentsRows, teachersRows, revenueRows, summaryRows] = await Promise.all([
      query<any>(
        `SELECT
           COUNT(*) AS total,
           SUM(status='Active') AS active,
           SUM(status='Inactive') AS inactive,
           SUM(date_of_joining >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS new_admissions
         FROM students`
      ),
      query<any>(`SELECT COUNT(*) AS total, SUM(is_active) AS active FROM teachers`),
      query<any>(
        `SELECT COALESCE(SUM(amount),0) AS total_revenue,
                COALESCE(SUM(CASE WHEN month = DATE_FORMAT(CURDATE(),'%Y-%m') THEN amount END),0) AS month_revenue
         FROM fee_transactions WHERE is_deleted = FALSE`
      ),
      query<any>(
        `SELECT
           COALESCE(SUM(total_hours_credited),0) AS purchased,
           COALESCE(SUM(total_hours_consumed),0) AS consumed,
           COALESCE(SUM(hours_left),0) AS remaining,
           COALESCE(SUM(pending_fees),0) AS outstanding,
           SUM(fee_status='Payment Required') AS payment_required_count
         FROM student_hours_summary`
      ),
    ]);

    const s = summaryRows[0];
    res.json({
      students: studentsRows[0],
      teachers: teachersRows[0],
      revenue: revenueRows[0],
      hours: { purchased: s.purchased, consumed: s.consumed, remaining: s.remaining },
      pending: { outstanding: s.outstanding, payment_required_count: s.payment_required_count },
    });
  })
);

// Students by grade & board (charts)
router.get(
  '/students-breakdown',
  wrap(async (_req, res) => {
    const byGrade = await query(
      `SELECT year_grade AS label, COUNT(*) AS value
       FROM students WHERE year_grade IS NOT NULL AND year_grade <> ''
       GROUP BY year_grade ORDER BY label`
    );
    const byBoard = await query(
      `SELECT exam_board AS label, COUNT(*) AS value
       FROM students WHERE exam_board IS NOT NULL AND exam_board <> ''
       GROUP BY exam_board ORDER BY value DESC`
    );
    res.json({ byGrade, byBoard });
  })
);

// Teacher workload. "total_students" = distinct students the teacher has either
// TAUGHT (logged lectures) OR been ASSIGNED to — matches the roster panel below.
router.get(
  '/teacher-workload',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT t.id, t.name, t.is_active,
              (SELECT COUNT(*) FROM (
                 SELECT a.student_id FROM lecture_sessions l2 JOIN lecture_attendees a ON a.lecture_id = l2.id WHERE l2.teacher_id = t.id
                 UNION
                 SELECT m.student_id FROM student_teacher_mapping m WHERE m.teacher_id = t.id
               ) u) AS total_students,
              COALESCE((SELECT SUM(l.total_hours) FROM lecture_sessions l WHERE l.teacher_id = t.id),0) AS total_hours_taught,
              COALESCE((SELECT SUM(l.total_hours) FROM lecture_sessions l
                          WHERE l.teacher_id = t.id AND l.month = DATE_FORMAT(CURDATE(),'%Y-%m')),0) AS month_hours
       FROM teachers t
       ORDER BY total_hours_taught DESC`
    );
    res.json({ data: rows });
  })
);

// Finance pivot — revenue per student per month
router.get(
  '/finance-pivot',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT s.form_no, s.full_name AS student_name, ft.month, SUM(ft.amount) AS amount
       FROM fee_transactions ft JOIN students s ON s.id = ft.student_id
       WHERE ft.is_deleted = FALSE
       GROUP BY s.form_no, s.full_name, ft.month
       ORDER BY CAST(s.form_no AS UNSIGNED), ft.month`
    );
    const months = await query<any>(
      `SELECT DISTINCT month FROM fee_transactions WHERE is_deleted = FALSE ORDER BY month`
    );
    res.json({ rows, months: months.map((m: any) => m.month) });
  })
);

// Hours pivot — hours consumed per student per month
router.get(
  '/hours-pivot',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT s.form_no, s.full_name AS student_name, l.month, SUM(a.hours_consumed) AS hours
       FROM lecture_attendees a
       JOIN lecture_sessions l ON l.id = a.lecture_id
       JOIN students s ON s.id = a.student_id
       GROUP BY s.form_no, s.full_name, l.month
       ORDER BY CAST(s.form_no AS UNSIGNED), l.month`
    );
    const months = await query<any>(
      `SELECT DISTINCT month FROM lecture_sessions WHERE month IS NOT NULL ORDER BY month`
    );
    res.json({ rows, months: months.map((m: any) => m.month) });
  })
);

// Collection trend (monthly revenue line)
router.get(
  '/revenue-trend',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT month AS label, SUM(amount) AS value
       FROM fee_transactions WHERE is_deleted = FALSE GROUP BY month ORDER BY month`
    );
    res.json({ data: rows });
  })
);

export default router;
