import { Router } from 'express';
import { query } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';

const router = Router();
router.use(requireAuth, requireRole('admin', 'faculty'));

// Management dashboard KPIs
router.get(
  '/overview',
  wrap(async (_req, res) => {
    const [students] = await query<any>(
      `SELECT
         COUNT(*) AS total,
         SUM(status='Active') AS active,
         SUM(status='Inactive') AS inactive,
         SUM(status='SP-Active') AS sp_active,
         SUM(date_of_joining >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS new_admissions
       FROM students`
    );
    const [teachers] = await query<any>(
      `SELECT COUNT(*) AS total, SUM(is_active) AS active FROM teachers`
    );
    const [revenue] = await query<any>(
      `SELECT COALESCE(SUM(amount),0) AS total_revenue,
              COALESCE(SUM(CASE WHEN month = DATE_FORMAT(CURDATE(),'%Y-%m') THEN amount END),0) AS month_revenue
       FROM fee_transactions`
    );
    const [hours] = await query<any>(
      `SELECT
         COALESCE(SUM(total_hours_credited),0) AS purchased,
         COALESCE(SUM(total_hours_consumed),0) AS consumed,
         COALESCE(SUM(hours_left),0) AS remaining
       FROM student_hours_summary`
    );
    const [pending] = await query<any>(
      `SELECT COALESCE(SUM(pending_fees),0) AS outstanding,
              SUM(fee_status='Payment Required') AS payment_required_count
       FROM student_hours_summary`
    );
    res.json({ students, teachers, revenue, hours, pending });
  })
);

// Students by grade & board (charts)
router.get(
  '/students-breakdown',
  wrap(async (_req, res) => {
    const byGrade = await query(
      `SELECT COALESCE(year_grade,'Unknown') AS label, COUNT(*) AS value
       FROM students GROUP BY year_grade ORDER BY label`
    );
    const byBoard = await query(
      `SELECT COALESCE(exam_board,'Unknown') AS label, COUNT(*) AS value
       FROM students GROUP BY exam_board ORDER BY value DESC`
    );
    res.json({ byGrade, byBoard });
  })
);

// Teacher workload
router.get(
  '/teacher-workload',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT t.id, t.name,
              COUNT(DISTINCT a.student_id) AS total_students,
              COALESCE(SUM(l.total_hours),0) AS total_hours_taught,
              COALESCE(SUM(CASE WHEN l.month = DATE_FORMAT(CURDATE(),'%Y-%m') THEN l.total_hours END),0) AS month_hours
       FROM teachers t
       LEFT JOIN lecture_sessions l ON l.teacher_id = t.id
       LEFT JOIN lecture_attendees a ON a.lecture_id = l.id
       GROUP BY t.id, t.name ORDER BY total_hours_taught DESC`
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
       GROUP BY s.form_no, s.full_name, ft.month
       ORDER BY CAST(s.form_no AS UNSIGNED), ft.month`
    );
    const months = await query<any>(
      `SELECT DISTINCT month FROM fee_transactions ORDER BY month`
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
       FROM fee_transactions GROUP BY month ORDER BY month`
    );
    res.json({ data: rows });
  })
);

export default router;
