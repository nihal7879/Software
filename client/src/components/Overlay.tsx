import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Full-screen backdrop for drawers and modals, rendered through a portal on
// document.body rather than inline in the page.
//
// `position: fixed` is only relative to the viewport while no ancestor creates
// a containing block. Any ancestor with transform, filter, backdrop-filter,
// perspective, contain or will-change silently changes that, and the backdrop
// then covers only part of the screen — it renders as a grey block over some
// of the page instead of dimming all of it. The same ancestors create stacking
// contexts, which can trap z-50 underneath sticky headers and sidebars.
//
// Portalling to document.body removes the whole class of problem: there are no
// ancestors left to interfere, today or when someone adds a transition later.
export function Overlay({
  onClose,
  children,
  align = 'end',
  z = 'z-50',
}: {
  onClose: () => void;
  children: ReactNode;
  /**
   * 'end' slides a drawer in from the right, 'center' centres a modal, and
   * 'top' centres horizontally but pins to the top and scrolls — for modals
   * taller than the viewport, which would otherwise have their footer and
   * buttons cut off with no way to reach them.
   */
  align?: 'end' | 'center' | 'top';
  z?: string;
}) {
  useEffect(() => {
    // Stop the page behind from scrolling while the overlay is up, and let
    // Escape dismiss it — both expected of a drawer, neither free inline.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className={`fixed inset-0 bg-black/40 flex ${z} ${
        align === 'center' ? 'items-center justify-center p-4'
          : align === 'top' ? 'items-start justify-center overflow-y-auto p-4'
          : 'justify-end'
      }`}
      onClick={onClose}
    >
      {children}
    </div>,
    document.body
  );
}
