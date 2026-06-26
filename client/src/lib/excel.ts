import * as XLSX from 'xlsx';

// One parsed fee row, mapped to the fields the import endpoint understands.
export type ImportRow = {
  form_no?: string;
  student_name?: string;
  amount?: string;
  payment_date?: string;
  transaction_reference?: string;
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
  payment_source: ['source', 'paymentsource', 'mode', 'bank', 'paymentmode', 'paidvia', 'channel'],
  parent_name: ['parent', 'parentname', 'paidby', 'guardian', 'payee'],
  course_package_hours: ['packagehours', 'pkghrs', 'hours', 'coursepackagehours', 'pkghours'],
  notes: ['notes', 'remark', 'remarks', 'note', 'description', 'comment', 'transaction', 'transactiondetails', 'narration', 'particulars'],
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

const fmtDate = (v: any): string => {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return v == null ? '' : String(v).trim();
};

// Parse a File (.xlsx/.xls/.csv) → mapped rows. Uses the first sheet.
export async function parseFeeWorkbook(file: File): Promise<ImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
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
      const v = field === 'payment_date' ? fmtDate(value) : value == null ? '' : String(value).trim();
      (out as any)[field] = v;
    }
    return out;
  }).filter((r) => Object.keys(r).length > 1); // drop fully-empty rows
}
