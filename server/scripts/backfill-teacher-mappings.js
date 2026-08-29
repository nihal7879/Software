// Rebuild student_teacher_mapping from actual lecture history.
//
//   node scripts/backfill-teacher-mappings.js            -> DRY RUN
//   node scripts/backfill-teacher-mappings.js --apply    -> writes
//
// The mapping table is what the Students master screen reads to show the
// "Teachers" column, but it is maintained separately from attendance — so any
// student created by an import has lectures and no mapping, and their Teachers
// cell renders empty.
//
// This derives one mapping per (student, teacher, subject) that actually
// appears in the lecture history. Only inserts what is missing; never deletes,
// and never touches package_hours on mappings that already exist.
//
// Lectures with no subject cannot produce a mapping — student_teacher_mapping
// .subject_id is NOT NULL — so those are reported separately.
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
// Optional: only students from this form number up. Used to fix the students
// created by the July/August and demo imports without also writing mappings
// derived from older lectures, whose subject data is known to be wrong on 159
// rows (an earlier enrichment keyed on date without time and mislabelled them).
const sinceArg = process.argv.find((a) => a.startsWith('--since-form='));
const SINCE = sinceArg ? Number(sinceArg.split('=')[1]) : null;
const sinceSql = SINCE ? ' AND CAST(s.form_no AS UNSIGNED) >= ' + SINCE : '';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const missing = await q(`
    SELECT DISTINCT a.student_id, l.teacher_id, l.subject_id,
           s.form_no, s.full_name, t.name AS teacher, sub.name AS subject
      FROM lecture_attendees a
      JOIN lecture_sessions l ON l.id = a.lecture_id
      JOIN students s  ON s.id = a.student_id
      JOIN teachers t  ON t.id = l.teacher_id
      JOIN subjects sub ON sub.id = l.subject_id
     WHERE l.is_deleted = FALSE
       AND l.teacher_id IS NOT NULL
       AND l.subject_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM student_teacher_mapping m
          WHERE m.student_id = a.student_id
            AND m.teacher_id = l.teacher_id
            AND m.subject_id = l.subject_id)${sinceSql}
     ORDER BY CAST(s.form_no AS UNSIGNED), t.name, sub.name`);

  // students who will still show nothing, because every lecture lacks a subject
  const stillEmpty = await q(`
    SELECT s.form_no, s.full_name, s.student_type,
           COUNT(DISTINCT a.lecture_id) lectures,
           SUM(l.subject_id IS NULL) lectures_without_subject
      FROM students s
      JOIN lecture_attendees a ON a.student_id = s.id
      JOIN lecture_sessions l ON l.id = a.lecture_id
     WHERE NOT EXISTS (SELECT 1 FROM student_teacher_mapping m WHERE m.student_id = s.id)
       AND NOT EXISTS (
         SELECT 1 FROM lecture_attendees a2
           JOIN lecture_sessions l2 ON l2.id = a2.lecture_id
          WHERE a2.student_id = s.id AND l2.subject_id IS NOT NULL AND l2.teacher_id IS NOT NULL)
     GROUP BY s.id ORDER BY CAST(s.form_no AS UNSIGNED)`);

  const byStudent = new Map();
  for (const r of missing) {
    if (!byStudent.has(r.form_no)) byStudent.set(r.form_no, { name: r.full_name, rows: [] });
    byStudent.get(r.form_no).rows.push(`${r.teacher} / ${r.subject}`);
  }
  console.log(`mappings to create: ${missing.length}  across ${byStudent.size} students\n`);
  for (const [form, v] of byStudent)
    console.log(`  form ${String(form).padEnd(5)} ${v.name.slice(0, 26).padEnd(26)} ${v.rows.join(' | ')}`);

  if (stillEmpty.length) {
    console.log(`\n${stillEmpty.length} student(s) will STILL show no teacher — every lecture of theirs has no subject recorded:`);
    for (const r of stillEmpty)
      console.log(`  form ${String(r.form_no).padEnd(5)} ${r.full_name.slice(0, 26).padEnd(26)} ${r.lectures} lectures, ${r.lectures_without_subject} with no subject`);
  }

  if (!missing.length) { console.log('\nNothing to do.'); await conn.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await conn.end(); return; }

  await conn.beginTransaction();
  try {
    let n = 0;
    for (const r of missing) {
      await q(
        `INSERT IGNORE INTO student_teacher_mapping (student_id,teacher_id,subject_id,package_hours)
         VALUES (?,?,?,0)`,
        [r.student_id, r.teacher_id, r.subject_id]);
      n++;
    }
    await conn.commit();
    console.log(`\nAPPLIED — ${n} mappings created`);
    console.table(await q(`
      SELECT COUNT(*) students_with_lectures,
             SUM(mappings = 0) still_without_mapping
        FROM (SELECT s.id, (SELECT COUNT(*) FROM student_teacher_mapping m WHERE m.student_id = s.id) mappings
                FROM students s WHERE EXISTS (SELECT 1 FROM lecture_attendees a WHERE a.student_id = s.id)) x`));
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
