import { memo, type ReactNode } from 'react';
import { Logo } from './Logo';
import { BrandWave } from './BrandWave';
import { BrandPaper } from './BrandPaper';

/**
 * The sign-in screen's background and the card that sits on it, shared by
 * sign-in, forgotten password, the forced password change and all three
 * registration pages, so the six stay one design.
 *
 * It used to be a stock photograph of a classroom pulled from Unsplash at
 * load, filling the left half of the screen. Three things were wrong with that: it is the same picture a hundred
 * other products use, so the first screen of the institute's own system looked
 * like nobody's in particular; it is not their classroom; and it put a
 * third-party CDN in the path of the one page every user has to get through —
 * on a bad connection the panel was a grey rectangle until it arrived.
 *
 * What is here instead is the institute's own mark. The logo's brain is drawn
 * as a low-poly mesh, so the panel is that mesh: points joined into triangles,
 * a few of them lit in the brand's orange and blue. It is ~2 KB of inline SVG,
 * needs no network, and is recognisably theirs and nobody else's.
 */

/**
 * Which backdrop the sign-in screens wear. One word, in one place, so the
 * three can be compared on the real pages and switched back without hunting
 * through markup.
 *
 *   'orbit' — the mark very large and faint, its points lifted into orbit
 *   'paper' — an answer sheet: ruled lines, margin rule, watermarked mark
 *   'wave'  — a field of points on a lit wave
 *
 * `dark` is not decoration: it decides which copy of the logo is drawn and
 * what colour the tagline is, so a light backdrop cannot end up with white
 * text on it.
 */
const BACKDROP: 'plain' | 'paper' | 'wave' = 'plain';

const SURFACE = {
  plain: { className: 'auth-brand', dark: true },
  paper: { className: 'auth-paper', dark: false },
  wave: { className: 'auth-brand', dark: true },
} as const;

export function AuthShell({
  children,
  /**
   * A wider card, for the registration forms.
   *
   * Sign-in asks for two things and reads best narrow. Registration asks for
   * a page of them in three-column rows, and at the sign-in width each column
   * was about 120px — a date of birth and a mobile number crushed side by
   * side. Same shell, same backdrop, one more breakpoint.
   */
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  const surface = SURFACE[BACKDROP];
  return (
    <div className={`min-h-screen ${surface.className} relative flex items-center justify-center px-4 py-10 overflow-hidden`}>
      {BACKDROP === 'wave' && <BrandWave className="absolute inset-0 pointer-events-none" />}
      {BACKDROP === 'paper' && <BrandPaper />}

      <div className={`relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-[26.5rem]'}`}>
        {/* The mark sits on the backdrop, above the card, so the card itself
            can start straight into the question it is asking. */}
        <div className="flex flex-col items-center mb-6">
          <Logo height={32} onDark={surface.dark} />
          <p className={`mt-3 text-[0.65rem] font-bold uppercase tracking-[0.3em] ${surface.dark ? 'text-white/50' : 'muted'}`}>
            Explore · Experiment · Excel
          </p>
        </div>

        {/* The card states its own ink. The backdrop may set a near-white
            colour for the logo and the tagline, and anything inside the card
            that does not name a colour of its own would inherit it — which
            left the heading white on a white card. */}
        <div
          className="rounded-2xl p-6 sm:p-8 ring-1 ring-black/5 dark:ring-white/10 shadow-[0_28px_70px_-18px_rgba(20,14,8,0.55)]"
          style={{ background: 'var(--color-card)', color: 'var(--color-text)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
