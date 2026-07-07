// ---------------------------------------------------------------------------
// Username migration for classroom_app.
//   - students : login becomes their first name (unique, +N on collision)
//   - faculty  : login becomes their first name (unique, +N on collision)
//   - parents  : keep existing real-email logins; create logins for parents
//                that have none -> parent's name, or "<student>parent" fallback
//                when neither father nor mother name exists.
//   - passwords: reset to 123456 for student / parent / faculty.
// DRY RUN by default. Pass --apply to write. Always backs up first.
// Usage: node scripts/username-migration.js [--apply]
// ---------------------------------------------------------------------------
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const APPLY = process.argv.includes('--apply');
const NEW_PASSWORD = '123456';

function slug(name) {
  if (!name) return null;
  let s = String(name).trim().toLowerCase();
  s = s.replace(/^(dr|mr|mrs|ms|miss)[.\s]+/i, '');       // strip titles
  const first = s.split(/[\s]+/)[0] || '';
  const clean = first.replace(/[^a-z0-9]/g, '');
  return clean || null;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, multipleStatements: true,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const students = await q(
    "SELECT id, user_id, first_name, full_name, form_no FROM students ORDER BY id");
  const teachers = await q(
    "SELECT id, user_id, name FROM teachers WHERE is_deleted=FALSE ORDER BY id");
  const parents = await q(
    "SELECT p.id, p.student_id, p.user_id, p.name FROM parents p ORDER BY p.id");
  const users = await q("SELECT id, role, email FROM users");
  const userById = new Map(users.map(u => [u.id, u]));

  // --- taken usernames: everything that will NOT be regenerated -------------
  // = admin logins + existing parent logins (real emails we keep).
  const taken = new Set();
  const keptParentUserIds = new Set(
    parents.filter(p => p.user_id != null).map(p => p.user_id));
  for (const u of users) {
    if (u.role === 'admin') taken.add(u.email.toLowerCase());
    if (u.role === 'parent' && keptParentUserIds.has(u.id)) taken.add(u.email.toLowerCase());
  }
  const unique = (base) => {
    let cand = base, n = 0;
    while (taken.has(cand)) { n += 1; cand = base + n; }
    taken.add(cand);
    return cand;
  };

  const plan = { students: [], faculty: [], parentsNew: [], passwordResets: 0 };
  const studentUsername = new Map();

  // --- students -------------------------------------------------------------
  for (const s of students) {
    const base = slug(s.first_name) || slug(s.full_name) || ('student' + s.form_no);
    const uname = unique(base);
    studentUsername.set(s.id, uname);
    const cur = s.user_id != null ? userById.get(s.user_id) : null;
    plan.students.push({ studentId: s.id, userId: s.user_id, name: s.full_name,
      old: cur ? cur.email : '(no user)', neu: uname });
  }

  // --- faculty --------------------------------------------------------------
  for (const t of teachers) {
    const base = slug(t.name) || ('faculty' + t.id);
    const uname = unique(base);
    const cur = t.user_id != null ? userById.get(t.user_id) : null;
    plan.faculty.push({ teacherId: t.id, userId: t.user_id, name: t.name,
      old: cur ? cur.email : '(no user)', neu: uname });
  }

  // --- parents without a login ---------------------------------------------
  for (const p of parents) {
    if (p.user_id != null) continue;                 // keep existing real-email login
    let base, kind;
    const nameSlug = slug(p.name);
    if (nameSlug) { base = nameSlug; kind = 'name'; }
    else { base = (studentUsername.get(p.student_id) || ('student' + p.student_id)) + 'parent'; kind = 'fallback'; }
    const uname = unique(base);
    plan.parentsNew.push({ parentId: p.id, studentId: p.student_id,
      name: p.name || '(no name)', kind, neu: uname });
  }

  // password reset target count (student/parent/faculty users)
  plan.passwordResets = users.filter(u => ['student','parent','faculty'].includes(u.role)).length
    + plan.parentsNew.length;

  // --- write preview --------------------------------------------------------
  const outDir = path.resolve(__dirname);
  const preview = {
    summary: {
      students: plan.students.length,
      faculty: plan.faculty.length,
      existingParentLoginsKept: keptParentUserIds.size,
      newParentLogins: plan.parentsNew.length,
      newParentByName: plan.parentsNew.filter(p => p.kind === 'name').length,
      newParentFallback: plan.parentsNew.filter(p => p.kind === 'fallback').length,
      passwordResetsApprox: plan.passwordResets,
      newPassword: NEW_PASSWORD,
    },
    students: plan.students,
    faculty: plan.faculty,
    parentsNew: plan.parentsNew,
  };
  fs.writeFileSync(path.join(outDir, 'username-preview.json'), JSON.stringify(preview, null, 2));
  console.log('PREVIEW SUMMARY:', JSON.stringify(preview.summary, null, 2));
  console.log('Sample student renames:', JSON.stringify(plan.students.slice(0, 8)));
  console.log('Faculty renames:', JSON.stringify(plan.faculty));
  console.log('Sample new parent logins:', JSON.stringify(plan.parentsNew.slice(0, 8)));
  console.log('Full preview written to scripts/username-preview.json');

  if (!APPLY) {
    console.log('\n*** DRY RUN — no changes written. Re-run with --apply to commit. ***');
    await conn.end();
    return;
  }

  // --- BACKUP ---------------------------------------------------------------
  const backup = {
    at: process.argv[3] || 'apply',
    users: await q("SELECT id, role, email, password_hash FROM users"),
    parents: await q("SELECT id, user_id FROM parents"),
    teachers: await q("SELECT id, email FROM teachers"),
  };
  const backupFile = path.join(outDir, 'username-migration-backup.json');
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log('Backup written to', backupFile);

  const hash = bcrypt.hashSync(NEW_PASSWORD, 10);
  await conn.beginTransaction();
  try {
    // 1. student logins
    for (const s of plan.students) {
      if (s.userId == null) continue;
      await q("UPDATE users SET email=? WHERE id=?", [s.neu, s.userId]);
    }
    // 2. faculty logins (+ mirror teachers.email)
    for (const f of plan.faculty) {
      if (f.userId != null) await q("UPDATE users SET email=? WHERE id=?", [f.neu, f.userId]);
      await q("UPDATE teachers SET email=? WHERE id=?", [f.neu, f.teacherId]);
    }
    // 3. new parent logins
    for (const p of plan.parentsNew) {
      const r = await q(
        "INSERT INTO users (role, email, password_hash, display_name, is_active) VALUES ('parent', ?, ?, ?, TRUE)",
        [p.neu, hash, p.name === '(no name)' ? null : p.name]);
      await q("UPDATE parents SET user_id=? WHERE id=?", [r.insertId, p.parentId]);
    }
    // 4. reset passwords for all student/parent/faculty users (incl. the new ones)
    await q("UPDATE users SET password_hash=? WHERE role IN ('student','parent','faculty')", [hash]);
    await conn.commit();
    console.log('\n*** APPLIED successfully. ***');
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK due to error:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
