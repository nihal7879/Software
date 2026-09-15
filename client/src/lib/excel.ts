import * as XLSX from 'xlsx';

// One parsed fee row, mapped to the fields the import endpoint understands.
export type ImportRow = {
  form_no?: string;
  student_name?: string;
  amount?: string;
  payment_date?: string;
  transaction_reference?: string;
  transaction_narration?: string;
  payment_source?: string;
  parent_name?: string;
  course_package_hours?: string;
  notes?: string;
  raw: Record<string, any>;
};

// Header aliases → canonical field. Headers are normalised (lowercased,
// non-alphanumerics stripped) before lookup so "Form No.", "form_no", "FORM NO"
// all map the same.
const FIELD_ALIASES: Record<string, string[]> = {
  form_no: ['formno', 'form', 'formnumber', 'formno'],
  student_name: ['studentname', 'student', 'name', 'studentsname', 'nameofstudent'],
  amount: ['amount', 'fees', 'feesreceived', 'amountpaid', 'paid', 'feespaid', 'feereceived', 'amountreceived', 'feesamount', 'credit', 'creditamount', 'creditamt'],
  payment_date: ['date', 'paymentdate', 'paydate', 'dateofpayment', 'transactiondate', 'paiddate'],
  transaction_reference: ['reference', 'transactionreference', 'ref', 'utr', 'txnref', 'referenceno', 'referencenumber', 'transactionref', 'transactionid'],
  // The bank's own statement line. It used to fall into `notes`, which put a
  // 260-character machine string where the admin's own remark belongs — and
  // there was nowhere left for the remark itself.
  transaction_narration: ['transaction', 'transactiondetails', 'narration', 'particulars', 'description', 'bankdescription', 'statementnarration'],
  payment_source: ['source', 'paymentsource', 'mode', 'bank', 'paymentmode', 'paidvia', 'channel'],
  parent_name: ['parent', 'parentname', 'paidby', 'guardian', 'payee'],
  course_package_hours: ['packagehours', 'pkghrs', 'hours', 'coursepackagehours', 'pkghours'],
  notes: ['notes', 'remark', 'remarks', 'note', 'comment'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Build header → field map for one sheet's header keys.
function headerMap(keys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of keys) {
    const n = norm(key);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(n)) { map[key] = field; break; }
    }
  }
  return map;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const EXCEL_MAX_SERIAL = 2958465; // 9999-12-31, the last date Excel can hold

