import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/**
 * A QR code on screen. Always drawn black on white whatever the theme is doing,
 * because a scanner needs the contrast and these get printed.
 */
export function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current || !text) return;
    QRCode.toCanvas(ref.current, text, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => { /* nothing to draw is better than a crash */ });
  }, [text, size]);

  return <canvas ref={ref} width={size} height={size} className="rounded-lg bg-white" />;
}
