import { RefObject, useEffect, useLayoutEffect, useState } from 'react';

// Anchors a fixed-position popover to a trigger button so it escapes overflow
// containers (tables/drawers) and follows the trigger while the page scrolls.
//
// It opens DOWNWARD wherever it reasonably can, shrinking to the room available
// rather than flipping up over the field it belongs to — a menu that jumps above
// the box covers the ones you just filled in. It only flips when there is truly
// no room below and plainly more above, and it reports the height it may use.
export function useAnchoredMenu(
  open: boolean,
  btnRef: RefObject<HTMLElement>,
  menuW: number,
  align: 'left' | 'right'
) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 0 });

  const reposition = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    let left = align === 'right' ? r.right - menuW : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    // Enough to show a few rows and scroll for the rest.
    const ENOUGH = 180;
    const MENU_MAX = 360;
    if (spaceBelow < ENOUGH && spaceAbove > spaceBelow) {
      setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(MENU_MAX, spaceAbove) });
    } else {
      setPos({ left, top: r.bottom + 4, maxHeight: Math.min(MENU_MAX, spaceBelow) });
    }
  };

  useLayoutEffect(() => { if (open) reposition(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open]);

  return pos;
}
