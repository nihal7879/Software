/**
 * The institute's own wordmark, in place of the graduation-cap-and-text stand-in
 * the app was built with.
 *
 * Two files, not one. The artwork's tagline is near-black, so on a dark panel it
 * disappears; the dark copy lifts only those colourless dark pixels to a light
 * warm grey and leaves the orange, the blue and the brain exactly as the
 * designer drew them. Which one shows is decided by the `.dark` class on <html>
 * — both are in the markup and CSS hides one, so there is no flash of the wrong
 * logo while a script works out the theme.
 *
 * `height` is what the caller sets; the width follows the artwork's own 5:1
 * proportions. Sizing by height is what keeps it in line with the text and
 * icons beside it, whatever the logo's aspect ratio turns out to be.
 */
export function Logo({
  height = 32,
  className = '',
  /** On a photo or a coloured panel, where even the dark copy needs lifting. */
  onDark = false,
}: {
  height?: number;
  className?: string;
  onDark?: boolean;
}) {
  const common = 'w-auto select-none';
  const style = { height };

  if (onDark) {
    return (
      <img
        src="/stemvision-logo-dark.png"
        alt="STEM Vision"
        style={style}
        className={`${common} ${className}`}
        draggable={false}
      />
    );
  }

  return (
    <>
      <img
        src="/stemvision-logo.png"
        alt="STEM Vision"
        style={style}
        className={`${common} dark:hidden ${className}`}
        draggable={false}
      />
      <img
        src="/stemvision-logo-dark.png"
        alt=""
        aria-hidden="true"
        style={style}
        className={`${common} hidden dark:block ${className}`}
        draggable={false}
      />
    </>
  );
}
