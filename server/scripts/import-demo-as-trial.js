// Import the five demo students from the tracker as Trial students.
//
//   node scripts/import-demo-as-trial.js            -> DRY RUN
//   node scripts/import-demo-as-trial.js --apply    -> writes, in one transaction
//
// They were skipped by import-july-aug.js because their form numbers were
// 'demo', 'demo2', 'Demo3', 'Demo4', 'Demo6'. Now that students.student_type
// exists they can come in properly:
//   - a real numeric form number, so nothing has to be renumbered if they enroll
//   - student_type = 'Trial', status = 'Active'
//   - trial_started_on = the date of their trial lecture
//   - a zero-cost 'Trial' fee_package equal to the hours they actually used, so
//     the ledger reads 0 hours left (trial used up) rather than a negative
//     balance that would wrongly flag them as Payment Required
//   - their trial lecture and attendance
//   - a student login and a parent login, same convention as everyone else
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

const APPLY = process.argv.includes('--apply');
const SRC = process.env.IMPORT_SRC || 'C:/Users/dell/Downloads/Ankita Attendance tracker.xlsx';
const PASSWORD = '12345678';

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
    const mins = Math.round(v * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}:00`;
  }
  const m = clean(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}:00` : null;
};
const slug = (n) => {
  if (!n) return null;
  const s = String(n).trim().toLowerCase().replace(/^(dr|mr|mrs|ms|miss)[.\s]+/i, '');
  return (s.split(/\s+/)[0] || '').replace(/[^a-z0-9]/g, '') || null;
};
function canonSubject(raw) {
  const s = clean(raw);
  if (!s || s.includes('/')) return null;
  const l = s.toLowerCase();
  if (l.startsWith('math')) return 'Maths';
  if (l.startsWith('phys')) return 'Physics';
  if (l.startsWith('chem')) return 'Chemistry';
  if (l.startsWith('bio')) return 'Biology';
  if (l.startsWith('sci')) return 'Science';
  return null;
}

