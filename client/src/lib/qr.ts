/**
 * The QR code on a teacher's desk.
 *
 * The image holds a link rather than the bare code, so a phone's own camera app
 * can open it too: it lands on /scan, which remembers the code and sends the
 * student through the login they already have. Inside the app the scanner reads
 * the same image, and a code typed by hand works just as well.
 */
export const PENDING_SCAN = 'pendingScan';

export function scanUrl(code: string) {
  return `${window.location.origin}/scan?c=${encodeURIComponent(code)}`;
}

/** The code inside whatever was scanned or typed, or null if there isn't one. */
export function codeFromScan(text: string): string | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // A link from the printed card.
  const m = raw.match(/[?&]c=([A-Za-z0-9]+)/);
  if (m) return m[1].toUpperCase();
  // The code on its own, typed off the card.
  if (/^[A-Za-z0-9]{4,32}$/.test(raw)) return raw.toUpperCase();
  return null;
}

/**
 * Print the desk cards. A separate window with nothing but the cards in it, so
 * the app's own layout and dark mode stay out of the printout — these go up on a
 * desk and have to be plain black on white.
 */
export async function printQrCards(cards: { name: string; code: string }[]) {
  const QRCode = (await import('qrcode')).default;
  const images = await Promise.all(
    cards.map((c) =>
      QRCode.toDataURL(scanUrl(c.code), { width: 520, margin: 1, errorCorrectionLevel: 'M' })
    )
  );
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return false;
  const esc = (s: string) => s.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string));
  win.document.write(`<!doctype html><html><head><title>Class QR codes</title><style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 16px;
           background: #fff; color: #000; }
    .card { width: 340px; border: 2px solid #000; border-radius: 14px; padding: 18px;
            margin: 0 12px 16px 0; text-align: center; display: inline-block; vertical-align: top;
            page-break-inside: avoid; }
    .name { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
    .role { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 12px; }
    img { width: 260px; height: 260px; display: block; margin: 0 auto; }
    .code { font-family: ui-monospace, Consolas, monospace; font-size: 18px; letter-spacing: .14em;
            margin-top: 10px; font-weight: 700; }
    .how { font-size: 11px; margin-top: 8px; line-height: 1.45; }
    @media print { body { padding: 0; } .noprint { display: none; } }
  </style></head><body>
    <div class="noprint" style="margin-bottom:12px">
      <button onclick="window.print()" style="padding:8px 16px;font-size:14px">Print</button>
    </div>
    ${cards
      .map(
        (c, i) => `<div class="card">
          <div class="name">${esc(c.name)}</div>
          <div class="role">STEM Vision</div>
          <img src="${images[i]}" alt="QR code" />
          <div class="code">${esc(c.code)}</div>
          <div class="how">Scan when your class starts, and again when it ends.<br/>
            Open the app &rarr; Check in, or use your phone camera.</div>
        </div>`
      )
      .join('')}
  </body></html>`);
  win.document.close();
  return true;
}
