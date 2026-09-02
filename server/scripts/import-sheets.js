// Bring the database up to date with the two source workbooks.
//
//   node scripts/import-sheets.js                 -> DRY RUN (all stages)
//   node scripts/import-sheets.js --apply         -> writes, one transaction
//   node scripts/import-sheets.js --only=students -> a single stage
//
// Stages, in dependency order:
//   students  new forms 177-182 from "Student Details Master sheet"
//   trials    Demo* form numbers seen in the tracker, as Trial students (T-numbers)
//   lectures  "Master Sheet" rows in the window, with attendance
//   payments  "Total Fees From June" rows missing from fee_transactions,
//             each with the fee_package the app's own flow would create
//   fields    blank year_grade/school/board/parent names on EXISTING students
//
// Everything is additive and deduped. Nothing already in the database is
// overwritten: `fields` only fills columns that are currently empty, and every
// insert is skipped when a matching row already exists. Run the audit
// (audit-sheets-vs-db.js) before and after.
require('dotenv').config();
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const ANKITA = process.env.TRACKER_SRC || 'C:/Users/dell/Downloads/Ankita Attendance tracker.xlsx';
const FINANCE = process.env.FINANCE_SRC || 'C:/Users/dell/Downloads/Final Finance Sheet.xlsx';
const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',') : null;
const stageOn = (s) => !ONLY || ONLY.includes(s);
const FROM = process.env.FROM || '2026-08-17';
const TO = process.env.TO || '2026-09-01';

