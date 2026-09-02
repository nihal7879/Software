// One-off report: every enrolled student, each payment they made, and the
// hours that payment credited.
//
//   node scripts/export-payments-report.js [outputPath]
//
// Read-only. One row per payment, ordered by form number then date, with a
// student's payments grouped together and a per-student subtotal. Enrolled
// students who have never paid still get a row, so the sheet is a complete
// register rather than only the people who happen to have transactions.
//
// Trials are excluded: they are prospects on free hours, and their rows would
// read as unpaid enrolments.
//
// exceljs lives in the client's dependencies (the browser-side Hours Statement
// export uses it) and is resolved from there rather than added to the server,
// which ships no spreadsheet code of its own.
require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');
const ExcelJS = require(path.join(__dirname, '..', '..', 'client', 'node_modules', 'exceljs'));

const OUT = process.argv[2] || 'C:/Users/dell/Downloads/Student-Payments-Hours.xlsx';

const HEAD_BG = 'FF1F2937';
const BAND_BG = 'FFF8FAFC';
const SUB_BG = 'FFE2E8F0';
const LINE = 'FFD1D5DB';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const border = () => ({
  top: { style: 'thin', color: { argb: LINE } },
  left: { style: 'thin', color: { argb: LINE } },
  bottom: { style: 'thin', color: { argb: LINE } },
  right: { style: 'thin', color: { argb: LINE } },
});

// Dates are built in UTC: exceljs converts a JS Date to an Excel serial through
// its UTC value, so a local-midnight Date in IST renders as the previous day.
const asDate = (d) => {
  if (!d) return null;
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, day)) : null;
};

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  });
  const q = async (s, p) => { const [r] = await c.query(s, p); return r; };

  // hours credited comes from the package the payment created; fall back to the
  // hours recorded on the transaction itself when no package was ever linked.
  const rows = await q(`
    SELECT s.form_no, s.full_name, s.status, s.year_grade, s.school_name,
           t.payment_date, t.amount, t.payment_source, t.transaction_reference,
           COALESCE(p.package_hours, t.course_package_hours) AS hours_credited
      FROM students s
      LEFT JOIN fee_transactions t ON t.student_id = s.id AND t.is_deleted = FALSE
      LEFT JOIN fee_packages p ON p.transaction_id = t.id AND p.is_deleted = FALSE
     WHERE s.student_type <> 'Trial' AND s.is_deleted = FALSE
     ORDER BY CAST(s.form_no AS UNSIGNED), t.payment_date, t.id`);
  await c.end();

  const now = new Date();
  const stamp = `${now.getDate()}-${MONTHS[now.getMonth()]}-${now.getFullYear()} ` +
    `${((now.getHours() % 12) || 12)}:${String(now.getMinutes()).padStart(2, '0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'STEM Vision';
  wb.created = now;
  const ws = wb.addWorksheet('Payments & Hours', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' },
  });

  ws.getCell(1, 1).value = 'Exported On';
  ws.getCell(1, 1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF475569' } };
  ws.getCell(1, 2).value = stamp;
  ws.getCell(1, 2).font = { name: 'Calibri', size: 10 };

  const HEADERS = ['Form No', 'Student Name', 'Status', 'Payment Date', 'Amount Paid (AED)', 'Hours Credited', 'Payment Source', 'Reference'];
  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border();
  });
  ws.getRow(3).height = 20;

  // group by student so a subtotal can follow each one
  const byStudent = new Map();
  for (const r of rows) {
    if (!byStudent.has(r.form_no)) byStudent.set(r.form_no, { info: r, pays: [] });
    if (r.payment_date) byStudent.get(r.form_no).pays.push(r);
  }

  let row = 4, band = 0, grandAmt = 0, grandHrs = 0, payCount = 0, noPay = 0;
  for (const [form, g] of byStudent) {
    const shade = band++ % 2 === 1;
    if (!g.pays.length) {
      noPay++;
      const vals = [form, g.info.full_name, g.info.status, null, null, null, '', ''];
      vals.forEach((v, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = i === 3 || i === 4 || i === 5 ? null : v;
        cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
        cell.border = border();
        if (shade) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } };
      });
      ws.getCell(row, 4).value = 'no payment recorded';
      ws.getCell(row, 4).alignment = { horizontal: 'center' };
      row++;
      continue;
    }
    let sAmt = 0, sHrs = 0;
    for (const p of g.pays) {
      const amt = Number(p.amount) || 0;
      const hrs = p.hours_credited == null ? null : Number(p.hours_credited);
      sAmt += amt; sHrs += hrs || 0; payCount++;
      const vals = [form, g.info.full_name, g.info.status, asDate(p.payment_date), amt, hrs,
                    p.payment_source || '', p.transaction_reference || ''];
      vals.forEach((v, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = v;
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = border();
        if (shade) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } };
        if (i === 0 || i === 2) cell.alignment = { horizontal: 'center' };
        if (i === 3) { cell.numFmt = 'd-mmm-yyyy'; cell.alignment = { horizontal: 'center' }; }
        if (i === 4) cell.numFmt = '#,##0.00';
        if (i === 5) { cell.numFmt = '0.0'; cell.alignment = { horizontal: 'center' }; }
      });
      row++;
    }
    grandAmt += sAmt; grandHrs += sHrs;
    // subtotal only where it says something the single row above does not
    if (g.pays.length > 1) {
      ws.mergeCells(row, 1, row, 4);
      const l = ws.getCell(row, 1);
      l.value = `${g.info.full_name} — ${g.pays.length} payments`;
      l.font = { name: 'Calibri', size: 10, bold: true };
      l.alignment = { horizontal: 'right' };
      ws.getCell(row, 5).value = sAmt; ws.getCell(row, 5).numFmt = '#,##0.00';
      ws.getCell(row, 6).value = sHrs; ws.getCell(row, 6).numFmt = '0.0';
      ws.getCell(row, 6).alignment = { horizontal: 'center' };
      for (let i = 1; i <= HEADERS.length; i++) {
        const cell = ws.getCell(row, i);
        cell.font = { name: 'Calibri', size: 10, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_BG } };
        cell.border = border();
      }
      row++;
    }
  }

  row++;
  ws.mergeCells(row, 1, row, 4);
  const tl = ws.getCell(row, 1);
  tl.value = `TOTAL — ${byStudent.size} enrolled students, ${payCount} payments`;
  tl.font = { name: 'Calibri', size: 11, bold: true };
  tl.alignment = { horizontal: 'right' };
  ws.getCell(row, 5).value = grandAmt; ws.getCell(row, 5).numFmt = '#,##0.00';
  ws.getCell(row, 6).value = grandHrs; ws.getCell(row, 6).numFmt = '0.0';
  ws.getCell(row, 6).alignment = { horizontal: 'center' };
  for (let i = 1; i <= HEADERS.length; i++) {
    const cell = ws.getCell(row, i);
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } };
    cell.border = border();
  }

  [11, 28, 12, 15, 18, 15, 20, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: HEADERS.length } };
  ws.headerFooter.oddFooter = `&C &P of &N &R Exported ${stamp}`;

  await wb.xlsx.writeFile(OUT);
  console.log(`WRITTEN: ${OUT}`);
  console.log(`  enrolled students : ${byStudent.size}   (${noPay} with no payment recorded)`);
  console.log(`  payments          : ${payCount}`);
  console.log(`  total amount      : AED ${grandAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`  total hours       : ${grandHrs.toFixed(1)}`);
})().catch((e) => { console.error(e); process.exit(1); });
