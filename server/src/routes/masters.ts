import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../middleware/error';

// Master-data lookups that drive the app dropdowns (Year/Grade, Venue,
// Exam Board, School). Curated from the source workbooks — see
// database/migrations/2026-07-04_master_data_tables.sql.
const router = Router();
router.use(requireAuth);

const names = (rows: any[]) => rows.map((r) => r.name);

router.get(
  '/',
  wrap(async (_req, res) => {
    const [yearGrades, venues, examBoards, schools] = await Promise.all([
      // Natural order: letter group (G before Y) then numeric part.
      query<any>(
        `SELECT name FROM year_grades WHERE is_active = TRUE
         ORDER BY LEFT(name,1), CAST(REGEXP_REPLACE(name,'[^0-9]','') AS UNSIGNED)`
      ),
      query<any>('SELECT name FROM venues WHERE is_active = TRUE ORDER BY sort_order, name'),
      query<any>('SELECT name FROM exam_boards WHERE is_active = TRUE ORDER BY name'),
      query<any>('SELECT name FROM schools WHERE is_active = TRUE ORDER BY name'),
    ]);
    res.json({
      year_grades: names(yearGrades),
      venues: names(venues),
      exam_boards: names(examBoards),
      schools: names(schools),
    });
  })
);

export default router;
