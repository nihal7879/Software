// Generate a bcrypt hash and (optionally) update all seed users to use it.
// Usage: node scripts/hash.js password123
const bcrypt = require('bcryptjs');
const pw = process.argv[2] || 'password123';
const hash = bcrypt.hashSync(pw, 10);
console.log('\nPassword :', pw);
console.log('Bcrypt   :', hash);
console.log('\nSQL to apply to every seeded user:');
console.log(`  USE tuition_erp; UPDATE users SET password_hash = '${hash}';\n`);
