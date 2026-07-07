// Split shared sibling parent logins so every parent row has its own account.
// Keeps the existing login on the first child; creates a new username-based
// login (password 123456) for each additional child. DRY RUN unless --apply.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const APPLY = process.argv.includes('--apply');
const NEW_PASSWORD = '123456';

function slug(name) {
  if (!name) return null;
  let s = String(name).trim().toLowerCase().replace(/^(dr|mr|mrs|ms|miss)[.\s]+/i, '');
  const clean = (s.split(/\s+/)[0] || '').replace(/[^a-z0-9]/g, '');
  return clean || null;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, multipleStatements: true });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const taken = new Set((await q("SELECT email FROM users")).map(u => u.email.toLowerCase()));
  const unique = (base) => { let c = base, n = 0; while (taken.has(c)) { n++; c = base + n; } taken.add(c); return c; };

  const shared = await q(`
    SELECT p.id pid, p.student_id, p.name, p.user_id, s.form_no, s.full_name, u.email login
    FROM parents p JOIN students s ON s.id=p.student_id JOIN users u ON u.id=p.user_id
    WHERE p.user_id IN (SELECT user_id FROM parents WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*)>1)
    ORDER BY p.user_id, p.id`);

  const groups = {};
  for (const r of shared) (groups[r.user_id] ||= []).push(r);

  const plan = [];
  for (const uid in groups) {
    const rows = groups[uid];
    rows.slice(1).forEach(r => {   // keep rows[0] on existing login, split the rest
      const base = slug(r.name) || slug(r.full_name) || ('student' + r.student_id) + 'parent';
      plan.push({ pid: r.pid, keepLogin: rows[0].login, parent: r.name,
        student: `${r.full_name} (Form ${r.form_no})`, neu: unique(base) });
    });
  }

  console.log('Splits to make:');
  plan.forEach(p => console.log(`  ${p.student}  parent "${p.parent}"  -> new login: ${p.neu}   (sibling stays on ${p.keepLogin})`));

  if (!APPLY) { console.log('\n*** DRY RUN — re-run with --apply to commit. ***'); await conn.end(); return; }

  fs.writeFileSync(path.join(__dirname, 'split-sibling-backup.json'),
    JSON.stringify(await q("SELECT id, user_id FROM parents WHERE user_id IN (" + Object.keys(groups).join(',') + ")"), null, 2));

  const hash = bcrypt.hashSync(NEW_PASSWORD, 10);
  await conn.beginTransaction();
  try {
    for (const p of plan) {
      const r = await q("INSERT INTO users (role, email, password_hash, display_name, is_active) VALUES ('parent', ?, ?, ?, TRUE)",
        [p.neu, hash, p.parent]);
      await q("UPDATE parents SET user_id=? WHERE id=?", [r.insertId, p.pid]);
    }
    await conn.commit();
    console.log('\n*** APPLIED. ' + plan.length + ' new parent logins created. ***');
  } catch (e) { await conn.rollback(); console.error('ROLLED BACK:', e.message); process.exitCode = 1; }
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
