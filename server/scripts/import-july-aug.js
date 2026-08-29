// Import July + August 2026 from the Ankita Attendance tracker.
//
//   node scripts/import-july-aug.js            -> DRY RUN, writes nothing
//   node scripts/import-july-aug.js --apply    -> writes, inside one transaction
//
// What it does
//   1. creates students 168-176 (real) and 177-178 (placeholders for two
//      payments whose student is unknown), each with a student + parent login
//   2. inserts the July/August lecture rows and their attendance
//   3. inserts the July/August payments; creates a fee_package only where the
//      sheet gives Package Hours
//   4. skips demo rows and rows with no form number
//
// Nothing existing is updated or deleted. Every statement is an INSERT.
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
const NF = (v) => {
  if (v == null) return '';
  const s = clean(v);
  if (s === '') return '';
  const f = parseFloat(s);
  if (!isNaN(f) && f === Math.floor(f) && /^-?\d+(\.0+)?$/.test(s)) return String(Math.floor(f));
  return s;
};
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
const isJulAug = (d) => d.startsWith('2026-07') || d.startsWith('2026-08');

// canonical lookups — we fix spelling on the way in
const SUBJECTS = ['Biology', 'Chemistry', 'Maths', 'Physics', 'Science'];
function canonSubject(raw) {
  const s = clean(raw);
  if (!s || s.includes('/')) return null;      // combined subjects need a human decision
  const l = s.toLowerCase();
  if (l.startsWith('math')) return 'Maths';
  if (l.startsWith('phys')) return 'Physics';
  if (l.startsWith('chem')) return 'Chemistry';
  if (l.startsWith('bio')) return 'Biology';
  if (l.startsWith('sci')) return 'Science';
  return null;
}
function canonVenue(raw) {
  const k = clean(raw).toLowerCase().replace(/\s+/g, '');
  if (!k) return null;
  if (k === 'jlt') return 'JLT';
  if (k === 'online' || k === 'onlline') return 'Online';
  if (k === 'offline') return 'Offline';
  if (k === 'oudmetha' || k === 'ovdmehta') return 'Oud Metha';
  if (['incentre', 'incenter', 'centre', 'center'].includes(k)) return 'In-Centre';
  return clean(raw);
}
const slug = (n) => {
  if (!n) return null;
  const s = String(n).trim().toLowerCase().replace(/^(dr|mr|mrs|ms|miss)[.\s]+/i, '');
  return (s.split(/\s+/)[0] || '').replace(/[^a-z0-9]/g, '') || null;
};

// two payments whose student is unknown -> placeholder students
const PLACEHOLDER = {
  '2026-08-04|2100': { form: '177', parent: 'MANZOOR AHMED ALLAM' },
  '2026-08-15|4200': { form: '178', parent: 'MR SATISH SRIVASTAVA' },
};