const wb = XLSX.readFile(SRC);
function sheet(re) {
  const nm = wb.SheetNames.find((x) => re.test(x));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '' });
  let hr = 0;
  for (let i = 0; i < Math.min(8, rows.length); i++)
    if (rows[i].some((c) => clean(c).toLowerCase() === 'form no')) { hr = i; break; }
  const h = rows[hr].map(clean);
  return {
    h, d: rows.slice(hr + 1).map((r, i) => [i + hr + 2, r]).filter(([, r]) => r.some((v) => v !== '' && v != null)),
    i: (n) => h.findIndex((x) => x.toLowerCase() === n.toLowerCase()),
  };
}
const L = sheet(/combined tracker/i);
const M = sheet(/student details master/i);

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const iF = L.i('Form No'), iD = L.i('DATE'), iTi = L.i('Time In'), iTo = L.i('Time Out'),
        iH = L.i('No of Hrs'), iTc = L.i('Name of Teacher'), iS = L.i('Subject'),
        iV = L.i('Venue'), iTp = L.i('Topic/Remark'), iSn = L.i('Student Name');
  const mF = M.i('Form No'), mN = M.i('Full Name'), mY = M.i('Year/Grade'), mSc = M.i('School'),
        mB = M.i('Exam Board'), mFa = M.i('Father Name'), mMo = M.i('Mother Name');
  const master = new Map(M.d.map(([, r]) => [clean(r[mF]), r]));

  // one entry per demo form number, with all their lectures
  const demos = new Map();
  for (const [rowNo, r] of L.d) {
    const key = clean(r[iF]);
    if (!/^demo/i.test(key)) continue;
    if (!demos.has(key)) demos.set(key, { key, name: clean(r[iSn]), lectures: [] });
    demos.get(key).lectures.push({
      rowNo, date: anyDate(r[iD]), time_in: anyTime(r[iTi]), time_out: anyTime(r[iTo]),
      hours: parseFloat(r[iH]) || 0, teacher: clean(r[iTc]), subject: canonSubject(r[iS]),
      venue: clean(r[iV]) || null, topic: clean(r[iTp]) || null,
    });
  }

  // already imported?
  const existingNames = new Set((await q(
    "SELECT full_name FROM students WHERE student_type = 'Trial'")).map((r) => clean(r.full_name).toLowerCase()));
  const teaByName = new Map((await q('SELECT id,name FROM teachers')).map((r) => [clean(r.name).toLowerCase(), r.id]));
  const subByName = new Map((await q('SELECT id,name FROM subjects')).map((r) => [clean(r.name).toLowerCase(), r.id]));
  const takenUser = new Set((await q('SELECT LOWER(email) e FROM users')).map((r) => r.e));
  const pickUser = (base) => {
    if (!base) return null;
    if (!takenUser.has(base)) { takenUser.add(base); return base; }
    for (let i = 1; i < 99; i++) { const t = base + i; if (!takenUser.has(t)) { takenUser.add(t); return t; } }
    return null;
  };
  const [{ mx }] = await q("SELECT MAX(CAST(form_no AS UNSIGNED)) mx FROM students WHERE form_no REGEXP '^[0-9]+$'");
  let nextForm = Number(mx) + 1;

  const plan = [];
  for (const d of [...demos.values()].sort((a, b) => a.lectures[0].date.localeCompare(b.lectures[0].date))) {
    if (existingNames.has(d.name.toLowerCase())) { console.log(`  skip ${d.name} — already a trial student`); continue; }
    const m = master.get(d.key);
    const hours = d.lectures.reduce((a, b) => a + b.hours, 0);
    plan.push({
      oldKey: d.key, form: String(nextForm++), name: d.name,
      year_grade: clean(m ? m[mY] : '') || null,
      school: clean(m ? m[mSc] : '') || null,
      board: clean(m ? m[mB] : '') || null,
      father: clean(m ? m[mFa] : '') || null,
      mother: clean(m ? m[mMo] : '') || null,
      trialStart: d.lectures[0].date,
      trialHours: hours,
      lectures: d.lectures,
      userLogin: pickUser(slug(d.name)),
      parentLogin: pickUser(`${slug(d.name)}parent`),
    });
  }

  console.log('\nDEMO STUDENTS TO IMPORT AS TRIALS');
  console.log('%s', '-'.repeat(104));
  console.log('  old key   new form  name              trial start   hours  login          parent login    lectures');
  for (const p of plan)
    console.log(`  ${p.oldKey.padEnd(9)} ${p.form.padEnd(9)} ${p.name.slice(0, 17).padEnd(17)} ${p.trialStart.padEnd(13)} ${String(p.trialHours).padEnd(6)} ${String(p.userLogin).padEnd(14)} ${String(p.parentLogin).padEnd(15)} ${p.lectures.length}`);
  const unknownT = [...new Set(plan.flatMap((p) => p.lectures.map((l) => l.teacher))
    .filter((t) => t && !teaByName.has(t.toLowerCase())))];
  console.log(`\n  total trial hours granted : ${plan.reduce((a, b) => a + b.trialHours, 0)}`);
  console.log(`  unknown teachers          : ${unknownT.join(', ') || '(none)'}`);
  if (unknownT.length) { console.error('ABORT — add those teachers first.'); await conn.end(); return; }
  if (!plan.length) { console.log('\nNothing to import.'); await conn.end(); return; }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await conn.end(); return; }

  const hash = await bcrypt.hash(PASSWORD, 10);
  await conn.beginTransaction();
  try {
    const done = [];
    for (const p of plan) {
      const u = await q(`INSERT INTO users (role,email,password_hash,display_name) VALUES ('student',?,?,?)`,
        [p.userLogin, hash, p.name]);
      const st = await q(
        `INSERT INTO students (form_no,status,student_type,trial_started_on,first_name,full_name,
           year_grade,school_name,exam_board,father_name,mother_name,user_id)
         VALUES (?,'Active','Trial',?,?,?,?,?,?,?,?,?)`,
        [p.form, p.trialStart, p.name.split(' ')[0], p.name, p.year_grade, p.school, p.board,
         p.father, p.mother, u.insertId]);
      const sid = st.insertId;
      const pu = await q(`INSERT INTO users (role,email,password_hash,display_name) VALUES ('parent',?,?,?)`,
        [p.parentLogin, hash, p.father || p.mother || `Parent of ${p.name}`]);
      await q(`INSERT INTO parents (student_id,user_id,name) VALUES (?,?,?)`,
        [sid, pu.insertId, p.father || p.mother || null]);
      // free trial allowance = the hours actually taught, so the ledger nets to zero
      await q(`INSERT INTO fee_packages (student_id,course_name,package_hours,rate_per_hour,start_date)
               VALUES (?,'Trial',?,0,?)`, [sid, p.trialHours, p.trialStart]);
      for (const l of p.lectures) {
        const s = await q(
          `INSERT INTO lecture_sessions (session_date,month,teacher_id,subject_id,time_in,time_out,
             total_hours,hours_rounded,topic,venue) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [l.date, l.date.slice(0, 7), teaByName.get(l.teacher.toLowerCase()) || null,
           l.subject ? subByName.get(l.subject.toLowerCase()) || null : null,
           l.time_in, l.time_out, l.hours, l.hours, l.topic, l.venue]);
        await q(`INSERT INTO lecture_attendees (lecture_id,student_id,hours_consumed,attendance_status)
                 VALUES (?,?,?,'Present')`, [s.insertId, sid, l.hours]);
      }
      done.push({ form: p.form, name: p.name, login: p.userLogin });
    }
    await conn.commit();
    console.log(`\nAPPLIED — ${done.length} trial students created`);
    console.table(await q(
      `SELECT s.form_no, s.full_name, s.student_type, s.trial_started_on,
         ROUND(h.total_hours_credited,1) credited, ROUND(h.total_hours_consumed,1) consumed,
         ROUND(h.hours_left,1) hours_left, h.fee_status
       FROM students s JOIN student_hours_summary h ON h.student_id = s.id
       WHERE s.student_type = 'Trial' ORDER BY CAST(s.form_no AS UNSIGNED)`));
    fs.writeFileSync(path.join(__dirname, 'import-demo-as-trial-created.json'), JSON.stringify(done, null, 1));
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
