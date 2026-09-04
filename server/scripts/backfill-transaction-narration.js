// Backfill fee_transactions.transaction_narration from the source workbooks.
//
//   node scripts/backfill-transaction-narration.js [--apply]
//
// The narration is the bank's own statement line for a payment (payer name,
// IBAN, remittance route, purpose). It was never imported — only the short
// reference code was — so it exists nowhere in the database.
//
// Two sources, in priority order:
//   1. "Total Fees From June"  — the finance sheet the payments were imported
//      from. One row per payment, but its Transaction column is blank on 38 of
//      the 367 rows.
//   2. "Bank Statement"        — the raw statement, 993 rows covering every
//      credit AND debit. Wider than our payments, so it fills those gaps.
//
// Matching is by bank reference code, which both sheets and the database carry
// and which is unique per payment. Rows whose reference is missing on our side
// fall back to form number + date + amount. Anything that matches neither is
// reported, never guessed at.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require(path.join(__dirname, '..', '..', 'client', 'node_modules', 'xlsx'));

const APPLY = process.argv.includes('--apply');
const FIN = 'C:/Users/dell/Downloads/Final Finance Sheet.xlsx';
const ATT = 'C:/Users/dell/Downloads/Ankita Attendance tracker.xlsx';

const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
const clean = (v) => {
  if (v == null) return null;
  // Statement lines wrap mid-field in the sheet; the newlines are layout, not
  // content, so they collapse to single spaces.
  const s = String(v).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s === '' ? null : s;
};
// Excel serial -> yyyy-mm-dd, read in UTC so the local timezone cannot shift it.
const serToDate = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  const d = new Date(Math.round((Number(v) - 25569) * 86400 * 1000));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

const rowsOf = (file, sheet) => {
  const wb = XLSX.readFile(file);
  if (!wb.SheetNames.includes(sheet)) throw new Error('missing sheet ' + sheet + ' in ' + file);
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null });
};

(async () => {
  // ---- source 1: the finance sheet the payments came from -----------------
  const fin = rowsOf(FIN, 'Total Fees From June');
  const finHdr = fin[0].map((h) => String(h || '').trim());
  const cDate = 0, cNarr = 1, cRef = 2, cAmt = 3, cForm = 6;
  if (finHdr[cNarr] !== 'Transaction' || finHdr[cRef] !== 'Reference Number') {
    throw new Error('unexpected finance columns: ' + finHdr.slice(0, 7).join(' | '));
  }
  const byRef = new Map();          // reference -> narration
  const byTriple = new Map();       // form|date|amount -> narration
  let finFilled = 0;
  for (const r of fin.slice(1)) {
    if (!r) continue;
    const narr = clean(r[cNarr]);
    if (!narr) continue;
    finFilled++;
    const ref = norm(r[cRef]);
    if (ref && !byRef.has(ref)) byRef.set(ref, narr);
    const key = norm(r[cForm]) + '|' + serToDate(r[cDate]) + '|' + (Number(r[cAmt]) || 0);
    if (!byTriple.has(key)) byTriple.set(key, narr);
  }

  // ---- source 2: the raw bank statement, for the gaps ---------------------
  const bank = rowsOf(ATT, 'Bank Statement');
  const bHdr = bank[0].map((h) => String(h || '').trim());
  const bNarr = bHdr.indexOf('Transaction'), bRef = bHdr.indexOf('Reference Number');
  const bDate = bHdr.indexOf('Date'), bCredit = bHdr.indexOf('Credit');
  if (bNarr < 0 || bRef < 0) throw new Error('unexpected bank columns: ' + bHdr.join(' | '));
  const bankByRef = new Map(), bankByDateAmt = new Map();
  for (const r of bank.slice(1)) {
    if (!r) continue;
    const narr = clean(r[bNarr]);
    if (!narr) continue;
    const ref = norm(r[bRef]);
    if (ref && !bankByRef.has(ref)) bankByRef.set(ref, narr);
    const credit = Number(r[bCredit]) || 0;
    if (credit > 0) {
      const k = serToDate(r[bDate]) + '|' + credit;
      if (!bankByDateAmt.has(k)) bankByDateAmt.set(k, narr);
    }
  }
  console.log('sources: finance sheet ' + finFilled + ' narrations (' + byRef.size + ' by ref), ' +
              'bank statement ' + bankByRef.size + ' by ref / ' + bankByDateAmt.size + ' by date+amount');

  // ---- match against the live payments ------------------------------------
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const [txns] = await c.query(
    'SELECT t.id, t.transaction_reference, t.payment_date, t.amount, s.form_no, s.full_name ' +
    '  FROM fee_transactions t JOIN students s ON s.id = t.student_id ' +
    ' WHERE t.is_deleted = FALSE ORDER BY t.payment_date, t.id'
  );

  const updates = [];
  const misses = [];
  const via = { finRef: 0, finTriple: 0, bankRef: 0, bankDateAmt: 0 };
  for (const t of txns) {
    const ref = norm(t.transaction_reference);
    const triple = norm(t.form_no) + '|' + t.payment_date.slice(0, 10) + '|' + Number(t.amount);
    const dateAmt = t.payment_date.slice(0, 10) + '|' + Number(t.amount);
    let narr = null, how = null;
    if (ref && byRef.has(ref)) { narr = byRef.get(ref); how = 'finRef'; }
    else if (byTriple.has(triple)) { narr = byTriple.get(triple); how = 'finTriple'; }
    else if (ref && bankByRef.has(ref)) { narr = bankByRef.get(ref); how = 'bankRef'; }
    else if (bankByDateAmt.has(dateAmt)) { narr = bankByDateAmt.get(dateAmt); how = 'bankDateAmt'; }
    if (narr) { via[how]++; updates.push([t.id, narr]); }
    else misses.push(t);
  }

  console.log('\npayments: ' + txns.length + '   matched: ' + updates.length + '   unmatched: ' + misses.length);
  console.log('  via finance sheet reference : ' + via.finRef);
  console.log('  via finance form+date+amount: ' + via.finTriple);
  console.log('  via bank statement reference: ' + via.bankRef);
  console.log('  via bank date+amount        : ' + via.bankDateAmt);
  if (misses.length) {
    console.log('\nno narration found for:');
    console.table(misses.slice(0, 45).map((m) => ({
      id: m.id, form: m.form_no, student: m.full_name,
      date: m.payment_date.slice(0, 10), amount: m.amount, ref: m.transaction_reference,
    })));
  }
  console.log('\nsample of what will be written:');
  console.table(updates.slice(0, 5).map((u) => ({ id: u[0], narration: u[1].slice(0, 90) })));

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply'); await c.end(); return; }

  const [before] = await c.query('SELECT id, transaction_narration FROM fee_transactions WHERE is_deleted = FALSE');
  fs.writeFileSync(path.join(__dirname, 'transaction-narration-backup.json'), JSON.stringify(before, null, 2));
  await c.beginTransaction();
  for (const u of updates) {
    await c.query('UPDATE fee_transactions SET transaction_narration = ? WHERE id = ?', [u[1], u[0]]);
  }
  await c.query(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?,?,?,?,?,?)',
    [1, 'BACKFILL', 'fee_transaction', '0', null, JSON.stringify({ column: 'transaction_narration', rows: updates.length, sources: via })]
  );
  await c.commit();
  const [after] = await c.query(
    'SELECT COUNT(*) n, SUM(transaction_narration IS NOT NULL) filled, MAX(CHAR_LENGTH(transaction_narration)) longest ' +
    '  FROM fee_transactions WHERE is_deleted = FALSE'
  );
  console.log('\nAPPLIED:', after[0]);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
