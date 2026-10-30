import { memo, useEffect, useRef } from 'react';

/**
 * The sign-in background: a field of points lying on a slow wave, lit from
 * the front.
 *
 * Drawn on a canvas rather than as SVG because it is about two thousand dots.
 * As <circle> elements that is ~60 KB of markup and two thousand nodes in the
 * tree, on the one page every user has to get through; on a canvas it is a
 * few hundred bytes of code and one element.
 *
 * Nothing here is random at runtime. The jitter and the colour picks come
 * from a hash of each point's own row and column, so the drawing is the same
 * on every load — a background that reshuffles itself on refresh reads as a
 * glitch, not as decoration.
 *
 * It is painted once and never animated: it sits behind a form, and movement
 * behind the field someone is typing into is the kind of thing that is
 * admired in a screenshot and resented every morning.
 */

// Warm white for most of them, the mark's own colours for a scattered few.
const BASE = [226, 214, 200];
const ACCENTS: [number, number, number][] = [
  [249, 115, 22],   // brand orange
  [47, 79, 158],    // logo blue
  [59, 182, 166],   // logo teal
  [142, 198, 63],   // logo green
  [232, 177, 0],    // logo yellow
];

/** Deterministic, in [0, 1). */
function hash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function paint(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  if (!w || !h) return;

  // Drawn at the screen's real pixel density, or the dots come out soft.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ROWS = 30;

  for (let r = 0; r < ROWS; r++) {
    // 0 at the back of the field, 1 at the front. Squared, so the rows bunch
    // up towards the horizon the way a receding surface does.
    const t = r / (ROWS - 1);
    const depth = t * t;

    const baseY = h * (0.34 + 0.78 * depth);
    const amp = h * (0.03 + 0.085 * t);
    const gap = 9 + 16 * t;          // points spread out as they come forward
    const radius = 0.7 + 2.3 * t;
    const alpha = 0.10 + 0.6 * t;

    for (let x = -gap, i = 0; x < w + gap; x += gap, i++) {
      // Two waves of different lengths, so the surface never looks like a
      // single sine curve repeated.
      const y =
        baseY +
        Math.sin(x / (w * 0.17) + r * 0.33) * amp +
        Math.sin(x / (w * 0.061) - r * 0.21) * amp * 0.34;

      const j = hash(r * 31 + i, 7);
      // A tenth of them carry a brand colour; the rest are warm white.
      const colour = j > 0.9 ? ACCENTS[Math.floor(hash(i, r) * ACCENTS.length)] : BASE;
      const lit = j > 0.9;

      /**
       * Depth of field. The far half of the surface is properly out of focus
       * and the near half is sharp, rather than a blur that fades evenly from
       * one end to the other — a lens does not do that, and the even version
       * read as a slightly smudged drawing instead of a photographed one.
       *
       * `backness` is 1 at the horizon and reaches 0 at a little past halfway,
       * squared so the focus comes in quickly once it starts.
       */
      const backness = Math.max(0, 1 - t / 0.55);
      const haze = backness * backness * 20;
      ctx.shadowBlur = (lit ? 10 + 10 * t : 0.5) + haze;
      ctx.shadowColor = `rgba(${colour[0]},${colour[1]},${colour[2]},${lit ? 0.75 : 0.35})`;
      ctx.globalAlpha = Math.min(1, alpha * (lit ? 1.5 : 1) * (0.55 + hash(i, r * 3) * 0.6) * (1 - backness * 0.3));
      ctx.fillStyle = `rgb(${colour[0]},${colour[1]},${colour[2]})`;

      ctx.beginPath();
      // A point out of focus grows as it dims, the way a real one does.
      ctx.arc(x, y, radius * (lit ? 1.35 : 1) * (0.7 + hash(i * 5, r) * 0.6) * (1 + backness * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

export const BrandWave = memo(function BrandWave({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paint(canvas);

    // Repainted on resize, because the wave is laid out in the panel's own
    // width — not scaled, which would stretch the dots into ovals.
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint(canvas));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
});
