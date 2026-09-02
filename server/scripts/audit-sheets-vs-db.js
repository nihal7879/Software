// Read-only reconciliation of the two source workbooks against the database.
//
//   node scripts/audit-sheets-vs-db.js
//
// Writes nothing. Reports, per source sheet, what the workbook holds, what the
// database holds, and what is missing on either side — so the actual import can
// be scoped from evidence instead of guesswork.
//
// Date handling matches the existing importers: sheets are read as raw serials
// and converted with the 25569 epoch offset using UTC getters. Reading with
// cellDates instead yields Date objects already shifted by the local timezone,
// which lands lectures on the wrong day.
require('dotenv').config();
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const ANKITA = process.env.TRACKER_SRC || 'C:/Users/dell/Downloads/Ankita Attendance tracker.xlsx';
const FINANCE = process.env.FINANCE_SRC || 'C:/Users/dell/Downloads/Final Finance Sheet.xlsx';

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

const sheet = (file, name) => {
  const wb = XLSX.readFile(file, { cellDates: false });
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
};

const H = (t) => { console.log('\n' + '='.repeat(74)); console.log(t); console.log('='.repeat(74)); };

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await c.query(s, p); return r; };

  // ------------------------------------------------------------------ LECTURES
  H('1. LECTURES — "Master Sheet" (Final Finance) vs lecture_sessions');
  const ms = sheet(FINANCE, 'Master Sheet');
  const lec = [];
  for (let i = 1; i < ms.length; i++) {
    const r = ms[i];
    const d = anyDate(r[0]);
    const form = clean(r[2]);
    if (!d || !form) continue;
    lec.push({
      date: d, form, name: clean(r[3]),
      tin: anyTime(r[4]), tout: anyTime(r[5]),
      hrs: Number(r[6]) || 0, teacher: clean(r[7]),
    });
  }
  const dates = lec.map((l) => l.date).sort();
  console.log(`  sheet rows parsed : ${lec.length}`);
  console.log(`  sheet date range  : ${dates[0]}  ->  ${dates[dates.length - 1]}`);

  const dbRange = await q(`SELECT MIN(session_date) mn, MAX(session_date) mx, COUNT(*) n FROM lecture_sessions WHERE is_deleted=FALSE`);
  console.log(`  db  date range    : ${dbRange[0].mn}  ->  ${dbRange[0].mx}   (${dbRange[0].n} sessions)`);

  // per-month comparison, sheet vs db
  const byMonthSheet = new Map();
  for (const l of lec) byMonthSheet.set(l.date.slice(0, 7), (byMonthSheet.get(l.date.slice(0, 7)) || 0) + 1);
  const dbMonths = await q(`SELECT LEFT(l.session_date,7) m, COUNT(DISTINCT a.id) n
      FROM lecture_sessions l JOIN lecture_attendees a ON a.lecture_id=l.id
      WHERE l.is_deleted=FALSE GROUP BY m ORDER BY m`);
  const dbMap = new Map(dbMonths.map((r) => [r.m, r.n]));
  const allMonths = [...new Set([...byMonthSheet.keys(), ...dbMap.keys()])].sort();
  console.log('\n  month     sheet     db    gap');
  for (const m of allMonths) {
    const s = byMonthSheet.get(m) || 0, d = dbMap.get(m) || 0;
    const gap = s - d;
    console.log(`  ${m}   ${String(s).padStart(5)} ${String(d).padStart(7)} ${String(gap === 0 ? '-' : (gap > 0 ? '+' + gap : gap)).padStart(6)}`);
  }

  // the window the client asked about
  const FROM = process.env.FROM || '2026-08-17';
  const TO = process.env.TO || '2026-09-01';
  const win = lec.filter((l) => l.date >= FROM && l.date <= TO);
  H(`2. THE WINDOW ${FROM} .. ${TO}`);
  console.log(`  sheet lecture rows in window : ${win.length}`);
  const dbWin = await q(`SELECT COUNT(DISTINCT a.id) n FROM lecture_sessions l JOIN lecture_attendees a ON a.lecture_id=l.id
      WHERE l.is_deleted=FALSE AND l.session_date BETWEEN ? AND ?`, [FROM, TO]);
  console.log(`  db attendance rows in window : ${dbWin[0].n}`);
  if (win.length) {
    const wd = [...new Set(win.map((l) => l.date))].sort();
    console.log(`  dates present in sheet       : ${wd.join(', ')}`);
    const forms = [...new Set(win.map((l) => l.form))];
    console.log(`  distinct students in window  : ${forms.length}`);
    const known = await q(`SELECT form_no FROM students WHERE form_no IN (?)`, [forms]);
    const knownSet = new Set(known.map((r) => String(r.form_no)));
    const unknown = forms.filter((f) => !knownSet.has(String(f)));
    console.log(`  form numbers NOT in database : ${unknown.length ? unknown.join(', ') : 'none'}`);
    const teachers = [...new Set(win.map((l) => l.teacher).filter(Boolean))];
    const dbT = await q('SELECT name FROM teachers');
    const dbTset = new Set(dbT.map((r) => r.name.toLowerCase()));
    const missT = teachers.filter((t) => !dbTset.has(t.toLowerCase()));
    console.log(`  teachers NOT in database     : ${missT.length ? missT.join(', ') : 'none'}`);
  }

  // ------------------------------------------------------------------ PAYMENTS
  H('3. PAYMENTS — "Total Fees From June" vs fee_transactions');
  const tf = sheet(FINANCE, 'Total Fees From June');
  const pays = [];
  for (let i = 1; i < tf.length; i++) {
    const r = tf[i];
    const d = anyDate(r[0]);
    const amt = Number(r[3]) || 0;
    if (!d || !amt) continue;
    pays.push({ date: d, amount: amt, source: clean(r[4]), parent: clean(r[5]),
                form: clean(r[6]), name: clean(r[7]), notes: clean(r[8]),
                course: clean(r[9]), hours: Number(r[10]) || null, ref: clean(r[2]) });
  }
  const pd = pays.map((p) => p.date).sort();
  console.log(`  sheet payments parsed : ${pays.length}   total AED ${pays.reduce((a, b) => a + b.amount, 0).toLocaleString()}`);
  console.log(`  sheet date range      : ${pd[0]} -> ${pd[pd.length - 1]}`);
  const dbPay = await q('SELECT COUNT(*) n, SUM(amount) t, MIN(payment_date) mn, MAX(payment_date) mx FROM fee_transactions WHERE is_deleted=FALSE');
  console.log(`  db payments           : ${dbPay[0].n}   total AED ${Number(dbPay[0].t).toLocaleString()}`);
  console.log(`  db date range         : ${dbPay[0].mn} -> ${dbPay[0].mx}`);

  // match sheet payments to db on (form, date, amount)
  const dbAll = await q(`SELECT t.id, s.form_no, t.amount, t.payment_date FROM fee_transactions t
      JOIN students s ON s.id=t.student_id WHERE t.is_deleted=FALSE`);
  const key = (f, d, a) => `${String(f).trim()}|${d}|${Number(a).toFixed(2)}`;
  const dbKeys = new Set(dbAll.map((r) => key(r.form_no, r.payment_date, r.amount)));
  const missingPays = pays.filter((p) => !dbKeys.has(key(p.form, p.date, p.amount)));
  console.log(`\n  payments in sheet but NOT in db : ${missingPays.length}`);
  for (const p of missingPays.slice(0, 25))
    console.log(`    ${p.date}  form ${String(p.form).padEnd(5)} ${String(p.name).slice(0, 22).padEnd(22)} AED ${String(p.amount).padStart(8)}  ${p.hours ? p.hours + ' hrs' : ''}`);
  if (missingPays.length > 25) console.log(`    … and ${missingPays.length - 25} more`);

  // ------------------------------------------------------------------ STUDENTS
  H('4. STUDENTS — "Student Details Master sheet" vs students');
  const sm = sheet(ANKITA, 'Student Details Master sheet');
  const studs = [];
  for (let i = 1; i < sm.length; i++) {
    const r = sm[i];
    const form = clean(r[1]);
    if (!form || !/^\d+$/.test(form)) continue;
    studs.push({ form, doj: anyDate(r[2]), status: clean(r[3]), full: clean(r[7]),
                 grade: clean(r[8]), school: clean(r[9]), board: clean(r[10]),
                 father: clean(r[11]), mother: clean(r[12]) });
  }
  console.log(`  sheet students : ${studs.length}`);
  const dbStuds = await q('SELECT form_no, full_name, year_grade, school_name, exam_board, father_name, mother_name, status FROM students');
  const dbByForm = new Map(dbStuds.map((s) => [String(s.form_no), s]));
  console.log(`  db students    : ${dbStuds.length}`);
  const missingStuds = studs.filter((s) => !dbByForm.has(s.form));
  console.log(`\n  in sheet but NOT in db : ${missingStuds.length}`);
  for (const s of missingStuds.slice(0, 20)) console.log(`    form ${String(s.form).padEnd(5)} ${s.full}`);

  // field-level gaps for students that DO exist
  const FIELDS = [['grade', 'year_grade'], ['school', 'school_name'], ['board', 'exam_board'],
                  ['father', 'father_name'], ['mother', 'mother_name']];
  let blanks = 0; const blankRows = [];
  for (const s of studs) {
    const d = dbByForm.get(s.form);
    if (!d) continue;
    const miss = FIELDS.filter(([sk, dk]) => s[sk] && !clean(d[dk])).map(([sk]) => sk);
    if (miss.length) { blanks++; blankRows.push(`    form ${String(s.form).padEnd(5)} ${String(s.full).slice(0, 24).padEnd(24)} db missing: ${miss.join(', ')}`); }
  }
  console.log(`\n  existing students with fields the sheet can fill : ${blanks}`);
  blankRows.slice(0, 20).forEach((l) => console.log(l));
  if (blankRows.length > 20) console.log(`    … and ${blankRows.length - 20} more`);

  // ------------------------------------------------------------------ SHEET154
  H('5. LEDGER — "Sheet154" vs the hours the database computes');
  const s154 = sheet(FINANCE, 'Sheet154');
  const led = [];
  for (let i = 1; i < s154.length; i++) {
    const r = s154[i];
    const form = clean(r[0]);
    if (!form || !/^\d+$/.test(form)) continue;
    led.push({ form, status: clean(r[1]), name: clean(r[2]), credited: Number(r[3]) || 0,
               committed: Number(r[5]) || 0, discount: Number(r[6]) || 0, adjusted: Number(r[7]) || 0,
               totalCredited: Number(r[8]) || 0, consumed: Number(r[9]) || 0,
               left: Number(r[10]) || 0, rate: Number(r[11]) || 0, pending: Number(r[12]) || 0 });
  }
  console.log(`  sheet154 rows : ${led.length}`);
  const dbHours = await q(`SELECT s.form_no, ROUND(h.total_hours_credited,2) credited, ROUND(h.total_hours_consumed,2) consumed, ROUND(h.hours_left,2) left_
      FROM students s JOIN student_hours_summary h ON h.student_id=s.id`);
  const dbH = new Map(dbHours.map((r) => [String(r.form_no), r]));
  let diff = 0; const diffRows = [];
  for (const l of led) {
    const d = dbH.get(l.form);
    if (!d) continue;
    const dc = Math.abs(Number(d.credited) - l.totalCredited);
    const dk = Math.abs(Number(d.consumed) - l.consumed);
    if (dc > 0.51 || dk > 0.51) {
      diff++;
      diffRows.push(`    form ${String(l.form).padEnd(5)} ${String(l.name).slice(0, 20).padEnd(20)} credited sheet ${String(l.totalCredited).padStart(8)} db ${String(d.credited).padStart(8)}  |  consumed sheet ${String(l.consumed.toFixed(2)).padStart(8)} db ${String(d.consumed).padStart(8)}`);
    }
  }
  console.log(`  students where sheet154 and db disagree by > 0.5h : ${diff}`);
  diffRows.slice(0, 25).forEach((l) => console.log(l));
  if (diffRows.length > 25) console.log(`    … and ${diffRows.length - 25} more`);

  await c.end();
  H('END OF AUDIT — nothing was written');
})().catch((e) => { console.error(e); process.exit(1); });
