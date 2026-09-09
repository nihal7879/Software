import { RefObject, useEffect, useLayoutEffect, useState } from 'react';

// Anchors a fixed-position popover to a trigger button so it escapes overflow
// containers (tables/drawers), flips upward when low on space, and follows the
// trigger while the page/table scrolls.
export function useAnchoredMenu(
  open: boolean,
  btnRef: RefObject<HTMLElement>,
  menuW: number,
  align: 'left' | 'right'
) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });

  const reposition = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    let left = align === 'right' ? r.right - menuW : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const MENU_MAX = 360;
    if (spaceBelow < MENU_MAX && r.top > spaceBelow) setPos({ left, bottom: window.innerHeight - r.top + 4 });
    else setPos({ left, top: r.bottom + 4 });
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
