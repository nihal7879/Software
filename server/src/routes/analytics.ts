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
      `SELECT t.id, t.name, t.is_active, t.specialization,
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

// Shared pivot builder — paginates by student for one year, so we never load all
// 3000 students at once. Returns the page's student rows, plus per-month totals
// across ALL matching students (for the footer) and the student count.
//   valueExpr: the SUM(...) aggregate; src: the FROM/JOIN chain reaching `month`
//   and `s` (students); deletedSql: extra WHERE; monthCol: the month column.
async function pivot(req: any, res: any, opts: {
  valueExpr: string; valueAlias: string; src: string; where: string; monthCol: string;
}) {
  const { valueExpr, valueAlias, src, where, monthCol } = opts;
  const search = (req.query.search as string) || '';
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Number(req.query.limit || 20));
  const offset = (page - 1) * limit;

  // Years that actually have data (newest first).
  const yearsRows = await query<any>(
    `SELECT DISTINCT LEFT(${monthCol},4) AS y FROM ${src} WHERE ${where} AND ${monthCol} IS NOT NULL ORDER BY y DESC`
  );
  const years = yearsRows.map((r: any) => Number(r.y)).filter(Boolean);
  const year = String(req.query.year || years[0] || new Date().getFullYear());
  const yearLike = `${year}-%`;

  const searchSql = search ? ' AND (s.full_name LIKE ? OR s.form_no LIKE ?)' : '';
  const sp = search ? [`%${search}%`, `%${search}%`] : [];

  // EXISTS: students who have data in this year (matching search), paginated.
  const existsSql = `EXISTS (SELECT 1 FROM ${src} WHERE ${where} AND ${monthCol} LIKE ? AND student_id = s.id)`;
  // These three are independent — run them in one concurrent batch.
  const [pageStudents, totalRows, monthTotals] = await Promise.all([
    query<any>(
      `SELECT s.id, s.form_no, s.full_name AS student_name
       FROM students s
       WHERE ${existsSql}${searchSql}
       ORDER BY CAST(s.form_no AS UNSIGNED)
       LIMIT ? OFFSET ?`,
      [yearLike, ...sp, limit, offset]
    ),
    query<any>(`SELECT COUNT(*) AS total FROM students s WHERE ${existsSql}${searchSql}`, [yearLike, ...sp]),
    query(
      `SELECT ${monthCol} AS month, ${valueExpr} AS ${valueAlias}
       FROM ${src}
       JOIN students s ON s.id = student_id
       WHERE ${where} AND ${monthCol} LIKE ?${searchSql}
       GROUP BY ${monthCol}`,
      [yearLike, ...sp]
    ),
  ]);

  let rows: any[] = [];
  if (pageStudents.length) {
    const ids = pageStudents.map((s: any) => s.id);
    const ph = ids.map(() => '?').join(',');
    rows = await query(
      `SELECT s.form_no, s.full_name AS student_name, ${monthCol} AS month, ${valueExpr} AS ${valueAlias}
       FROM ${src}
       JOIN students s ON s.id = student_id
       WHERE ${where} AND ${monthCol} LIKE ? AND student_id IN (${ph})
       GROUP BY s.form_no, s.full_name, ${monthCol}`,
      [yearLike, ...ids]
    );
  }

  res.json({ rows, students: pageStudents, monthTotals, year: Number(year), years, page, limit, total: totalRows[0].total });
}

// Finance pivot — revenue per student per month (paginated by student)
router.get(
  '/finance-pivot',
  wrap((req, res) => pivot(req, res, {
    // Qualify is_deleted — the joined students table also has an is_deleted
    // column, so an unqualified reference is ambiguous and errors.
    valueExpr: 'SUM(amount)', valueAlias: 'amount',
    src: 'fee_transactions', where: 'fee_transactions.is_deleted = FALSE', monthCol: 'month',
  }))
);

// Hours pivot — hours consumed per student per month (paginated by student)
router.get(
  '/hours-pivot',
  wrap((req, res) => pivot(req, res, {
    valueExpr: 'SUM(a.hours_consumed)', valueAlias: 'hours',
    src: 'lecture_attendees a JOIN lecture_sessions l ON l.id = a.lecture_id',
    where: '1=1', monthCol: 'l.month',
  }))
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
