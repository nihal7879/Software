// Myra was enrolled twice. Form 8 ("Myra") ran Nov 2025 - Mar 2026; when she
// came back in July she was given a second form number, 170 ("Myrah Singhal").
// Same student — both records name her father as GAURAV SHINGHAL — so her
// lectures, package and payment from 170 belong on form 8, where the rest of
// her history is.
//
// Decided with the client:
//   - Form 8 keeps its own name and school details, and becomes Active again.
//   - Form 170 stays as it is (Active, now empty); a different student will be
//     put on that form number later.
//   - She keeps the older login (user 21, "myra"); the newer one is switched off.
//   - ledger_adjustments is NOT touched: it is a one-off snapshot imported from
//     the original spreadsheet that the app never updates when a payment is
//     recorded (26 other students lag it the same way), so editing it here
//     would invent a figure rather than move one.
//
// Everything moved is backed up to backup_merge_170_into_8.json first and runs
// in one transaction. Nothing is deleted: rows change owner, they do not go.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const FROM = 190; // form 170, Myrah Singhal
const TO = 24;    // form 8, Myra
const KEEP_USER = 21;  // "myra"
const DROP_USER = 364; // "myrah.singhal"
const ADMIN = 1;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };
  const hours = async (id) => (await q('SELECT * FROM student_hours_summary WHERE student_id = ?', [id]))[0];

  const before = { from: await hours(FROM), to: await hours(TO) };
  console.log('BEFORE');
  console.log('  form 170:', before.from.total_hours_credited, 'credited,', before.from.total_hours_consumed, 'consumed');
  console.log('  form   8:', before.to.total_hours_credited, 'credited,', before.to.total_hours_consumed, 'consumed', '| status', before.to.status);

  // Moving an attendee row onto a lecture the student is already on would
  // collide with the (lecture, student) unique key — check before touching.
  const clash = await q(
    'SELECT lecture_id FROM lecture_attendees WHERE student_id = ? AND lecture_id IN (SELECT lecture_id FROM lecture_attendees WHERE student_id = ?)',
    [FROM, TO]
  );
  if (clash.length) throw new Error('Both records are on the same lecture(s): ' + clash.map((c) => c.lecture_id).join(','));

  const backupPath = path.join(__dirname, 'backup_merge_170_into_8.json');
  if (!fs.existsSync(backupPath)) throw new Error('Backup missing — take it before running this.');

  await conn.beginTransaction();
  try {
    const moved = {
      lecture_attendees: (await q('UPDATE lecture_attendees SET student_id = ? WHERE student_id = ?', [TO, FROM])).affectedRows,
      fee_packages: (await q('UPDATE fee_packages SET student_id = ? WHERE student_id = ?', [TO, FROM])).affectedRows,
      fee_transactions: (await q('UPDATE fee_transactions SET student_id = ? WHERE student_id = ?', [TO, FROM])).affectedRows,
    };
    // She is studying now, so the record holding her history is active again.
    await q("UPDATE students SET status = 'Active' WHERE id = ?", [TO]);
    // One student, one login.
    await q('UPDATE users SET is_active = TRUE WHERE id = ?', [KEEP_USER]);
    await q('UPDATE users SET is_active = FALSE WHERE id = ?', [DROP_USER]);

    await q(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?,?,?,?,?,?)',
      [ADMIN, 'MERGE_STUDENT', 'student', String(TO),
       JSON.stringify({ from_student_id: FROM, from_form_no: '170', ...before }),
       JSON.stringify({ moved, kept_login: KEEP_USER, disabled_login: DROP_USER, form_8_status: 'Active' })]
    );
    await conn.commit();
    console.log('\nMOVED', JSON.stringify(moved));
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
    await conn.end();
    return;
  }

  const after = { from: await hours(FROM), to: await hours(TO) };
  console.log('\nAFTER');
  console.log('  form 170:', after.from.total_hours_credited, 'credited,', after.from.total_hours_consumed, 'consumed | status', after.from.status);
  console.log('  form   8:', after.to.total_hours_credited, 'credited,', after.to.total_hours_consumed, 'consumed |',
    after.to.hours_left, 'left |', after.to.fee_status, '| status', after.to.status);
  const logins = await q('SELECT id, email, is_active FROM users WHERE id IN (?,?)', [KEEP_USER, DROP_USER]);
  console.log('  logins:', logins.map((l) => `${l.email} active=${l.is_active}`).join(' | '));
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
