// Rebuild the CREDIT side of every student's ledger so the Hours Statement shows
// each payment as its own credit line (package hours + correct fees/rate), and
// adjusted hours as their own dated event. Totals are preserved.
//
// Sources (uses BOTH where one is fuller):
//   - fee_transactions (DB)  -> one fee_package per payment (rate = amount/hours)
//   - Final.xlsx "Sheet154"  -> authoritative Adjusted / Discount / Pending / Amount
//
// Does NOT touch attendance/consumed (separate step). Backs up first, one txn.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---- load authoritative per-form ledger from Final.xlsx Sheet154 ------------
function loadSheet154() {
  const wb = XLSX.readFile('C:/Users/dell/Downloads/Final.xlsx');
  const pick = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const primary = pick('Sheet154');
  const fallback = pick('Pending fees 27.06');
  const map = new Map();
  const ingest = (rows) => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const form = String(r[0]).trim();
      if (!/^\d+$/.test(form)) continue;
      if (map.has(form)) continue; // primary wins; fallback fills gaps
      map.set(form, {
        amount: round2(r[3]), committed: round2(r[5]), discount: round2(r[6]),
        adjusted: round2(r[7]), consumed: round2(r[9]), rate: round2(r[11]),
        pending: round2(r[12]), extra: round2(r[14]),
      });
    }
  };
  ingest(primary);
  ingest(fallback); // only fills forms missing from primary ("use both")
  return map;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  const q = async (s, p) => { const [r] = await conn.query(s, p); return r; };

  const sheet = loadSheet154();
  const students = await q("SELECT id, form_no FROM students");

  // ---- BACKUP -------------------------------------------------------------
  const backup = {
    fee_packages: await q("SELECT * FROM fee_packages"),
    hours_adjustments: await q("SELECT * FROM hours_adjustments"),
    ledger_adjustments: await q("SELECT * FROM ledger_adjustments"),
  };
  fs.writeFileSync(path.join(__dirname, 'rebuild-fee-credits-backup.json'), JSON.stringify(backup, null, 2));

  let pkgCount = 0, adjCount = 0, touched = 0;
  await conn.beginTransaction();
  try {
    for (const st of students) {
      const form = String(st.form_no).trim();
      const led = sheet.get(form) || {};
      const txs = await q(
        `SELECT id, amount, course_package_hours, discount_hours, payment_date
           FROM fee_transactions
          WHERE student_id = ? AND (course_package_hours > 0 OR discount_hours > 0)
          ORDER BY payment_date, id`, [st.id]);

      // Skip students with neither transactions nor a ledger row (nothing to rebuild).
      if (txs.length === 0 && !sheet.has(form)) continue;
      touched++;

      // 1) wipe this student's packages + previously-imported adjustments
      await q("UPDATE fee_packages SET is_active = FALSE, is_deleted = TRUE WHERE student_id = ?", [st.id]);
      await q("DELETE FROM hours_adjustments WHERE student_id = ? AND reason = 'Imported adjusted hours'", [st.id]);

      // 2) one package per payment (correct per-payment rate => correct fees)
      let txDiscount = 0;
      for (const t of txs) {
        const hrs = round2(t.course_package_hours);
        const disc = round2(t.discount_hours);
        txDiscount += disc;
        const rate = hrs > 0 ? round2(Number(t.amount) / hrs) : 0;
        await q(
          `INSERT INTO fee_packages (student_id, transaction_id, package_hours, discount_hours, rate_per_hour, start_date, is_active, is_deleted)
           VALUES (?,?,?,?,?,?,TRUE,FALSE)`,
          [st.id, t.id, hrs, disc, rate, t.payment_date]);
        pkgCount++;
      }

      // 3) authoritative discount remainder (Sheet154) not already on transactions
      const discRemainder = round2((led.discount || 0) - txDiscount);
      if (discRemainder > 0) {
        const first = await q("SELECT id FROM fee_packages WHERE student_id = ? AND is_active = TRUE ORDER BY start_date, id LIMIT 1", [st.id]);
        if (first.length) await q("UPDATE fee_packages SET discount_hours = discount_hours + ? WHERE id = ?", [discRemainder, first[0].id]);
        else { await q("INSERT INTO fee_packages (student_id, package_hours, discount_hours, rate_per_hour, is_active, is_deleted) VALUES (?,?,?,?,TRUE,FALSE)", [st.id, 0, discRemainder, led.rate || 0]); pkgCount++; }
      }

      // 4) adjusted hours as their own dated event (shows as "Hours adjusted" row)
      if (led.adjusted && led.adjusted !== 0) {
        await q("INSERT INTO hours_adjustments (student_id, delta, reason) VALUES (?,?, 'Imported adjusted hours')", [st.id, led.adjusted]);
        adjCount++;
      }

      // 5) money side (authoritative): amount credited / pending / extra
      if (sheet.has(form)) {
        await q(
          `INSERT INTO ledger_adjustments (student_id, amount_credited, pending_fees, extra_amount_left)
           VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE amount_credited = VALUES(amount_credited),
             pending_fees = VALUES(pending_fees), extra_amount_left = VALUES(extra_amount_left)`,
          [st.id, led.amount || 0, led.pending || 0, led.extra || 0]);
      }
    }
    await conn.commit();
    console.log(`APPLIED. students touched=${touched}, packages created=${pkgCount}, adjusted events=${adjCount}`);
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
