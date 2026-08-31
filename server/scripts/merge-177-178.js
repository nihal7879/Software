// Fold the two unnamed payment-only rows into the real students, then remove them.
//
//   node scripts/merge-177-178.js            -> DRY RUN
//   node scripts/merge-177-178.js --apply    -> writes, in one transaction
//
// Forms 177 and 178 were created by the fee import to hang a payment on when it
// could only see a payer's name. Forms 172 and 175 were created by the
// attendance import from the same two students' lectures. So each student sits
// on two rows: one with the hours, one with the money, and both read
// "Payment Required" because neither row has both halves.
//
//   172 Maira   6 lectures Aug 5-14, no money  +  177 AED 2,100 paid Aug 4
//   175 Aarna   2 lectures Aug 14-15, no money +  178 AED 4,200 paid Aug 15
//
// The payment MUST be moved before the delete: fee_transactions.student_id is
// ON DELETE CASCADE, so dropping 177/178 first would destroy AED 6,300 of
// payment history without a word.
//
// Removing the two rows also releases form numbers 177 and 178, so the next
// student added is 177 rather than 179.
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

// keep -> the row that survives, drop -> the placeholder folded into it
const MERGES = [
  { keep: 192, keepForm: '172', drop: 197, dropForm: '177',
    name: 'Maira',           first: 'Maira', last: null,
    grade: 'Y13', school: 'GFS' },
  { keep: 195, keepForm: '175', drop: 198, dropForm: '178',
    name: 'Aarna Srivastav', first: 'Aarna', last: 'Srivastav',
    grade: 'Y9',  school: 'JC' },
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const ids = MERGES.flatMap((m) => [m.keep, m.drop]);
  const rows = await q(
    `SELECT id, form_no, full_name, year_grade, school_name, father_name, user_id
       FROM students WHERE id IN (?)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Refuse rather than guess if the table does not look the way this expects.
  for (const m of MERGES) {
    for (const which of ['keep', 'drop']) {
      const r = byId.get(m[which]);
      if (!r) { console.error(`ABORT: student id ${m[which]} (form ${m[which + 'Form']}) not found`); process.exit(1); }
      if (String(r.form_no) !== m[which + 'Form']) {
        console.error(`ABORT: id ${r.id} is form ${r.form_no}, expected ${m[which + 'Form']}`);
        process.exit(1);
      }
    }
    const d = byId.get(m.drop);
    const lec = (await q('SELECT COUNT(*) n FROM lecture_attendees WHERE student_id = ?', [m.drop]))[0].n;
    if (lec > 0) {
      console.error(`ABORT: form ${m.dropForm} has ${lec} lecture(s); it is not just a payment placeholder`);
      process.exit(1);
    }
    m._drop = d;
  }

  console.log('\nPLAN');
  for (const m of MERGES) {
    const tx = await q('SELECT id, amount, payment_date, parent_name FROM fee_transactions WHERE student_id = ?', [m.drop]);
    const k = byId.get(m.keep);
    console.log(`\n  form ${m.dropForm} "${m._drop.full_name}"  ->  form ${m.keepForm}`);
    for (const t of tx)
      console.log(`      move payment #${t.id}  ${t.amount}  ${t.payment_date}  (${t.parent_name})  ->  form ${m.keepForm}`);
    console.log(`      set father_name = ${m._drop.father_name}`);
    console.log(`      rename form ${m.keepForm}: "${k.full_name}" -> "${m.name}"`);
    console.log(`      grade  ${k.year_grade || '(none)'} -> ${m.grade}`);
    console.log(`      school ${k.school_name || '(none)'} -> ${m.school}`);
    console.log(`      DELETE student id ${m.drop} (form ${m.dropForm}) and its login/parent rows`);
  }

  const [{ nextNo }] = await q(
    "SELECT MAX(CAST(form_no AS UNSIGNED)) + 1 AS nextNo FROM students WHERE form_no REGEXP '^[0-9]+$'");
  console.log(`\n  next student form number: ${nextNo} now  ->  177 after this runs`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Add --apply to write.\n'); await conn.end(); return; }

  await conn.beginTransaction();
  try {
    for (const m of MERGES) {
      // Money first. The delete below cascades fee_transactions, so a payment
      // still attached to the dropped row at that point would be destroyed.
      await q('UPDATE fee_transactions SET student_id = ? WHERE student_id = ?', [m.keep, m.drop]);

      await q(
        `UPDATE students SET full_name = ?, first_name = ?, last_name = ?,
                year_grade = ?, school_name = ?, father_name = COALESCE(father_name, ?)
           WHERE id = ?`,
        [m.name, m.first, m.last, m.grade, m.school, m._drop.father_name, m.keep]);

      // Carry the payer's name onto the surviving parent record, which the
      // attendance import left with a mobile but no name.
      await q(
        'UPDATE parents SET name = COALESCE(name, ?) WHERE student_id = ?',
        [m._drop.father_name, m.keep]);

      await q('UPDATE users SET display_name = ? WHERE id = (SELECT user_id FROM students WHERE id = ?)',
        [m.name, m.keep]);

      // Cascades the dropped row's parents entry; its payments already moved.
      await q('DELETE FROM students WHERE id = ?', [m.drop]);
      if (m._drop.user_id) await q('DELETE FROM users WHERE id = ?', [m._drop.user_id]);

      await q(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
         VALUES (NULL,'MERGE_DUPLICATE','student',?,?,?)`,
        [String(m.keep),
         JSON.stringify({ merged_form_no: m.dropForm, merged_student_id: m.drop,
                          merged_name: m._drop.full_name, father_name: m._drop.father_name }),
         JSON.stringify({ form_no: m.keepForm, full_name: m.name, year_grade: m.grade,
                          school_name: m.school,
                          reason: 'same student imported twice: lectures on one row, payment on the other' })]);
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
    `SELECT s.form_no, s.full_name, s.year_grade, s.school_name, s.father_name,
            (SELECT COUNT(*) FROM lecture_attendees a WHERE a.student_id = s.id) lectures,
            (SELECT COUNT(*) FROM fee_transactions t WHERE t.student_id = s.id) payments,
            (SELECT SUM(t.amount) FROM fee_transactions t WHERE t.student_id = s.id) paid
       FROM students s WHERE s.id IN (?)`, [MERGES.map((m) => m.keep)]));
  console.log('177/178 still present?',
    (await q("SELECT COUNT(*) n FROM students WHERE form_no IN ('177','178')"))[0].n);
  console.log('next student form number:',
    (await q("SELECT MAX(CAST(form_no AS UNSIGNED)) + 1 n FROM students WHERE form_no REGEXP '^[0-9]+$'"))[0].n);
  console.log('total payments in the system:',
    (await q('SELECT COUNT(*) n, SUM(amount) total FROM fee_transactions'))[0]);
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
