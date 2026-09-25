import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, LogIn, LogOut, X } from 'lucide-react';
import { api, todayIso } from '../../api/client';
import { Section, Spinner } from '../../components/ui';
import { toast } from '../../components/Toast';
import { codeFromScan, PENDING_SCAN } from '../../lib/qr';

/**
 * The student's own check-in screen: scan the code on the teacher's desk when
 * the class starts, and again when it ends. Every time comes from the server, so
 * a phone set to the wrong country still records the right moment.
 */

const READER_ID = 'qr-reader';

/** A timestamp from the server to a readable clock time. */
function clock(v: any) {
  if (!v) return '';
  const s = String(v);
  const hhmm = s.includes('T') ? s.slice(11, 16) : s.slice(11, 16);
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function dayLabel(v: any) {
  const d = String(v || '').slice(0, 10);
  if (!d) return '';
  // "Today" means today at the institute, not on the student's phone.
  return d === todayIso() ? 'Today' : d;
}

type ScanResult = {
  action: 'in' | 'out' | 'already_in';
  teacher: string;
  in_at?: string;
  out_at?: string;
  hours?: number;
  message: string;
};

export default function CheckIn() {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [camError, setCamError] = useState('');
  const scannerRef = useRef<any>(null);
  const busyRef = useRef(false); // one at a time: the camera fires on every frame

  const mine = useQuery({
    queryKey: ['my-checkins'],
    queryFn: () => api.get('/checkin/mine').then((r) => r.data.data as any[]),
  });

  const send = useMutation({
    mutationFn: (code: string) => api.post('/checkin', { code }).then((r) => r.data as ScanResult),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['my-checkins'] });
    },
    onError: (e: any) => {
      toast(e?.response?.data?.error || 'That scan did not go through.', 'error');
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  async function stopCamera() {
    const s = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (!s) return;
    try { await s.stop(); } catch { /* already stopped */ }
    try { s.clear(); } catch { /* nothing rendered */ }
  }

  function submit(text: string) {
    const code = codeFromScan(text);
    if (!code) {
      toast('That is not a class QR code.', 'error');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setResult(null);
    send.mutate(code);
  }

  async function startCamera() {
    setCamError('');
    setResult(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      // The div must be on screen before the library goes looking for it.
      await new Promise((r) => setTimeout(r, 0));
      const scanner = new Html5Qrcode(READER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text: string) => { stopCamera(); submit(text); },
        () => { /* a frame with no code in it: normal, every frame until one lands */ }
      );
    } catch (e: any) {
      await stopCamera();
      const blocked = e?.name === 'NotAllowedError' || String(e?.message || '').includes('Permission');
      setCamError(
        blocked
          ? 'The camera is blocked for this site. Allow it in your browser, or type the code below.'
          : 'The camera would not open on this device. Type the code under the QR instead.'
      );
    }
  }

  // Leaving the page switches the camera off.
  useEffect(() => () => { stopCamera(); }, []);

  // Arrived by scanning with the phone camera: /scan parked the code here.
  useEffect(() => {
    const pending = localStorage.getItem(PENDING_SCAN);
    if (pending) {
      localStorage.removeItem(PENDING_SCAN);
      submit(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = mine.data || [];
  const openRow = rows.find((r: any) => !r.out_at && r.status === 'Pending');

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <Section title="Check in">
        <p className="muted text-sm mb-4">
          Scan the QR code on your teacher&apos;s desk when the class starts, and scan it
          again when the class ends. You are charged only for the time between the two.
        </p>

        {openRow && !scanning && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <b>You are checked in</b> with {openRow.teacher_name} since {clock(openRow.in_at)}.
            Scan again when the class ends.
          </div>
        )}

        {result && !scanning && (
          <div
            className={`mb-4 rounded-xl p-4 border ${
              result.action === 'out'
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-blue-500/40 bg-blue-500/10'
            }`}
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 shrink-0 text-emerald-600" />
              <div>
                <div className="font-semibold">{result.message}</div>
                <div className="text-sm muted mt-1">
                  {result.action === 'out' ? (
                    <>
                      In {clock(result.in_at)} &middot; Out {clock(result.out_at)} &middot;{' '}
                      <b>{Number(result.hours || 0).toFixed(2)} hours</b>
                    </>
                  ) : (
                    <>In at {clock(result.in_at)}</>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* The camera view is mounted only while scanning, so the library has
            something to attach to and the stream is released when it is put away. */}
        {scanning && (
          <div className="mb-4">
            <div id={READER_ID} className="rounded-xl overflow-hidden bg-black" />
            <button className="btn-outline w-full mt-2" onClick={stopCamera}>
              <X className="w-4 h-4" /> Stop camera
            </button>
          </div>
        )}

        {!scanning && (
          <button
            className="btn-primary w-full justify-center py-3 text-base"
            onClick={startCamera}
            disabled={send.isPending}
          >
            <Camera className="w-5 h-5" />
            {send.isPending ? 'Sending...' : openRow ? 'Scan to check out' : 'Scan to check in'}
          </button>
        )}

        {camError && <p className="text-sm text-red-600 mt-3">{camError}</p>}

        {/* The code is printed under every QR, so a camera that will not open is
            never the end of it. */}
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <label className="text-[11px] font-semibold uppercase tracking-wide muted">
            Or type the code under the QR
          </label>
          <div className="flex gap-2 mt-1.5">
            <input
              className="input flex-1 font-mono tracking-widest uppercase"
              placeholder="ABCD2345EFGH"
              value={manual}
              maxLength={32}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manual.trim()) { submit(manual); setManual(''); }
              }}
            />
            <button
              className="btn-outline"
              disabled={!manual.trim() || send.isPending}
              onClick={() => { submit(manual); setManual(''); }}
            >
              Send
            </button>
          </div>
        </div>
      </Section>

      <Section title="My recent scans">
        {mine.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="muted text-sm">Nothing scanned yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r: any) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-sm"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <span className="font-semibold">{r.teacher_name}</span>
                <span className="muted">{dayLabel(r.session_date)}</span>
                <span className="inline-flex items-center gap-1">
                  <LogIn className="w-3.5 h-3.5 text-emerald-600" /> {clock(r.in_at)}
                </span>
                {r.out_at ? (
                  <span className="inline-flex items-center gap-1">
                    <LogOut className="w-3.5 h-3.5 text-orange-500" /> {clock(r.out_at)}
                  </span>
                ) : (
                  <span className="text-amber-600">still in</span>
                )}
                <span className="ml-auto tnum">
                  {r.hours != null ? `${Number(r.hours).toFixed(2)} h` : ''}
                </span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full ${
                    r.status === 'Confirmed'
                      ? 'bg-emerald-500/15 text-emerald-600'
                      : r.status === 'Discarded'
                      ? 'bg-red-500/15 text-red-600'
                      : 'bg-slate-500/15 muted'
                  }`}
                >
                  {r.status === 'Pending' ? 'with teacher' : String(r.status).toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
