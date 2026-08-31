// Turn the two stranded payments into hour packages.
//
//   node scripts/add-packages-172-175.js            -> DRY RUN
//   node scripts/add-packages-172-175.js --apply    -> writes, in one transaction
//
// Maira (172) and Aarna Srivastav (175) each had a payment but no fee_package,
// so nothing ever credited them hours. Both therefore read "Payment Required"
// on a negative balance, and the Hours Statement showed no "Last Recharge"
// date, because that date comes from the package.
//
// They were the only two students in the system with a payment and no package —
// a side effect of the payments arriving on the duplicate rows 177/178, which
// were merged away first (see merge-177-178.js).
//
// Hours confirmed by the client; both work out at the institute's usual
// AED 140/hr, which is the rate on 128 of the existing packages.
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

const PLAN = [
  { id: 192, form: '172', name: 'Maira',           hours: 15, rate: 140 },
  { id: 195, form: '175', name: 'Aarna Srivastav', hours: 30, rate: 140 },
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  console.log('\nPLAN');
  for (const p of PLAN) {
    const s = (await q('SELECT id, form_no, full_name FROM students WHERE id = ?', [p.id]))[0];
    if (!s || String(s.form_no) !== p.form) {
      console.error(`ABORT: id ${p.id} is not form ${p.form}`); process.exit(1);
    }
    // Refuse to double-credit if a package already exists.
    const existing = await q('SELECT id FROM fee_packages WHERE student_id = ? AND is_deleted = FALSE', [p.id]);
    if (existing.length) {
      console.error(`ABORT: form ${p.form} already has ${existing.length} package(s); would double-credit`);
      process.exit(1);
    }
    const tx = await q('SELECT id, amount, payment_date FROM fee_transactions WHERE student_id = ?', [p.id]);
    if (tx.length !== 1) {
      console.error(`ABORT: form ${p.form} has ${tx.length} payments; expected exactly 1`); process.exit(1);
    }
    p._tx = tx[0];
    const implied = Number(p._tx.amount) / p.hours;
    const consumed = Number((await q(
      'SELECT COALESCE(SUM(hours_consumed),0) n FROM lecture_attendees WHERE student_id = ?', [p.id]))[0].n);
    console.log(`\n  form ${p.form}  ${p.name}`);
    console.log(`      payment #${p._tx.id}  AED ${p._tx.amount}  on ${p._tx.payment_date}`);
    console.log(`      -> package ${p.hours} hrs @ AED ${p.rate}/hr  (implied ${implied.toFixed(2)}/hr)`);
    console.log(`      start_date = ${p._tx.payment_date}  (becomes the "Last Recharge" date)`);
    console.log(`      balance ${(0 - consumed).toFixed(2)}  ->  ${(p.hours - consumed).toFixed(2)}  hrs`);
    if (Math.abs(implied - p.rate) > 0.01)
      console.log(`      NOTE: implied rate differs from the stated AED ${p.rate}`);
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Add --apply to write.\n'); await conn.end(); return; }

  await conn.beginTransaction();
  try {
    for (const p of PLAN) {
      // transaction_id links the package to the payment, so the statement shows
      // the real amount paid rather than a rate x hours estimate.
      const r = await q(
        `INSERT INTO fee_packages
           (student_id, transaction_id, package_hours, rate_per_hour, start_date, is_active)
         VALUES (?,?,?,?,?,TRUE)`,
        [p.id, p._tx.id, p.hours, p.rate, p._tx.payment_date]);
      await q(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
         VALUES (NULL,'ADD_PACKAGE','student',?,?,?)`,
        [String(p.id),
         JSON.stringify({ packages: 0, note: 'payment held with no hours credited' }),
         JSON.stringify({ package_id: r.insertId, transaction_id: p._tx.id, amount: p._tx.amount,
                          package_hours: p.hours, rate_per_hour: p.rate,
                          start_date: p._tx.payment_date, hours_confirmed_by: 'client' })]);
    }
    await conn.commit();
    console.log('\nAPPLIED');
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
    await conn.end();
    return;
  }

  console.log('\nAFTER');
  console.table(await q(
    `SELECT form_no, student_name, hours_committed AS credited, total_hours_consumed AS used,
            hours_left, fee_status
       FROM student_hours_summary WHERE student_id IN (?)`, [PLAN.map((p) => p.id)]));
  console.log('Last Recharge date now shown on the Hours Statement:');
  console.table(await q(
    `SELECT s.form_no, s.full_name, p.start_date AS last_recharge, p.package_hours, p.rate_per_hour,
            t.amount AS paid_amount
       FROM fee_packages p JOIN students s ON s.id = p.student_id
       LEFT JOIN fee_transactions t ON t.id = p.transaction_id
      WHERE p.student_id IN (?)`, [PLAN.map((p) => p.id)]));
  console.log('students with a payment but no package (was 2):',
    (await q(`SELECT COUNT(*) n FROM students s
       WHERE (SELECT COUNT(*) FROM fee_transactions t WHERE t.student_id=s.id) > 0
         AND (SELECT COUNT(*) FROM fee_packages f WHERE f.student_id=s.id AND f.is_deleted=FALSE) = 0`))[0].n);
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