// ---------------------------------------------------------------- read sheet
const wb = XLSX.readFile(SRC);
function sheet(re) {
  const nm = wb.SheetNames.find((x) => re.test(x));
  if (!nm) throw new Error('sheet not found: ' + re);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '' });
  let hr = 0;
  for (let i = 0; i < Math.min(8, rows.length); i++)
    if (rows[i].some((c) => clean(c).toLowerCase() === 'form no')) { hr = i; break; }
  const h = rows[hr].map(clean);
  return {
    name: nm, h,
    d: rows.slice(hr + 1).map((r, i) => [i + hr + 2, r]).filter(([, r]) => r.some((v) => v !== '' && v != null)),
    i: (n) => h.findIndex((x) => x.toLowerCase() === n.toLowerCase()),
  };
}
const L = sheet(/combined tracker/i);
const P = sheet(/total fees/i);
const M = sheet(/student details master/i);

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const before = await q(`SELECT
    (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM users) users,
    (SELECT COUNT(*) FROM parents) parents, (SELECT COUNT(*) FROM lecture_sessions) lectures,
    (SELECT COUNT(*) FROM lecture_attendees) attendees,
    (SELECT COUNT(*) FROM fee_transactions) payments, (SELECT COUNT(*) FROM fee_packages) packages`);
  console.log('BEFORE:', before[0]);

  // ---- existing keys ----
  const stuByForm = new Map((await q('SELECT id, form_no FROM students')).map((r) => [NF(r.form_no), r.id]));
  const teaByName = new Map((await q('SELECT id, name FROM teachers')).map((r) => [clean(r.name).toLowerCase(), r.id]));
  const subByName = new Map((await q('SELECT id, name FROM subjects')).map((r) => [clean(r.name).toLowerCase(), r.id]));
  const takenUser = new Set((await q('SELECT LOWER(email) e FROM users')).map((r) => r.e));
  const lecKey = new Set((await q(
    `SELECT l.session_date d, s.form_no f, l.time_in t FROM lecture_sessions l
     JOIN lecture_attendees a ON a.lecture_id=l.id JOIN students s ON s.id=a.student_id`
  )).map((r) => `${String(r.d).slice(0, 10)}|${NF(r.f)}|${String(r.t || '').slice(0, 5)}`));
  const payKey = new Set((await q(
    `SELECT f.payment_date d, s.form_no f, f.amount a FROM fee_transactions f
     JOIN students s ON s.id=f.student_id`
  )).map((r) => `${String(r.d).slice(0, 10)}|${NF(r.f)}|${Number(r.a).toFixed(2)}`));

  const pickUser = (base) => {
    if (!base) return null;
    if (!takenUser.has(base)) { takenUser.add(base); return base; }
    for (let i = 1; i < 99; i++) {
      const t = base + i;
      if (!takenUser.has(t)) { takenUser.add(t); return t; }
    }
    return null;
  };

  // ---------------------------------------------------------- plan: students
  const mF = M.i('Form No'), mN = M.i('Full Name'), mFirst = M.i('First'), mLast = M.i('Last Name'),
        mSt = M.i('Active/Inactive'), mY = M.i('Year/Grade'), mSc = M.i('School'), mB = M.i('Exam Board'),
        mFa = M.i('Father Name'), mMo = M.i('Mother Name'), mMob = M.i('Student Mob no'), mPM = M.i('Parent Mob No');
  const masterByForm = new Map(M.d.map(([, r]) => [NF(r[mF]), r]).filter(([f]) => f));

  const iD = L.i('DATE'), iF = L.i('Form No'), iTi = L.i('Time In'), iTo = L.i('Time Out'),
        iH = L.i('No of Hrs'), iTc = L.i('Name of Teacher'), iS = L.i('Subject'),
        iV = L.i('Venue'), iTp = L.i('Topic/Remark'), iSn = L.i('Student Name');
  const jD = P.i('Date'), jF = P.i('Form No'), jN = P.i('Student name'), jC = P.i('Credit'),
        jS = P.i('Payment Source'), jT = P.i('Transaction'), jR = P.i('Reference Number'),
        jP = P.i('Package Hours'), jPar = P.i('Parent name'), jNo = P.i('Notes');

  const needStudent = new Map();   // form -> {name, source}
  const lecPlan = [];
  const skipped = { noForm: 0, demo: 0, already: 0, dup: 0 };
  const seen = new Set();

  for (const [rowNo, r] of L.d) {
    const date = anyDate(r[iD]);
    if (!date || !isJulAug(date)) continue;
    const form = NF(r[iF]);
    const key = `${date}|${form}|${(anyTime(r[iTi]) || '').slice(0, 5)}`;
    if (lecKey.has(key)) { skipped.already++; continue; }
    if (/^demo/i.test(form)) { skipped.demo++; continue; }
    if (!form) { skipped.noForm++; continue; }
    if (seen.has(key)) { skipped.dup++; continue; }
    seen.add(key);
    const hrs = parseFloat(r[iH]);
    if (!(hrs > 0)) { skipped.noForm++; continue; }
    if (!stuByForm.has(form)) needStudent.set(form, { name: clean(r[iSn]), source: 'lecture' });
    lecPlan.push({
      rowNo, date, form, month: date.slice(0, 7),
      time_in: anyTime(r[iTi]), time_out: anyTime(r[iTo]),
      hours: hrs, teacher: clean(r[iTc]), subject: canonSubject(r[iS]),
      venue: canonVenue(r[iV]), topic: clean(r[iTp]) || null,
    });
  }

  const payPlan = [];
  const pSkip = { already: 0 };
  for (const [rowNo, r] of P.d) {
    const date = anyDate(r[jD]);
    if (!date || !isJulAug(date)) continue;
    const amt = parseFloat(r[jC]) || 0;
    let form = NF(r[jF]);
    let placeholderParent = null;
    if (!form) {
      const ph = PLACEHOLDER[`${date}|${Math.round(amt)}`];
      if (!ph) continue;
      form = ph.form;
      placeholderParent = ph.parent;
      needStudent.set(form, { name: `Unnamed - child of ${ph.parent}`, source: 'placeholder', parent: ph.parent });
    }
    if (payKey.has(`${date}|${form}|${amt.toFixed(2)}`)) { pSkip.already++; continue; }
    if (!stuByForm.has(form) && !needStudent.has(form)) {
      needStudent.set(form, { name: clean(r[jN]), source: 'payment' });
    }
    const pk = clean(r[jP]);
    payPlan.push({
      rowNo, date, form, month: date.slice(0, 7), amount: amt,
      parent_name: placeholderParent || clean(r[jPar]) || null,
      reference: clean(r[jR]) || null, source: clean(r[jS]) || null,
      package_hours: pk === '' ? null : (parseFloat(pk) || 0),
      notes: clean(r[jNo]) || null,
    });
  }

  // students to create, in form order
  const stuPlan = [...needStudent.entries()]
    .sort((a, b) => (+a[0] || 0) - (+b[0] || 0))
    .map(([form, info]) => {
      const m = masterByForm.get(form);
      const full = clean(m ? m[mN] : '') || info.name || `Student ${form}`;
      const parentName = info.parent || clean(m ? m[mFa] : '') || clean(m ? m[mMo] : '') || null;
      let status = clean(m ? m[mSt] : 'Active');
      if (!['Active', 'Inactive'].includes(status)) status = 'Active';   // SP-/LP-/PK-Active -> Active
      return {
        form, full,
        first: clean(m ? m[mFirst] : '') || full.split(' ')[0] || null,
        last: clean(m ? m[mLast] : '') || null,
        status,
        year_grade: clean(m ? m[mY] : '') || null,
        school: clean(m ? m[mSc] : '') || null,
        board: clean(m ? m[mB] : '') || null,
        father: clean(m ? m[mFa] : '') || info.parent || null,
        mother: clean(m ? m[mMo] : '') || null,
        mobile: clean(m ? m[mMob] : '') || null,
        parent_mobile: clean(m ? m[mPM] : '') || null,
        parentName,
        placeholder: info.source === 'placeholder',
        userLogin: null, parentLogin: null,
      };
    });
  for (const s of stuPlan) {
    s.userLogin = pickUser(s.placeholder ? `student${s.form}` : slug(s.full));
    s.parentLogin = pickUser(s.parentName ? slug(s.parentName) : `${slug(s.full) || 'student' + s.form}parent`);
  }

  // ---------------------------------------------------------------- report
  const unknownTeacher = [...new Set(lecPlan.map((l) => l.teacher).filter((t) => t && !teaByName.has(t.toLowerCase())))];
  const withHours = payPlan.filter((p) => p.package_hours != null);
  console.log('\nPLAN');
  console.log(`  students to create : ${stuPlan.length}`);
  for (const s of stuPlan)
    console.log(`      ${s.form.padEnd(4)} ${s.full.slice(0, 34).padEnd(34)} login ${String(s.userLogin).padEnd(13)} parent ${String(s.parentLogin).padEnd(15)}${s.placeholder ? ' [PLACEHOLDER]' : ''}`);
  console.log(`  lecture rows       : ${lecPlan.length}`);
  console.log(`      skipped already in db : ${skipped.already}`);
  console.log(`      skipped demo          : ${skipped.demo}`);
  console.log(`      skipped no form/hours : ${skipped.noForm}`);
  console.log(`      skipped duplicate     : ${skipped.dup}`);
  console.log(`      blank subject         : ${lecPlan.filter((l) => !l.subject).length}`);
  console.log(`      unknown teacher       : ${unknownTeacher.join(', ') || '(none)'}`);
  console.log(`      total hours           : ${lecPlan.reduce((a, b) => a + b.hours, 0).toFixed(1)}`);
  console.log(`  payments           : ${payPlan.length}  (AED ${payPlan.reduce((a, b) => a + b.amount, 0).toLocaleString()})`);
  console.log(`      with package hours    : ${withHours.length}  -> ${withHours.reduce((a, b) => a + b.package_hours, 0)} hrs credited`);
  console.log(`      without hours         : ${payPlan.length - withHours.length}  (no fee_package created)`);
  console.log(`      skipped already in db : ${pSkip.already}`);

  if (unknownTeacher.length) { console.error('\nABORT: unknown teacher(s) — add them first.'); await conn.end(); return; }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
    await conn.end();
    return;
  }

  // ---------------------------------------------------------------- write
  const hash = await bcrypt.hash(PASSWORD, 10);
  await conn.beginTransaction();
  try {
    const created = [];
    for (const s of stuPlan) {
      const u = await q(
        `INSERT INTO users (role,email,password_hash,display_name) VALUES ('student',?,?,?)`,
        [s.userLogin, hash, s.full]);
      const st = await q(
        `INSERT INTO students (form_no,status,first_name,last_name,full_name,year_grade,school_name,
           exam_board,father_name,mother_name,student_mobile,parent_mobile,user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.form, s.status, s.first, s.last, s.full, s.year_grade, s.school, s.board,
         s.father, s.mother, s.mobile, s.parent_mobile, u.insertId]);
      stuByForm.set(s.form, st.insertId);
      const pu = await q(
        `INSERT INTO users (role,email,password_hash,display_name) VALUES ('parent',?,?,?)`,
        [s.parentLogin, hash, s.parentName || `Parent of ${s.full}`]);
      await q(`INSERT INTO parents (student_id,user_id,name,mobile) VALUES (?,?,?,?)`,
        [st.insertId, pu.insertId, s.parentName || null, s.parent_mobile]);
      created.push(s.form);
    }

    let lec = 0;
    for (const l of lecPlan) {
      const sid = stuByForm.get(l.form);
      if (!sid) continue;
      const tid = l.teacher ? teaByName.get(l.teacher.toLowerCase()) || null : null;
      const subId = l.subject ? subByName.get(l.subject.toLowerCase()) || null : null;
      const s = await q(
        `INSERT INTO lecture_sessions (session_date,month,teacher_id,subject_id,time_in,time_out,
           total_hours,hours_rounded,topic,venue) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [l.date, l.month, tid, subId, l.time_in, l.time_out, l.hours, l.hours, l.topic, l.venue]);
      await q(`INSERT INTO lecture_attendees (lecture_id,student_id,hours_consumed,attendance_status)
               VALUES (?,?,?,'Present')`, [s.insertId, sid, l.hours]);
      lec++;
    }

    let pay = 0, pkg = 0;
    for (const p of payPlan) {
      const sid = stuByForm.get(p.form);
      if (!sid) continue;
      const t = await q(
        `INSERT INTO fee_transactions (student_id,parent_name,amount,payment_date,month,
           transaction_reference,payment_source,course_package_hours,notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [sid, p.parent_name, p.amount, p.date, p.month, p.reference, p.source, p.package_hours, p.notes]);
      pay++;
      if (p.package_hours != null && p.package_hours > 0) {
        await q(
          `INSERT INTO fee_packages (student_id,transaction_id,package_hours,rate_per_hour,start_date)
           VALUES (?,?,?,?,?)`,
          [sid, t.insertId, p.package_hours, 0, p.date]);
        pkg++;
      }
    }

    await conn.commit();
    console.log(`\nAPPLIED — students ${created.length}, lectures ${lec}, payments ${pay}, packages ${pkg}`);
    const after = await q(`SELECT
      (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM users) users,
      (SELECT COUNT(*) FROM parents) parents, (SELECT COUNT(*) FROM lecture_sessions) lectures,
      (SELECT COUNT(*) FROM lecture_attendees) attendees,
      (SELECT COUNT(*) FROM fee_transactions) payments, (SELECT COUNT(*) FROM fee_packages) packages`);
    console.log('AFTER :', after[0]);
    fs.writeFileSync(path.join(__dirname, 'import-july-aug-created.json'),
      JSON.stringify({ students: created, lectures: lec, payments: pay, packages: pkg }, null, 1));
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
