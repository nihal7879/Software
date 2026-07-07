// Repair the one broken fee_package (Reina, student 186): her payment recorded
// 30 hours / AED 4200 but the linked package sat at 0. Set it to match.
// Verified: all other 166 students already have package_hours == transaction_hours.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};

  const before = await q("SELECT * FROM fee_packages WHERE id=181");
  const tx = await q("SELECT id, amount, course_package_hours FROM fee_transactions WHERE student_id=186 AND course_package_hours>0");
  fs.writeFileSync(path.join(__dirname,'fix-reina-backup.json'), JSON.stringify({before, tx}, null, 2));
  if (!before.length) { console.error('package 181 not found'); process.exit(1); }

  const hrs = Number(tx[0].course_package_hours);          // 30
  const rate = Number(tx[0].amount) / hrs;                 // 4200/30 = 140
  await q("UPDATE fee_packages SET package_hours=?, rate_per_hour=?, transaction_id=?, is_active=TRUE, is_deleted=FALSE WHERE id=181",
    [hrs, rate, tx[0].id]);

  const after = await q(`SELECT p.package_hours, p.rate_per_hour, p.transaction_id,
      (p.package_hours * p.rate_per_hour) AS fees_shown FROM fee_packages p WHERE p.id=181`);
  console.log('AFTER:', JSON.stringify(after[0]));
  await c.end();
})().catch(e=>{console.error(e);process.exit(1);});