// Excel keeps a date as a day count, not text. SheetJS's `cellDates` option turns
// that count into a JS Date using local-time arithmetic, and the floating-point
// rounding can land a few seconds *short* of midnight — 25-Aug-2026 (serial
// 46259) came back as 24-Aug 23:59:50 here, so reading the local calendar day
// imported it as the 24th. Asking SheetJS for the calendar parts of the serial
// instead skips both the rounding and the timezone.
const fmtDate = (v: any): string => {
  if (typeof v === 'number' && isFinite(v) && v >= 1 && v <= EXCEL_MAX_SERIAL) {
    // SSF sits on the module in the browser build, and under `default` when the
    // library is loaded as CommonJS — read whichever is there.
    const ssf = (XLSX as any).SSF || (XLSX as any).default?.SSF;
    const d: any = ssf?.parse_date_code(v);
    if (d && d.y) return `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    // A CSV can still hand us a Date. Anything inside the last minute of a day is
    // that same rounding artefact, so it counts as the day about to start.
    const ms = v.getHours() * 3600e3 + v.getMinutes() * 60e3 + v.getSeconds() * 1000 + v.getMilliseconds();
    const d = ms > 86400e3 - 60e3 ? new Date(v.getTime() + 60e3) : v;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const text = v == null ? '' : String(v).trim();
  // "03 Aug 2026" / "3-August-2026": a bank statement writes dates as words.
  // Read here rather than on the server, where "01/08/2026"-style guessing is
  // ambiguous; the month is a word, so there is nothing to guess.
  const m = text.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]{3,9})[\s\-\/,]+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) return `${m[3]}-${pad2(month)}-${pad2(Number(m[1]))}`;
  }
  return text;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// What the file turned out to be, for the message shown after importing.
export type ImportInfo = {
  format: 'standard' | 'statement';
  /** Bank statement only: rows left out, and why. */
  skippedDebit: number;
  skippedEmpty: number;
  skippedBalance: number;
  /** Credits that are not student fees (see NON_FEE_CREDITS), either format. */
  skippedNonFee: { date: string; amount: string; who: string; reason: string }[];
};

// Money that arrives but is not a student paying a fee — left out of every
// import, statement or the institute's own sheet, and listed in the import
// message so nothing vanishes unseen. Add a rule here when a new kind turns up.
//
// Tested on the SENDER where the bank line names one ("IPP TRANSFER AE55… -
// INITIUM HOLDINGS LLCFZ - …"), so a parent whose reference happens to mention
// the institute is not caught; on the whole line only when there is no sender.
const NON_FEE_CREDITS: { reason: string; test: (sender: string, line: string) => boolean }[] = [
  // Transfers from the institute's own group companies — internal, not fees.
  { reason: "from the institute's own company", test: (sender) => /\binitium\b/i.test(sender) },
  // Visa money for staff (e.g. "FOR PAYMENT OF VISA TO 3 TEACHERS").
  { reason: 'a visa payment', test: (_s, line) => /\bpayment\s+of\s+visa\b|\bvisa\s+payment\b/i.test(line) },
];

// The sender in a bank line — the part after the first " - ":
// "IPP TRANSFER AE55… - INITIUM HOLDINGS LLCFZ - MP_2_B - …" → "INITIUM HOLDINGS LLCFZ".
const senderOf = (line: string) => {
  const parts = line.split(/\s+-\s+/);
  return parts.length >= 2 ? parts[1].trim() : '';
};

/** Why this credit is not a fee, or null when it may be one. */
const nonFeeReason = (line: string): { who: string; reason: string } | null => {
  const text = String(line || '').trim();
  if (!text) return null;
  const sender = senderOf(text);
  const rule = NON_FEE_CREDITS.find((r) => r.test(sender || text, text));
  return rule ? { who: sender || text.slice(0, 40), reason: rule.reason } : null;
};

// Columns only a bank statement has. A sheet with a Debit (or Value / Due Date)
// column is read as one: credits only, dated by the value date.
const STATEMENT_ALIASES = {
  date: ['date', 'transactiondate', 'postingdate', 'txndate', 'bookingdate'],
  dueDate: ['valuedate', 'duedate'],
  credit: ['credit', 'creditamount', 'creditamt', 'deposit', 'deposits', 'moneyin'],
  debit: ['debit', 'debitamount', 'debitamt', 'withdrawal', 'withdrawals', 'moneyout'],
};

// "+3,500.00", "-40,000.00", "AED 2,100" → a number; blank or unreadable → 0.
const money = (v: any): number => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
};

const isAllEmpty = (cells: any[]) => cells.every((c) => String(c ?? '').trim() === '');

// Parse a File (.xlsx/.xls/.csv) → mapped rows. Uses the first sheet.
//
// Two layouts are accepted:
//  • the institute's own sheet — header on the first row, one payment per row;
//  • a bank account statement — a block of account details first, then a header
//    row (Date, Value Date, Reference Number, Description, Credit, Debit,
//    Balance). Only credits are payments: debits, rows with neither amount
//    (opening / closing balance lines) and the Balance column are left out.
// The header row is found by looking for it, not assumed to be row 1, which is
// what lets the statement's leading details block through.
export async function parseFeeWorkbook(file: File): Promise<{ rows: ImportRow[]; info: ImportInfo }> {
  const info: ImportInfo = { format: 'standard', skippedDebit: 0, skippedEmpty: 0, skippedBalance: 0, skippedNonFee: [] };
  const buf = await file.arrayBuffer();
  // No `cellDates` — date cells stay as their raw serial number and fmtDate reads
  // the calendar day off that, which is the only lossless route (see above).
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], info };
  const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: true });
  if (grid.length === 0) return { rows: [], info };

  // The header: the first row (of the first 30) naming at least two known
  // columns, one of them a date or an amount. Falls back to row 1.
  const known = new Set([
    ...Object.values(FIELD_ALIASES).flat(),
    ...Object.values(STATEMENT_ALIASES).flat(),
  ]);
  const anchor = new Set([...FIELD_ALIASES.payment_date, ...FIELD_ALIASES.amount, ...STATEMENT_ALIASES.dueDate, ...STATEMENT_ALIASES.credit]);
  let headerIdx = grid.slice(0, 30).findIndex((r) => {
    const names = r.map((c) => norm(String(c ?? '')));
    return names.filter((n) => known.has(n)).length >= 2 && names.some((n) => anchor.has(n));
  });
  if (headerIdx < 0) headerIdx = 0;
  const headers: string[] = grid[headerIdx].map((c) => String(c ?? '').trim());
  const normed = headers.map(norm);
  const col = (aliases: string[]) => normed.findIndex((n) => aliases.includes(n));
  const body = grid.slice(headerIdx + 1).filter((r) => !isAllEmpty(r));

  const debitCol = col(STATEMENT_ALIASES.debit);
  const dueCol = col(STATEMENT_ALIASES.dueDate);

  // ---- bank statement ---------------------------------------------------------
  if (debitCol >= 0 || dueCol >= 0) {
    info.format = 'statement';
    const dateCol = col(STATEMENT_ALIASES.date);
    const creditCol = col(STATEMENT_ALIASES.credit);
    const refCol = col(FIELD_ALIASES.transaction_reference);
    const descCol = col(FIELD_ALIASES.transaction_narration);
    const cell = (r: any[], i: number) => (i >= 0 ? r[i] : '');
    const rows: ImportRow[] = [];
    for (const r of body) {
      // Opening / closing balance lines are not money received, whatever they hold.
      if (r.some((c) => /\b(opening|closing)\s+balance\b/i.test(String(c ?? '')))) { info.skippedBalance++; continue; }
      const credit = Math.abs(money(cell(r, creditCol)));
      const debit = Math.abs(money(cell(r, debitCol)));
      if (!credit && !debit) { info.skippedEmpty++; continue; }
      if (!credit) { info.skippedDebit++; continue; }
      // The value (due) date is when the money actually arrived; the posting date
      // only when the statement has no value date, or leaves it blank.
      const due = fmtDate(cell(r, dueCol));
      const date = due || fmtDate(cell(r, dateCol));
      const narration = String(cell(r, descCol) ?? '').replace(/\s*\n\s*/g, ' ').trim();
      const notFee = nonFeeReason(narration);
      if (notFee) { info.skippedNonFee.push({ date, amount: String(credit), ...notFee }); continue; }
      const raw: Record<string, any> = {};
      headers.forEach((h, i) => { if (h && i !== debitCol && !/balance/i.test(h)) raw[h] = r[i]; });
      rows.push({
        payment_date: date,
        amount: String(credit),
        transaction_reference: String(cell(r, refCol) ?? '').trim(),
        transaction_narration: narration,
        raw,
      });
    }
    return { rows, info };
  }

  // ---- the institute's own sheet — exactly as before --------------------------
  const hmap = headerMap(headers);
  const rows = body.map((cells) => {
    const raw: Record<string, any> = {};
    headers.forEach((h, i) => { if (h) raw[h] = cells[i] ?? ''; });
    const out: ImportRow = { raw };
    for (const [key, value] of Object.entries(raw)) {
      const field = hmap[key];
      if (!field) continue;
      const v = field === 'payment_date'
        ? fmtDate(value)
        // Bank narrations wrap mid-field in the sheet; those newlines are
        // layout, not content, so they collapse to single spaces.
        : value == null ? '' : String(value).replace(/\s*\n\s*/g, ' ').trim();
      (out as any)[field] = v;
    }
    return out;
  })
    .filter((r) => Object.keys(r).length > 1) // drop rows with no known column
    .filter((r) => {
      const notFee = nonFeeReason(r.transaction_narration || '');
      if (notFee) info.skippedNonFee.push({ date: r.payment_date || '', amount: r.amount || '', ...notFee });
      return !notFee;
    });
  return { rows, info };
}
