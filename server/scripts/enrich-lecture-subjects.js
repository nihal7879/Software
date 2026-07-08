// Enrich lecture_sessions.subject_id from the Excel sheets that carry a Subject
// column, matched by (form_no, session_date). Resolves subject name -> subjects.id,
// creating any subject that doesn't exist yet. Non-destructive: only fills sessions
// whose subject_id is currently NULL. Pass --apply to write; default is a dry run.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const APPLY = process.argv.includes('--apply');
const pad = (n) => String(n).padStart(2, '0');
const serialToDate = (d) => { const ms = Math.round((Number(d) - 25569) * 86400 * 1000); const dt = new Date(ms); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Normalise messy subject names to a canonical label.
function canonSubject(raw) {
  let s = clean(raw);
  if (!s) return '';
  const l = s.toLowerCase();
  if (l.startsWith('math')) return 'Maths';
  if (l.startsWith('further')) return 'Further Maths';
  if (l.startsWith('phys')) return 'Physics';
  if (l.startsWith('chem')) return 'Chemistry';
  if (l.startsWith('bio')) return 'Biology';
  if (l.startsWith('sci')) return 'Science';
  if (l.startsWith('comp')) return 'Computer Science';
  if (l.startsWith('econ')) return 'Economics';
  if (l.startsWith('eng')) return 'English';
  // Title-case whatever else it is.
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

const A = 'C:/Users/dell/Downloads/Ankita-Attendance.xlsx';
const F = 'C:/Users/dell/Downloads/Final.xlsx';
const map = new Map(); // form|date -> subject label
function add(form, dateSer, subject) {
  form = clean(form); const d = parseFloat(dateSer); subject = canonSubject(subject);
  if (!form || isNaN(d) || d < 1000 || !subject) return;
  const key = `${form}|${serialToDate(d)}`;
  if (!map.has(key)) map.set(key, subject);
}
const rows = (wb, name) => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : [];
const wa = XLSX.readFile(A), wf = XLSX.readFile(F);
// Ankita: Combined tracker / A18 / Nov Tracker / Previous Data -> subject col 13
{ const r = rows(wa, 'Combined tracker'); for (let i = 1; i < r.length; i++) add(r[i][2], r[i][0], r[i][13]); }
for (const n of ['A18', 'Nov Tracker', 'Previous Data']) { const r = rows(wa, n); for (let i = 1; i < r.length; i++) add(r[i][2], r[i][0], r[i][13]); }
console.log(`Subject map: ${map.size} (form|date) keys`);

(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  // subjects lookup (create-on-miss)
  const subs = await q('SELECT id, name FROM subjects');
  const subByName = new Map(subs.map((s) => [s.name.toLowerCase(), s.id]));
  async function subjectId(name) {
    const k = name.toLowerCase();
    if (subByName.has(k)) return subByName.get(k);
    if (!APPLY) { subByName.set(k, -1); return -1; }
    const res = await q('INSERT INTO subjects (name) VALUES (?)', [name]);
    subByName.set(k, res.insertId);
    return res.insertId;
  }

  const sess = await q(`
    SELECT l.id, l.session_date, l.subject_id, s.form_no
    FROM lecture_sessions l
    JOIN lecture_attendees a ON a.lecture_id = l.id
    JOIN students s ON s.id = a.student_id`);
  const perSession = new Map();
  for (const r of sess) if (!perSession.has(r.id)) perSession.set(r.id, r);

  const counts = {}, skipped = {};
  const updates = [];
  for (const r of perSession.values()) {
    if (r.subject_id != null) continue;
    const name = map.get(`${clean(r.form_no)}|${dateStr(r.session_date)}`);
    if (!name) continue;
    // Only accept subjects that already exist in the subjects table (avoid
    // creating junk like "Mechanics"/"Electricity" which are really topics).
    if (!subByName.has(name.toLowerCase())) { skipped[name] = (skipped[name] || 0) + 1; continue; }
    counts[name] = (counts[name] || 0) + 1;
    updates.push({ id: r.id, name });
  }
  if (Object.keys(skipped).length) console.log('Skipped (not a known subject):', JSON.stringify(skipped));
  console.log(`Sessions to enrich: ${updates.length} of ${perSession.size}`);
  console.log('By subject:', JSON.stringify(counts, null, 1));

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to write.'); await conn.end(); return; }

  const backup = await q('SELECT id, subject_id FROM lecture_sessions');
  fs.writeFileSync(path.join(__dirname, 'enrich-lecture-subjects-backup.json'), JSON.stringify(backup));
  await conn.beginTransaction();
  try {
    for (const u of updates) {
      const sid = await subjectId(u.name);
      await q('UPDATE lecture_sessions SET subject_id=? WHERE id=?', [sid, u.id]);
    }
    await conn.commit();
    const chk = await q('SELECT COUNT(*) n FROM lecture_sessions WHERE subject_id IS NOT NULL');
    console.log('APPLIED. sessions with subject now:', chk[0].n);
  } catch (e) { await conn.rollback(); console.error('ROLLED BACK:', e.message); process.exitCode = 1; }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