const pad = (n) => String(n).padStart(2, '0');
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const serToDate = (d) => {
  const dt = new Date(Math.round((Number(d) - 25569) * 86400 * 1000));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const anyDate = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return serToDate(v);
  const m = clean(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const anyTime = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const mins = Math.round((v % 1) * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}:00`;
  }
  const m = clean(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}:00` : null;
};
const rows = (file, name) => {
  const wb = XLSX.readFile(file, { cellDates: false });
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`sheet "${name}" not found in ${file}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
};
const H = (t) => { console.log('\n' + '='.repeat(72)); console.log(t); console.log('='.repeat(72)); };

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };
  const plan = { students: [], trials: [], lectures: [], payments: [], fields: [] };

  // Everything is planned first against a read-only view of the database, then
  // applied in one transaction, so a dry run and the real run agree exactly.
  const dbStudents = await q('SELECT id, form_no, full_name, year_grade, school_name, exam_board, father_name, mother_name FROM students');
  const byForm = new Map(dbStudents.map((s) => [String(s.form_no), s]));
  const teachers = await q('SELECT id, name FROM teachers');
  const teacherByName = new Map(teachers.map((t) => [t.name.toLowerCase(), t.id]));

  // ------------------------------------------------------------- 1. STUDENTS
  const master = rows(ANKITA, 'Student Details Master sheet');
  const sheetStudents = [];
  for (let i = 1; i < master.length; i++) {
    const r = master[i];
    const form = clean(r[1]);
    if (!/^\d+$/.test(form)) continue;
    sheetStudents.push({
      form, doj: anyDate(r[2]),
      status: /inactive/i.test(clean(r[3])) ? 'Inactive' : 'Active',
      first: clean(r[4]), middle: clean(r[5]), last: clean(r[6]), full: clean(r[7]),
      grade: clean(r[8]), school: clean(r[9]), board: clean(r[10]),
      father: clean(r[11]), mother: clean(r[12]),
    });
  }
  if (stageOn('students')) for (const s of sheetStudents) if (!byForm.has(s.form)) plan.students.push(s);

  // --------------------------------------------------------------- 2. TRIALS
  // Demo* form numbers appear only in the tracker, never in the master sheet.
  const msRows = rows(FINANCE, 'Master Sheet');
  const lecRaw = [];
  for (let i = 1; i < msRows.length; i++) {
    const r = msRows[i];
    const d = anyDate(r[0]);
    const form = clean(r[2]);
    if (!d || !form) continue;
    lecRaw.push({ date: d, form, name: clean(r[3]), tin: anyTime(r[4]), tout: anyTime(r[5]),
                  hrs: Number(r[6]) || 0, teacher: clean(r[7]) });
  }
  const window = lecRaw.filter((l) => l.date >= FROM && l.date <= TO);
  const demoForms = [...new Set(window.filter((l) => /^demo/i.test(l.form)).map((l) => l.form))];
  let nextTrial = Number((await q("SELECT MAX(CAST(SUBSTRING(form_no,2) AS UNSIGNED)) mx FROM students WHERE form_no REGEXP '^T[0-9]+$'"))[0].mx || 0);
  const demoToForm = new Map();
  if (stageOn('trials')) {
    for (const df of demoForms) {
      const first = window.find((l) => l.form === df);
      const name = clean(first.name) || df;
      // A demo already imported under its own name should not be duplicated.
      const existing = dbStudents.find((s) => s.full_name && s.full_name.toLowerCase() === name.toLowerCase());
      if (existing) { demoToForm.set(df, existing.form_no); continue; }
      const t = `T${++nextTrial}`;
      demoToForm.set(df, t);
      plan.trials.push({ demo: df, form: t, name, started: window.filter((l) => l.form === df).map((l) => l.date).sort()[0] });
    }
  }

  // ------------------------------------------------------------- 3. LECTURES
  if (stageOn('lectures')) {
    // Existing (date, teacher, time_in, student) pairs so a re-run adds nothing.
    const existing = await q(
      `SELECT l.session_date d, l.teacher_id t, l.time_in ti, a.student_id s
         FROM lecture_sessions l JOIN lecture_attendees a ON a.lecture_id=l.id
        WHERE l.is_deleted=FALSE AND l.session_date BETWEEN ? AND ?`, [FROM, TO]);
    const seen = new Set(existing.map((r) => `${r.d}|${r.t}|${r.ti}|${r.s}`));
    for (const l of window) {
      const tid = teacherByName.get(l.teacher.toLowerCase()) || null;
      // Resolve the student: a real form number, or a demo mapped to its T-number.
      const formNo = /^demo/i.test(l.form) ? demoToForm.get(l.form) : l.form;
      const known = byForm.get(String(formNo));
      const plannedNew = plan.students.find((s) => s.form === String(formNo));
      const plannedTrial = plan.trials.find((t) => t.form === String(formNo));
      if (!known && !plannedNew && !plannedTrial) { plan.lectures.push({ ...l, skip: `no student for form ${l.form}` }); continue; }
      if (known && seen.has(`${l.date}|${tid}|${l.tin}|${known.id}`)) continue;
      plan.lectures.push({ ...l, formNo, teacherId: tid, studentId: known ? known.id : null });
    }
  }

  // ------------------------------------------------------------- 4. PAYMENTS
  if (stageOn('payments')) {
    const tf = rows(FINANCE, 'Total Fees From June');
    const dbPays = await q(`SELECT s.form_no f, t.amount a, t.payment_date d FROM fee_transactions t
        JOIN students s ON s.id=t.student_id WHERE t.is_deleted=FALSE`);
    const pk = (f, d, a) => `${String(f).trim()}|${d}|${Number(a).toFixed(2)}`;
    const have = new Set(dbPays.map((r) => pk(r.f, r.d, r.a)));
    for (let i = 1; i < tf.length; i++) {
      const r = tf[i];
      const d = anyDate(r[0]);
      const amt = Number(r[3]) || 0;
      const form = clean(r[6]);
      if (!d || !amt || !form) continue;
      if (have.has(pk(form, d, amt))) continue;
      plan.payments.push({ date: d, amount: amt, ref: clean(r[2]), source: clean(r[4]),
                           parent: clean(r[5]), form, name: clean(r[7]), notes: clean(r[8]),
                           course: clean(r[9]), hours: Number(r[10]) || null });
    }
  }

  // --------------------------------------------------------------- 5. FIELDS
  if (stageOn('fields')) {
    const MAP = [['grade', 'year_grade'], ['school', 'school_name'], ['board', 'exam_board'],
                 ['father', 'father_name'], ['mother', 'mother_name']];
    for (const s of sheetStudents) {
      const d = byForm.get(s.form);
      if (!d) continue;
      const set = {};
      for (const [sk, dk] of MAP) if (s[sk] && !clean(d[dk])) set[dk] = s[sk];
      if (Object.keys(set).length) plan.fields.push({ id: d.id, form: s.form, name: d.full_name, set });
    }
  }

  // ----------------------------------------------------------------- REPORT
  const lecOk = plan.lectures.filter((l) => !l.skip);
  const lecSkip = plan.lectures.filter((l) => l.skip);
  H('PLAN');
  console.log(`  new students   : ${plan.students.length}`);
  for (const s of plan.students) console.log(`      form ${String(s.form).padEnd(5)} ${String(s.full).padEnd(22)} ${s.grade || '-'} / ${s.school || '-'}`);
  console.log(`  new trials     : ${plan.trials.length}`);
  for (const t of plan.trials) console.log(`      ${t.demo} -> ${String(t.form).padEnd(5)} ${String(t.name).padEnd(22)} from ${t.started}`);
  console.log(`  lectures       : ${lecOk.length} to insert, ${lecSkip.length} unresolved`);
  const byDate = {};
  for (const l of lecOk) byDate[l.date] = (byDate[l.date] || 0) + 1;
  console.log(`      ${Object.entries(byDate).map(([d, n]) => `${d.slice(5)}:${n}`).join('  ')}`);
  if (lecSkip.length) {
    const reasons = {};
    for (const l of lecSkip) reasons[l.skip] = (reasons[l.skip] || 0) + 1;
    for (const [r, n] of Object.entries(reasons)) console.log(`      UNRESOLVED ${n} x ${r}`);
  }
  console.log(`  payments       : ${plan.payments.length}  (AED ${plan.payments.reduce((a, b) => a + b.amount, 0).toLocaleString()})`);
  for (const p of plan.payments) console.log(`      ${p.date}  form ${String(p.form).padEnd(5)} ${String(p.name).slice(0, 20).padEnd(20)} AED ${String(p.amount).padStart(7)}  ${p.hours ? p.hours + ' hrs' : 'NO HOURS'}`);
  console.log(`  field fills    : ${plan.fields.length} existing students`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Add --apply to write.\n'); await conn.end(); return; }

  // ------------------------------------------------------------------ APPLY
  await conn.beginTransaction();
  try {
    // form_no -> students.id, extended as this run creates rows.
    const idFor = new Map(dbStudents.map((s) => [String(s.form_no), s.id]));

    for (const s of plan.students) {
      const r = await q(
        `INSERT INTO students (form_no,date_of_joining,status,student_type,first_name,middle_name,last_name,
           full_name,year_grade,school_name,exam_board,father_name,mother_name)
         VALUES (?,?,?,'Enrolled',?,?,?,?,?,?,?,?,?)`,
        [s.form, s.doj || null, s.status, s.first || null, s.middle || null, s.last || null,
         s.full || [s.first, s.last].filter(Boolean).join(' '), s.grade || null, s.school || null,
         s.board || null, s.father || null, s.mother || null]);
      idFor.set(String(s.form), r.insertId);
    }
    for (const t of plan.trials) {
      const r = await q(
        `INSERT INTO students (form_no,status,student_type,trial_started_on,first_name,full_name)
         VALUES (?,'Active','Trial',?,?,?)`,
        [t.form, t.started || null, t.name.split(' ')[0], t.name]);
      idFor.set(String(t.form), r.insertId);
    }

    let lecN = 0;
    for (const l of lecOk) {
      const sid = idFor.get(String(l.formNo));
      if (!sid) continue;
      const s = await q(
        `INSERT INTO lecture_sessions (session_date,month,teacher_id,time_in,time_out,total_hours,hours_rounded)
         VALUES (?,?,?,?,?,?,?)`,
        [l.date, l.date.slice(0, 7), l.teacherId, l.tin, l.tout, l.hrs, l.hrs]);
      await q(`INSERT INTO lecture_attendees (lecture_id,student_id,hours_consumed,attendance_status)
               VALUES (?,?,?, 'Present')`, [s.insertId, sid, l.hrs]);
      lecN++;
    }

    let payN = 0;
    for (const p of plan.payments) {
      const sid = idFor.get(String(p.form));
      if (!sid) continue;
      const t = await q(
        `INSERT INTO fee_transactions (student_id,parent_name,amount,payment_date,month,
           transaction_reference,payment_source,course_package_hours,notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [sid, p.parent || null, p.amount, p.date, p.date.slice(0, 7), p.ref || null,
         p.source || null, p.hours, p.notes || null]);
      // Same rule as POST /fees/transactions: hours on the payment become a package.
      if (p.hours > 0) {
        await q(`INSERT INTO fee_packages (student_id,transaction_id,course_name,package_hours,rate_per_hour,start_date)
                 VALUES (?,?,?,?,?,?)`,
          [sid, t.insertId, p.course || null, p.hours, p.amount / p.hours, p.date]);
      }
      payN++;
    }

    for (const f of plan.fields) {
      const cols = Object.keys(f.set).map((k) => `${k} = ?`).join(', ');
      await q(`UPDATE students SET ${cols} WHERE id = ?`, [...Object.values(f.set), f.id]);
    }

    await q(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
             VALUES (NULL,'IMPORT_SHEETS','batch','0',NULL,?)`,
      [JSON.stringify({ students: plan.students.length, trials: plan.trials.length,
                        lectures: lecN, payments: payN, field_fills: plan.fields.length,
                        window: [FROM, TO] })]);

    await conn.commit();
    console.log(`\nAPPLIED — ${plan.students.length} students, ${plan.trials.length} trials, ${lecN} lectures, ${payN} payments, ${plan.fields.length} field fills`);
  } catch (e) {
    await conn.rollback();
    console.error('\nROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
