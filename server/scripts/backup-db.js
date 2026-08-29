// Full logical backup of the database to a single restorable .sql file.
//   node scripts/backup-db.js [outputPath]
// Default output: D:/db-backups/classroom_app-<stamp>.sql   (stamp passed in or 'manual')
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const OUT = process.argv[2] || `D:/db-backups/${process.env.DB_NAME}-backup.sql`;

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '')}'`;
};

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const objs = await q(
    'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [process.env.DB_NAME]);
  const tables = objs.filter((o) => o.TABLE_TYPE === 'BASE TABLE').map((o) => o.TABLE_NAME);
  const views = objs.filter((o) => o.TABLE_TYPE === 'VIEW').map((o) => o.TABLE_NAME);

  const fd = fs.openSync(OUT, 'w');
  const w = (s) => fs.writeSync(fd, s);
  w(`-- backup of ${process.env.DB_NAME}\n-- tables: ${tables.length}, views: ${views.length}\n`);
  w('SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n');

  let total = 0;
  for (const t of tables) {
    const ddl = await q(`SHOW CREATE TABLE \`${t}\``);
    w(`\n-- ---------- ${t} ----------\nDROP TABLE IF EXISTS \`${t}\`;\n${ddl[0]['Create Table']};\n`);
    const rows = await q(`SELECT * FROM \`${t}\``);
    total += rows.length;
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const collist = cols.map((c) => `\`${c}\``).join(',');
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
          .map((r) => `(${cols.map((c) => esc(r[c])).join(',')})`).join(',\n');
        w(`INSERT INTO \`${t}\` (${collist}) VALUES\n${chunk};\n`);
      }
    }
    console.log(`  ${t.padEnd(28)} ${String(rows.length).padStart(6)} rows`);
  }
  for (const v of views) {
    const ddl = await q(`SHOW CREATE VIEW \`${v}\``);
    w(`\n-- ---------- view ${v} ----------\nDROP VIEW IF EXISTS \`${v}\`;\n${ddl[0]['Create View']};\n`);
    console.log(`  ${v.padEnd(28)}   (view)`);
  }
  w('\nSET FOREIGN_KEY_CHECKS=1;\n');
  fs.closeSync(fd);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`\nBACKUP WRITTEN: ${OUT}  (${kb} KB, ${total} rows across ${tables.length} tables)`);
  await conn.end();
})().catch((e) => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
