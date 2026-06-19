// Runs a .sql file against MySQL using the .env credentials.
// Usage: node scripts/run-sql.js ../database/schema.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/run-sql.js <path-to.sql>');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  console.log(`Running ${file} ...`);
  await conn.query(sql);
  await conn.end();
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
