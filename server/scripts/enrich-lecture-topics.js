// Enrich existing lecture_sessions with Topic (and Venue where missing) by matching
// (form_no, session_date) against the topic/remark data spread across BOTH workbooks:
//   Final.xlsx  -> "For Teacher Master Sheet Mar & "  (Topic/Remark)
//   Ankita-Attendance.xlsx -> "Combined tracker", "A18", "Nov Tracker", "Previous Data"
// The trackers only carry a single combined "Topic/Remark" column, so it maps to `topic`.
// Non-destructive: only fills sessions whose topic is currently empty. Backs up first.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const pad = (n) => String(n).padStart(2, '0');
const serialToDate = (d) => { const ms = Math.round((Number(d) - 25569) * 86400 * 1000); const dt = new Date(ms); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const A = 'C:/Users/dell/Downloads/Ankita-Attendance.xlsx';
const F = 'C:/Users/dell/Downloads/Final.xlsx';

// ---- build topic map keyed by `form|YYYY-MM-DD` ----
const map = new Map();
function add(form, dateSer, topic, subject, venue) {
  form = clean(form); const d = parseFloat(dateSer); topic = clean(topic);
  if (!form || isNaN(d) || d < 1000 || !topic) return;
  const key = `${form}|${serialToDate(d)}`;
  const e = map.get(key) || { topics: new Set(), subject: clean(subject), venue: clean(venue) };
  e.topics.add(topic);
  if (!e.subject && subject) e.subject = clean(subject);
  if (!e.venue && venue) e.venue = clean(venue);
  map.set(key, e);
}
const readWB = (p) => XLSX.readFile(p);
const rows = (wb, name) => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : [];

const wf = readWB(F), wa = readWB(A);
{ const n = wf.SheetNames.find((x) => x.startsWith('For Teacher Master Sheet')); const r = rows(wf, n); for (let i = 1; i < r.length; i++) add(r[i][2], r[i][0], r[i][8]); }
{ const r = rows(wa, 'Combined tracker'); for (let i = 1; i < r.length; i++) add(r[i][2], r[i][0], r[i][14], r[i][13], r[i][15]); }
for (const n of ['A18', 'Nov Tracker', 'Previous Data']) { const r = rows(wa, n); for (let i = 1; i < r.length; i++) add(r[i][2], r[i][0], r[i][14], r[i][13], r[i][15]); }
console.log(`Topic map built: ${map.size} (form|date) keys`);

(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  // one row per session (dedupe attendees) — pick the form of any attendee
  const sess = await q(`
    SELECT l.id, l.session_date, l.topic, l.venue, s.form_no
    FROM lecture_sessions l
    JOIN lecture_attendees a ON a.lecture_id = l.id
    JOIN students s ON s.id = a.student_id`);

  const perSession = new Map(); // id -> {date, form, topic, venue}
  for (const r of sess) if (!perSession.has(r.id)) perSession.set(r.id, r);

  const updates = [];
  for (const r of perSession.values()) {
    if (clean(r.topic)) continue;                 // already has a topic — leave it
    const key = `${clean(r.form_no)}|${dateStr(r.session_date)}`;
    const e = map.get(key);
    if (!e) continue;
    const topic = [...e.topics].join('; ').slice(0, 250);
    const venue = clean(r.venue) ? null : (e.venue || null);
    updates.push({ id: r.id, topic, venue });
  }
  console.log(`Sessions to enrich: ${updates.length} (of ${perSession.size} total)`);

  // ---- backup ----
  const backup = await q('SELECT id, topic, venue FROM lecture_sessions');
  fs.writeFileSync(path.join(__dirname, 'enrich-lecture-topics-backup.json'), JSON.stringify(backup));
  console.log(`Backup written: enrich-lecture-topics-backup.json (${backup.length} rows)`);

  await conn.beginTransaction();
  try {
    for (const u of updates) {
      if (u.venue) await q('UPDATE lecture_sessions SET topic=?, venue=? WHERE id=?', [u.topic, u.venue, u.id]);
      else await q('UPDATE lecture_sessions SET topic=? WHERE id=?', [u.topic, u.id]);
    }
    await conn.commit();
    const chk = await q("SELECT COUNT(*) n FROM lecture_sessions WHERE topic IS NOT NULL AND topic<>''");
    console.log('APPLIED. sessions with topic now:', chk[0].n);
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
