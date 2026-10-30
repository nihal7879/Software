import { memo } from 'react';

/**
 * The sign-in background as an answer sheet: ruled lines, a red margin rule,
 * the mark watermarked in the corner.
 *
 * The lightest of the backdrops and the only one that matches the rest of the
 * app, which is cream and white on every screen behind this one. It says what
 * the business is — school — without a photograph or a metaphor.
 *
 * All of it is CSS: the ruling is a repeating gradient, so it costs nothing,
 * needs no canvas and no image beyond the mark itself.
 */
export const BrandPaper = memo(function BrandPaper() {
  return (
    <>
      {/* The margin rule, where a teacher's marks would go. Kept well left of
          the card so the form never sits on top of it. */}
      <div
        className="absolute inset-y-0 pointer-events-none hidden sm:block"
        style={{ left: 'max(2.5rem, 9%)', width: '1.5px', background: 'rgba(200, 66, 56, 0.22)' }}
      />
      <div
        className="absolute inset-y-0 pointer-events-none hidden lg:block"
        style={{ right: 'max(2.5rem, 9%)', width: '1.5px', background: 'rgba(200, 66, 56, 0.12)' }}
      />

      {/* Watermarked, the way a school crest is printed on a paper — large,
          cornered, and almost not there. */}
      <img
        src="/stemvision-mark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute pointer-events-none select-none hidden sm:block"
        style={{
          right: '-4rem',
          bottom: '-5rem',
          width: 'min(34rem, 46vw)',
          opacity: 0.06,
        }}
      />

      {/* A soft lift under the card, so it sits on the page rather than in it. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(38% 44% at 50% 52%, rgba(255,255,255,0.85) 0%, transparent 70%)' }}
      />
    </>
  );
});
