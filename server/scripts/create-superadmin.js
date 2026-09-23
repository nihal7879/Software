// Creates (or updates) the super admin login.
//
// Run after the 2026-09-23_superadmin_role.sql migration:
//     node scripts/create-superadmin.js <username> <password>
//     node scripts/create-superadmin.js superadmin "stem@9696"
//
// Logins are held in users.email — that column carries the username. The
// password is hashed the same way as every other account, so nothing about
// signing in is special about this one.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const username = (process.argv[2] || '').trim();
const password = process.argv[3] || '';
if (!username || !password) {
  console.error('Usage: node scripts/create-superadmin.js <username> <password>');
  process.exit(1);
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const [existing] = await q('SELECT id, role FROM users WHERE email = ?', [username]);
  const hash = await bcrypt.hash(password, 10);

  if (existing) {
    await q("UPDATE users SET role = 'superadmin', password_hash = ?, is_active = TRUE, is_deleted = FALSE WHERE id = ?", [hash, existing.id]);
    console.log(`Updated "${username}" (id ${existing.id}) — was ${existing.role}, now superadmin.`);
  } else {
    const r = await q(
      "INSERT INTO users (role, email, password_hash, display_name, is_active, is_deleted) VALUES ('superadmin', ?, ?, 'Super Admin', TRUE, FALSE)",
      [username, hash]
    );
    console.log(`Created super admin "${username}" (id ${r.insertId}).`);
  }

  const check = await q("SELECT id, email, role, display_name, is_active FROM users WHERE role = 'superadmin'");
  console.table(check);
  const admins = await q("SELECT id, email, display_name FROM users WHERE role = 'admin' AND is_deleted = FALSE");
  console.log('Admins, unchanged:');
  console.table(admins);
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
