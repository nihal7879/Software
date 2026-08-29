// Put an enrolled student back to Trial. For undoing an Enroll that was
// clicked by mistake — the API deliberately has no revert, because converting
// is meant to be one-way once a student is really paying.
//
//   node scripts/revert-to-trial.js 179 181            -> DRY RUN
//   node scripts/revert-to-trial.js 179 181 --apply    -> writes
//
// Refuses if a paid package was created at conversion, because that would mean
// real money is attached and reverting would misreport them as a free trial.
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const forms = process.argv.slice(2).filter((a) => /^\d+$/.test(a));

(async () => {
  if (!forms.length) {
    console.error('Usage: node scripts/revert-to-trial.js <form_no> [<form_no> ...] [--apply]');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const rows = await q(
    `SELECT s.id, s.form_no, s.full_name, s.student_type, s.trial_started_on, s.converted_on,
            (SELECT COUNT(*) FROM fee_packages p
              WHERE p.student_id = s.id AND COALESCE(p.course_name,'') <> 'Trial') paid_packages,
            (SELECT COUNT(*) FROM fee_transactions f WHERE f.student_id = s.id) payments
       FROM students s WHERE s.form_no IN (?)`, [forms]);

  const ok = [], blocked = [];
  for (const r of rows) {
    if (r.student_type === 'Trial') { console.log(`  form ${r.form_no} ${r.full_name} — already Trial, skipping`); continue; }
    if (r.paid_packages > 0 || r.payments > 0) blocked.push(r); else ok.push(r);
  }

  console.log('\nWILL REVERT TO TRIAL');
  for (const r of ok)
    console.log(`  form ${String(r.form_no).padEnd(5)} ${r.full_name.slice(0, 26).padEnd(26)} converted_on ${r.converted_on} -> null   (trial started ${r.trial_started_on})`);
  if (!ok.length) console.log('  (none)');
  if (blocked.length) {
    console.log('\nREFUSED — these have a paid package or a payment attached:');
    for (const r of blocked)
      console.log(`  form ${String(r.form_no).padEnd(5)} ${r.full_name.slice(0, 26).padEnd(26)} ${r.paid_packages} paid package(s), ${r.payments} payment(s)`);
  }
  if (!ok.length) { await conn.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Add --apply to write.'); await conn.end(); return; }

  await conn.beginTransaction();
  try {
    for (const r of ok) {
      await q(`UPDATE students SET student_type='Trial', converted_on=NULL, converted_by=NULL WHERE id=?`, [r.id]);
      await q(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
         VALUES (NULL,'REVERT_TO_TRIAL','student',?,?,?)`,
        [String(r.id),
         JSON.stringify({ student_type: 'Enrolled', converted_on: r.converted_on }),
         JSON.stringify({ student_type: 'Trial', converted_on: null, reason: 'enrolled in error' })]);
    }
    await conn.commit();
    console.log(`\nAPPLIED — ${ok.length} reverted`);
    console.table(await q(
      `SELECT s.form_no, s.full_name, s.student_type, s.trial_started_on, s.converted_on,
              ROUND(h.hours_left,1) hours_left, h.fee_status
         FROM students s JOIN student_hours_summary h ON h.student_id = s.id
        WHERE s.form_no IN (?) ORDER BY CAST(s.form_no AS UNSIGNED)`, [forms]));
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
