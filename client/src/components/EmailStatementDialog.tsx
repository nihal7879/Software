import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { api } from '../api/client';
import { Overlay } from './Overlay';
import { toast } from './Toast';
import { buildHoursStatement, type StatementInput } from '../lib/hoursStatementExcel';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ArrayBuffer → base64, in chunks: a statement can be tens of KB, which is too
// many arguments to hand String.fromCharCode in one call.
const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Emails a student's hours statement to a parent — the same Excel "Export
 * Excel" downloads, attached. The parent's addresses on record are listed to
 * tick; any other address can be typed. `input` is built at the moment of
 * sending, so the attachment follows the date filter on screen.
 */
export function EmailStatementDialog({
  studentId,
  studentName,
  input,
  onClose,
}: {
  studentId: number;
  studentName: string;
  input: () => StatementInput;
  onClose: () => void;
}) {
  const recipients = useQuery({
    queryKey: ['email-recipients', studentId],
    queryFn: () => api.get(`/email/recipients/${studentId}`).then((r) => r.data as { data: { email: string; label: string }[]; configured: boolean }),
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Tick the first parent address by default — the usual case is one click.
  useEffect(() => {
    const first = recipients.data?.data?.[0]?.email;
    if (first && picked.length === 0) setPicked([first]);
  }, [recipients.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const extra = other.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
  const badExtra = extra.filter((e) => !EMAIL_RE.test(e));
  const to = [...new Set([...picked, ...extra.filter((e) => EMAIL_RE.test(e))])];

  const send = async () => {
    setError('');
    if (badExtra.length) { setError(`Not a valid email: ${badExtra.join(', ')}`); return; }
    if (to.length === 0) { setError('Choose or type at least one email address.'); return; }
    setBusy(true);
    try {
      const { buffer, fileName } = await buildHoursStatement(input());
      const r = await api.post('/email/hours-statement', { student_id: studentId, to, filename: fileName, file_base64: toBase64(buffer) });
      if (r.data.status === 'sent') toast(`Statement emailed to ${to.join(', ')}`);
      else toast('Email is not set up yet — the statement was recorded but not sent.', 'error');
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not send the statement.');
    } finally {
      setBusy(false);
    }
  };

  const list = recipients.data?.data || [];
  const toggle = (email: string) => setPicked((p) => (p.includes(email) ? p.filter((x) => x !== email) : [...p, email]));

  return (
    <Overlay align="center" onClose={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><Mail size={18} /> Email statement</h2>
        <p className="muted text-sm mb-4">The hours statement for <b>{studentName}</b> will be attached as an Excel file.</p>

        {recipients.data && !recipients.data.configured && (
          <div className="text-sm rounded-lg px-3 py-2 mb-3 bg-amber-500/15 text-amber-700 dark:text-amber-400">
            Email is not set up yet (the SMTP account in the server settings is still a placeholder). Sending will be
            recorded, but nothing will be delivered until it is.
          </div>
        )}

        <div className="text-xs font-medium muted mb-1">Send to</div>
        {recipients.isLoading ? (
          <p className="muted text-sm mb-3">Loading addresses…</p>
        ) : list.length === 0 ? (
          <p className="muted text-sm mb-3">No parent email on record — type one below.</p>
        ) : (
          <div className="space-y-1 mb-3">
            {list.map((r) => (
              <label key={r.email} className="flex items-start gap-2 text-sm cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[var(--color-card-alt)]">
                <input type="checkbox" className="mt-0.5" checked={picked.includes(r.email)} onChange={() => toggle(r.email)} />
                <span className="min-w-0">
                  <span className="block font-medium truncate">{r.email}</span>
                  <span className="block text-xs muted truncate">{r.label}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <label className="text-xs font-medium muted">Other email(s)</label>
        <input
          className="input mt-1"
          type="text"
          placeholder="e.g. parent@example.com"
          value={other}
          onChange={(e) => setOther(e.target.value)}
        />

        {error && <div className="text-sm text-red-500 mt-2">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button className="btn-primary flex-1" disabled={busy || recipients.isLoading} onClick={send}>
            {busy ? 'Sending…' : to.length ? `Send to ${to.length} address${to.length === 1 ? '' : 'es'}` : 'Send'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Overlay>
  );
}
