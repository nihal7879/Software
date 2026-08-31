import ExcelJS from 'exceljs';

// Excel export of the Student Hours Statement, laid out exactly like the sheet
// the client already circulates (Sl.pdf): a month pivot of hours consumed and
// fees received, then the per-lecture detail with the columns DATE / Month /
// Form No / Student Name / Time In / Time Out / No of Hrs / Name of Teacher.
//
// The only thing added to that format is the "Exported On" stamp at the top.
// No masthead, no title block, no summary panel — the client reads this sheet
// against their own and anything extra just gets in the way. The student name
// and form number are already columns in the detail table.
//
// exceljs rather than the xlsx already in the project: the community build of
// xlsx writes no cell styling at all (fills, fonts and borders are a paid
// feature), which rules out a document meant to be sent to a parent.

const HEAD_BG = '#1F2937';      // table header
const BAND_BG = '#F8FAFC';      // zebra banding
const LINE = '#D1D5DB';

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-08-04' -> 'Aug-26', matching the client's month labels.
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
};

// '16:15:00' -> '4:15:00 PM'. Written as text so it reads identically to the
// client's sheet rather than becoming an Excel time serial.
const clockTime = (t?: string | null) => {
  if (!t) return '';
  const [hs, ms, ss] = String(t).split(':');
  let h = Number(hs);
  if (Number.isNaN(h)) return String(t);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${ms ?? '00'}:${ss ?? '00'} ${ampm}`;
};

// Built in UTC, not local time. exceljs converts a JS Date to an Excel serial
// through its UTC value, so a local-midnight Date west or east of Greenwich
// lands on the wrong side of midnight and Excel renders the previous day —
// in IST (+5:30) every lecture date came out one day early.
const asDate = (d?: string | null) => {
  if (!d) return null;
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, day)) : null;
};

export type StatementLecture = {
  session_date: string;
  time_in?: string | null;
  time_out?: string | null;
  hours_consumed?: number | string | null;
  teacher_name?: string | null;
  subject_name?: string | null;
};

export type StatementPackage = {
  start_date?: string | null;
  created_at?: string | null;
  paid_amount?: number | string | null;
  paid_date?: string | null;
  package_hours?: number | string | null;
};

export type StatementInput = {
  student: { form_no?: string; full_name?: string; year_grade?: string | null; school_name?: string | null };
  summary: { total_hours_credited?: number | string; total_hours_consumed?: number | string; hours_left?: number | string; fee_status?: string };
  lectures: StatementLecture[];
  packages: StatementPackage[];
  /** Set when the on-screen date filter is active; the export follows it. */
  from?: string;
  to?: string;
};

export async function downloadHoursStatement(input: StatementInput): Promise<string> {
  const { student, summary } = input;
  const num = (v: any) => Number(v || 0);

  const lectures = [...input.lectures]
    .filter((l) => {
      const d = String(l.session_date).slice(0, 10);
      if (input.from && d < input.from) return false;
      if (input.to && d > input.to) return false;
      return true;
    })
    .sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));

  // Payments in range, keyed by the month they landed in.
  const payments = input.packages
    .map((p) => ({
      date: String(p.paid_date || p.start_date || p.created_at || '').slice(0, 10),
      amount: num(p.paid_amount),
    }))
    .filter((p) => p.date && p.amount > 0)
    .filter((p) => (!input.from || p.date >= input.from) && (!input.to || p.date <= input.to));

  // One column per month that has either hours or money, oldest first.
  const hoursByMonth = new Map<string, number>();
  for (const l of lectures) {
    const ym = String(l.session_date).slice(0, 7);
    hoursByMonth.set(ym, (hoursByMonth.get(ym) || 0) + num(l.hours_consumed));
  }
  const feesByMonth = new Map<string, number>();
  for (const p of payments) {
    const ym = p.date.slice(0, 7);
    feesByMonth.set(ym, (feesByMonth.get(ym) || 0) + p.amount);
  }
  const months = [...new Set([...hoursByMonth.keys(), ...feesByMonth.keys()])].sort();

  const totalHours = [...hoursByMonth.values()].reduce((a, b) => a + b, 0);
  const totalFees = [...feesByMonth.values()].reduce((a, b) => a + b, 0);

  const now = new Date();
  const stamp =
    `${now.getDate()}-${MONTHS[now.getMonth()]}-${now.getFullYear()} ` +
    `${((now.getHours() % 12) || 12)}:${String(now.getMinutes()).padStart(2, '0')} ` +
    `${now.getHours() >= 12 ? 'PM' : 'AM'}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'STEM Vision';
  wb.created = now;
  const ws = wb.addWorksheet('Hours Statement', {
    pageSetup: {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  const DETAIL_COLS = 8; // DATE .. Name of Teacher
  const width = Math.max(DETAIL_COLS, months.length + 3);

  const border = () => ({
    top: { style: 'thin' as const, color: { argb: argb(LINE) } },
    left: { style: 'thin' as const, color: { argb: argb(LINE) } },
    bottom: { style: 'thin' as const, color: { argb: argb(LINE) } },
    right: { style: 'thin' as const, color: { argb: argb(LINE) } },
  });

  let r = 1;

  // ---- the one addition to the client's format -----------------------------
  ws.getCell(r, 1).value = 'Exported On';
  ws.getCell(r, 1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: argb('#475569') } };
  ws.getCell(r, 2).value = stamp;
  ws.getCell(r, 2).font = { name: 'Calibri', size: 10 };
  r += 2;

  // ---- month pivot ---------------------------------------------------------
  ws.getCell(r, 1).value = '';
  months.forEach((m, i) => { ws.getCell(r, i + 2).value = monthLabel(m); });
  ws.getCell(r, months.length + 2).value = 'Grand Total';
  ws.getCell(r, months.length + 3).value = 'Hours left';
  for (let c = 1; c <= months.length + 3; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(HEAD_BG) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border();
  }
  ws.getRow(r).height = 18;
  r++;

  // Total Hours = hours consumed in each month, same as the client's sheet.
  ws.getCell(r, 1).value = 'Total Hours';
  ws.getCell(r, 1).font = { name: 'Calibri', size: 10, bold: true };
  months.forEach((m, i) => {
    const c = ws.getCell(r, i + 2);
    const v = hoursByMonth.get(m);
    if (v) { c.value = v; c.numFmt = '0.0'; }
  });
  const gt = ws.getCell(r, months.length + 2);
  gt.value = totalHours; gt.numFmt = '0.0'; gt.font = { name: 'Calibri', size: 10, bold: true };
  const hl = ws.getCell(r, months.length + 3);
  hl.value = num(summary.hours_left); hl.numFmt = '0.0';
  hl.font = { name: 'Calibri', size: 10, bold: true, color: { argb: argb(num(summary.hours_left) < 0 ? '#DC2626' : '#059669') } };
  for (let c = 1; c <= months.length + 3; c++) {
    ws.getCell(r, c).border = border();
    if (c > 1) ws.getCell(r, c).alignment = { horizontal: 'center' };
  }
  r++;

  ws.getCell(r, 1).value = 'Fees Received';
  ws.getCell(r, 1).font = { name: 'Calibri', size: 10, bold: true };
  months.forEach((m, i) => {
    const c = ws.getCell(r, i + 2);
    const v = feesByMonth.get(m);
    if (v) { c.value = v; c.numFmt = '#,##0'; }
  });
  const gf = ws.getCell(r, months.length + 2);
  gf.value = totalFees; gf.numFmt = '#,##0'; gf.font = { name: 'Calibri', size: 10, bold: true };
  for (let c = 1; c <= months.length + 3; c++) {
    ws.getCell(r, c).border = border();
    if (c > 1) ws.getCell(r, c).alignment = { horizontal: 'center' };
  }
  r += 2;

  // ---- lecture detail ------------------------------------------------------
  const HEADERS = ['DATE', 'Month', 'Form No', 'Student Name', 'Time In', 'Time Out', 'No of Hrs', 'Name of Teacher'];
  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(HEAD_BG) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border();
  });
  ws.getRow(r).height = 18;
  r++;

  lectures.forEach((l, i) => {
    const d = String(l.session_date).slice(0, 10);
    const row = [
      asDate(d),
      monthLabel(d.slice(0, 7)),
      student.form_no || '',
      student.full_name || '',
      clockTime(l.time_in),
      clockTime(l.time_out),
      num(l.hours_consumed),
      l.teacher_name || '',
    ];
    row.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = v as any;
      cell.font = { name: 'Calibri', size: 10 };
      cell.border = border();
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BAND_BG) } };
      if (c === 0) { cell.numFmt = 'd-mmm-yyyy'; cell.alignment = { horizontal: 'left' }; }
      if (c === 1 || c === 2 || c === 4 || c === 5) cell.alignment = { horizontal: 'center' };
      if (c === 6) { cell.numFmt = '0.0'; cell.alignment = { horizontal: 'center' }; }
    });
    r++;
  });

  if (!lectures.length) {
    ws.mergeCells(r, 1, r, DETAIL_COLS);
    const c = ws.getCell(r, 1);
    c.value = 'No lectures recorded in this period.';
    c.font = { name: 'Calibri', size: 10, italic: true, color: { argb: argb('#64748B') } };
    c.alignment = { horizontal: 'center' };
    c.border = border();
  }

  // ---- widths --------------------------------------------------------------
  ws.getColumn(1).width = 15;
  ws.getColumn(2).width = 11;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 26;
  ws.getColumn(5).width = 13;
  ws.getColumn(6).width = 13;
  ws.getColumn(7).width = 11;
  ws.getColumn(8).width = 22;
  for (let c = 9; c <= width; c++) ws.getColumn(c).width = 11;

  ws.headerFooter.oddFooter = `&C &P of &N &R Exported ${stamp}`;

  // ---- download ------------------------------------------------------------
  const buf = await wb.xlsx.writeBuffer();
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fileName =
    `Hours-Statement_${safe(student.form_no || 'NA')}_${safe(student.full_name || 'student')}` +
    `_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` +
    `-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.xlsx`;

  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
