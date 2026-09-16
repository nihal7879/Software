// Some students' payments show in the Finance tracker but never appear on their
// Hours Statement. The statement builds its credit lines from fee_packages, and
// these payments have no package attached — so the money the parent paid is
// invisible on the student's own statement.
//
// It is the monthly and lump-sum students: their fee_transactions carry no
// course_package_hours (they do not buy hours), so the original import created
// nothing for them. The client's own sheet agrees — "Hours Commited" is 0 for
// every one of them, with notes like "No package fee → AED 500 monthly".
//
// So this attaches one package to each payment, carrying the hours the payment
// recorded (0 for these students) and linked by transaction_id. The statement
// reads the real amount from that link, so each payment now shows as a credit
// line on its true date, for its true amount.
//
// Hours are NOT invented: committed hours stay exactly as they were, so nothing
// in Student Hours moves. Only the missing credit lines appear.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const APPLY = process.argv.includes('--apply');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  // Every payment that no package points at, for a student who is left with no
  // live package at all — that is what makes the statement come out empty.
  const orphans = await q(`
    SELECT t.id, t.student_id, s.form_no, s.full_name, t.amount, t.payment_date,
           t.course_package_hours, t.discount_hours
      FROM fee_transactions t
      JOIN students s ON s.id = t.student_id
     WHERE t.is_deleted = FALSE
       AND s.is_deleted = FALSE
       AND NOT EXISTS (SELECT 1 FROM fee_packages p WHERE p.transaction_id = t.id AND p.is_deleted = FALSE)
       AND NOT EXISTS (SELECT 1 FROM fee_packages p WHERE p.student_id = t.student_id AND p.is_deleted = FALSE)
     ORDER BY s.form_no + 0, t.payment_date`);

  const byStudent = new Map();
  for (const o of orphans) {
    if (!byStudent.has(o.student_id)) byStudent.set(o.student_id, []);
    byStudent.get(o.student_id).push(o);
  }
  console.log(`${orphans.length} payments with no credit line, across ${byStudent.size} students:\n`);
  for (const [, list] of byStudent) {
    console.log(`  form ${list[0].form_no} — ${list[0].full_name}: ` +
      list.map((t) => `${t.amount} on ${String(t.payment_date).slice(0, 10)} (${round2(t.course_package_hours)}h)`).join(', '));
  }
  if (!orphans.length || !APPLY) {
    console.log(APPLY ? '\nNothing to do.' : '\nDry run — pass --apply to write.');
    await conn.end();
    return;
  }

  const backup = {
    taken_at: new Date().toISOString(),
    note: 'before attaching a fee_package to payments that had none',
    students: await q('SELECT id, form_no, full_name FROM students WHERE id IN (?)', [[...byStudent.keys()]]),
    fee_packages: await q('SELECT * FROM fee_packages WHERE student_id IN (?)', [[...byStudent.keys()]]),
    fee_transactions: orphans,
  };
  fs.writeFileSync(path.join(__dirname, 'backup_link_payments_without_packages.json'), JSON.stringify(backup, null, 2));

  await conn.beginTransaction();
  try {
    let made = 0;
    for (const t of orphans) {
      const hrs = round2(t.course_package_hours);
      const disc = round2(t.discount_hours);
      // Rate only means something when the payment bought hours.
      const rate = hrs > 0 ? round2(Number(t.amount) / hrs) : 0;
      await q(
        `INSERT INTO fee_packages (student_id, transaction_id, package_hours, discount_hours, rate_per_hour, start_date, is_active, is_deleted)
         VALUES (?,?,?,?,?,?,TRUE,FALSE)`,
        [t.student_id, t.id, hrs, disc, rate, t.payment_date]
      );
      made++;
    }
    await q(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?,?,?,?,?,?)',
      [1, 'LINK_PAYMENTS', 'fee_package', 'bulk', JSON.stringify({ payments_without_packages: orphans.length }),
       JSON.stringify({ packages_created: made, students: [...byStudent.keys()] })]
    );
    await conn.commit();
    console.log(`\nAPPLIED — ${made} credit lines created.`);
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
    await conn.end();
    return;
  }

  console.log('\nAFTER — committed hours must be unchanged:');
  const check = await q(`
    SELECT s.form_no, s.full_name, hs.total_hours_credited, hs.total_hours_consumed,
           (SELECT COUNT(*) FROM fee_packages p WHERE p.student_id = s.id AND p.is_deleted = FALSE) AS credit_lines,
           (SELECT SUM(t.amount) FROM fee_transactions t WHERE t.student_id = s.id AND t.is_deleted = FALSE) AS paid
      FROM students s JOIN student_hours_summary hs ON hs.student_id = s.id
     WHERE s.id IN (?) ORDER BY s.form_no + 0`, [[...byStudent.keys()]]);
  console.table(check);
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
