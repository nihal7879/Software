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
    const d: any = (XLSX as any).SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    // A CSV can still hand us a Date. Anything inside the last minute of a day is
    // that same rounding artefact, so it counts as the day about to start.
    const ms = v.getHours() * 3600e3 + v.getMinutes() * 60e3 + v.getSeconds() * 1000 + v.getMilliseconds();
    const d = ms > 86400e3 - 60e3 ? new Date(v.getTime() + 60e3) : v;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return v == null ? '' : String(v).trim();
};

// Parse a File (.xlsx/.xls/.csv) → mapped rows. Uses the first sheet.
export async function parseFeeWorkbook(file: File): Promise<ImportRow[]> {
  const buf = await file.arrayBuffer();
  // No `cellDates` — date cells stay as their raw serial number and fmtDate reads
  // the calendar day off that, which is the only lossless route (see above).
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  if (json.length === 0) return [];

  const hmap = headerMap(Object.keys(json[0]));

  return json.map((raw) => {
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
  }).filter((r) => Object.keys(r).length > 1); // drop fully-empty rows
}
