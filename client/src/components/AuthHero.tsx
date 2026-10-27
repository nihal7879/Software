import { memo } from 'react';
import { Logo } from './Logo';

// The photo panel on the left of the sign-in and registration screens, shared so
// the two pages stay one design. Hidden below the lg breakpoint, where the form
// takes the whole screen.
//
// Pinned to exactly the screen's height (sticky + h-screen). It used to stretch
// to the height of the form beside it, so every hint line that appeared or
// disappeared under a field resized it — and `bg-cover` rescaled the photo to
// match, which read as the picture zooming in and out on each keystroke. memo:
// it takes no props, so the form re-rendering as the user types never touches it.
const PHOTO = 'url(https://images.unsplash.com/photo-1606761568499-6d2451b23c66?auto=format&fit=crop&w=1400&q=80)';

/**
 * The same photo as a short banner above the form on phones and tablets, where
 * the side panel is hidden. The form's sheet overlaps its rounded bottom edge.
 */
export const AuthBanner = memo(function AuthBanner() {
  return (
    <div
      className="lg:hidden relative bg-cover bg-center text-white px-6 pt-safe"
      style={{
        backgroundImage: `linear-gradient(170deg, rgba(40,30,20,0.35) 0%, rgba(30,22,16,0.85) 100%), ${PHOTO}`,
        minHeight: 'min(38vh, 320px)',
      }}
    >
      <div className="flex flex-col justify-between h-full pt-8 pb-14" style={{ minHeight: 'min(38vh, 320px)' }}>
        {/* onDark: the panel is a photograph, so the copy whose tagline has
            been lifted is the readable one whatever the theme. */}
        <Logo height={34} onDark />
        <p className="font-display text-[1.7rem] sm:text-3xl font-semibold leading-[1.15] max-w-sm">
          Empowering Education<br />through <span style={{ color: '#fdba74' }}>Innovation</span>
        </p>
      </div>
    </div>
  );
});

export const AuthHero = memo(function AuthHero() {
  return (
    <div
      className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen self-start flex-col justify-center p-14 text-white relative overflow-hidden bg-cover bg-center"
      style={{
        backgroundImage:
          `linear-gradient(160deg, rgba(40,30,20,0.55) 0%, rgba(60,40,25,0.45) 50%, rgba(30,22,16,0.7) 100%), ${PHOTO}`,
      }}
    >
      <div className="relative z-10 max-w-md">
        <Logo height={39} onDark className="mb-10" />
        <h1 className="font-display text-[2.75rem] font-semibold leading-[1.1] mb-5">
          Empowering Education<br />through <span style={{ color: '#fdba74' }}>Innovation</span>
        </h1>
        <p className="text-white/70 text-lg mb-10">
          Students, parents, faculty &amp; management — hours, fees and progress, all in one place.
        </p>
        <div className="space-y-3">
          <div className="pill !bg-white/10 px-5 py-3.5 text-sm text-white/90">
            <b className="text-white">Prepaid hours</b> tracked live — purchased, consumed &amp; remaining.
          </div>
          <div className="pill !bg-white/10 px-5 py-3.5 text-sm text-white/90 ml-6">
            <b className="text-white">Smart ledger</b> flags pending fees automatically.
          </div>
        </div>
      </div>
    </div>
  );
});
