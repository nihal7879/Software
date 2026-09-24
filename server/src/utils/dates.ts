/**
 * Today's date at the institute, as YYYY-MM-DD.
 *
 * Not `new Date().toISOString().slice(0, 10)`: toISOString is always UTC
 * whatever the server's timezone is set to, so between midnight and 4 AM in
 * Dubai it hands back yesterday's date. Reading the local parts instead keeps
 * it on the day the office is actually having — the process runs on Dubai time
 * (see config.ts), and Vercel cannot override that.
 *
 * Only for dates the server works out itself. Anything MySQL stamps is already
 * right: the connection is set to +04:00 (see db.ts).
 */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
