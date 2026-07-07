// Re-import student attendance (consumed hours) from Final.xlsx "Master Sheet",
// the complete/updated tracker. Students that Master Sheet does NOT cover keep
// their existing attendance ("use both" — fall back where one is empty).
// One lecture_session + one lecture_attendee per row. Backs up first, one txn.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const pad = (n) => String(n).padStart(2, '0');
const serialToDate = (d) => {                       // Excel serial -> 'YYYY-MM-DD'
  const ms = Math.round((Number(d) - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const fracToTime = (f) => {                          // day fraction -> 'HH:MM:SS'
  const v = Number(f);
  if (!(v > 0 && v < 1)) return null;
  let s = Math.round(v * 86400);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const students = await q("SELECT id, form_no FROM students");
  const formToId = new Map(students.map((s) => [String(s.form_no).trim(), s.id]));
  const teachers = await q("SELECT id, name FROM teachers WHERE is_deleted = FALSE");
  const teacherByName = new Map(teachers.map((t) => [t.name.trim().toLowerCase(), t.id]));

  // ---- parse Master Sheet ----
  const wb = XLSX.readFile('C:/Users/dell/Downloads/Final.xlsx');
  const ms = XLSX.utils.sheet_to_json(wb.Sheets['Master Sheet'], { header: 1, defval: '' });
  // cols: 0 DATE, 1 Month, 2 Form No, 3 Student, 4 TimeIn, 5 TimeOut, 6 NoOfHrs, 7 Teacher
  const rows = [];
  const coveredForms = new Set();
  for (let i = 1; i < ms.length; i++) {
    const r = ms[i];
    const form = String(r[2]).trim();
    const sid = formToId.get(form);
    const hrs = parseFloat(r[6]);
    const dser = parseFloat(r[0]);
    if (!sid || isNaN(hrs) || hrs <= 0 || isNaN(dser) || dser < 1000) continue;
    const date = serialToDate(dser);
    rows.push({
      student_id: sid, date, month: date.slice(0, 7),
      teacher_id: teacherByName.get(String(r[7]).trim().toLowerCase()) || null,
      time_in: fracToTime(r[4]), time_out: fracToTime(r[5]), hours: Math.round(hrs * 100) / 100,
    });
    coveredForms.add(form);
  }
  console.log(`Master Sheet parsed: ${rows.length} attendance rows, ${coveredForms.size} students covered`);

  // ---- BACKUP existing attendance ----
  const backup = {
    lecture_sessions: await q("SELECT * FROM lecture_sessions"),
    lecture_attendees: await q("SELECT * FROM lecture_attendees"),
  };
  fs.writeFileSync(path.join(__dirname, 'reimport-attendance-backup.json'), JSON.stringify(backup));

  // Students NOT covered by Master Sheet -> keep their old attendance rows.
  const uncoveredStudentIds = new Set(students.filter((s) => !coveredForms.has(String(s.form_no).trim())).map((s) => s.id));
  const keepAttendees = backup.lecture_attendees.filter((a) => uncoveredStudentIds.has(a.student_id));
  const keepSessionIds = new Set(keepAttendees.map((a) => a.lecture_id));
  const keepSessions = backup.lecture_sessions.filter((s) => keepSessionIds.has(s.id));
  console.log(`Uncovered students kept: ${uncoveredStudentIds.size} (with ${keepAttendees.length} attendee rows)`);

  await conn.beginTransaction();
  try {
    await q("SET FOREIGN_KEY_CHECKS=0");
    await q("DELETE FROM lecture_attendees");
    await q("DELETE FROM lecture_sessions");

    const CHUNK = 400;
    // helper: insert a batch of {session, attendee-hours} using contiguous auto-inc ids
    async function insertBatch(batch) {
      const sVals = [], sParams = [];
      for (const r of batch) {
        sVals.push("(?,?,?,?,?,?,?)");
        sParams.push(r.date, r.month, r.teacher_id, r.time_in, r.time_out, r.hours, r.hours);
      }
      const res = await q(
        `INSERT INTO lecture_sessions (session_date, month, teacher_id, time_in, time_out, total_hours, hours_rounded) VALUES ${sVals.join(',')}`,
        sParams);
      const firstId = res.insertId;               // contiguous within one INSERT
      const aVals = [], aParams = [];
      batch.forEach((r, i) => { aVals.push("(?,?,?)"); aParams.push(firstId + i, r.student_id, r.hours); });
      await q(`INSERT INTO lecture_attendees (lecture_id, student_id, hours_consumed) VALUES ${aVals.join(',')}`, aParams);
    }

    // 1) import Master Sheet rows
    for (let i = 0; i < rows.length; i += CHUNK) await insertBatch(rows.slice(i, i + CHUNK));

    // 2) re-insert kept sessions for uncovered students (preserve their hours)
    //    map old session id -> new id, then re-add only the kept attendee rows
    const oldToNew = new Map();
    for (let i = 0; i < keepSessions.length; i += CHUNK) {
      const batch = keepSessions.slice(i, i + CHUNK);
      const vals = [], params = [];
      for (const s of batch) {
        vals.push("(?,?,?,?,?,?,?,?,?,?,?)");
        params.push(s.session_date, s.month, s.teacher_id, s.subject_id, s.time_in, s.time_out, s.total_hours, s.hours_rounded, s.topic, s.subtopic, s.venue);
      }
      const res = await q(
        `INSERT INTO lecture_sessions (session_date, month, teacher_id, subject_id, time_in, time_out, total_hours, hours_rounded, topic, subtopic, venue) VALUES ${vals.join(',')}`,
        params);
      batch.forEach((s, k) => oldToNew.set(s.id, res.insertId + k));
    }
    for (let i = 0; i < keepAttendees.length; i += CHUNK) {
      const batch = keepAttendees.slice(i, i + CHUNK);
      const vals = [], params = [];
      for (const a of batch) { vals.push("(?,?,?)"); params.push(oldToNew.get(a.lecture_id), a.student_id, a.hours_consumed); }
      await q(`INSERT INTO lecture_attendees (lecture_id, student_id, hours_consumed) VALUES ${vals.join(',')}`, params);
    }

    await q("SET FOREIGN_KEY_CHECKS=1");
    await conn.commit();
    const tot = await q("SELECT COUNT(*) n, ROUND(SUM(hours_consumed),2) hrs FROM lecture_attendees");
    console.log('APPLIED. attendees now:', JSON.stringify(tot));
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
