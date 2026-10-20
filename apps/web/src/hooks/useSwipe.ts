import { useRef, type TouchEvent } from 'react';

/** How far (px) a finger must travel sideways, or how fast (px/ms), to count as a swipe. */
const SWIPE_PX = 70;
const SWIPE_SPEED = 0.5;

/**
 * Sideways swipes on an element, to step between tabs. The element follows the finger while it
 * moves (held back at either end, where there is no tab to go to), then either hands over to the
 * next tab or springs back. Vertical scrolling stays the browser's.
 */
export function useSwipe(onSwipe: (step: 1 | -1) => void, can: (step: 1 | -1) => boolean) {
  const el = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number; dir: 'h' | 'v' | null } | null>(null);
  const dx = useRef(0);

  const move = (x: number, animate: boolean) => {
    const node = el.current;
    if (!node) return;
    node.style.transition = animate ? 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    node.style.transform = x ? `translateX(${x}px)` : '';
  };

  return {
    ref: el,
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: performance.now(), dir: null };
      dx.current = 0;
    },
    onTouchMove: (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      const x = t.clientX - s.x;
      const y = t.clientY - s.y;
      // Decide once, from the first few pixels, whether this is a sideways swipe or a scroll.
      if (!s.dir && Math.hypot(x, y) > 10) s.dir = Math.abs(x) > Math.abs(y) * 1.2 ? 'h' : 'v';
      if (s.dir !== 'h') return;
      dx.current = x;
      const step = x < 0 ? 1 : -1;
      move(can(step) ? x : x * 0.25, false);
    },
    onTouchEnd: () => {
      const s = start.current;
      start.current = null;
      if (!s || s.dir !== 'h') return;
      const x = dx.current;
      const step = x < 0 ? 1 : -1;
      const fast = Math.abs(x) / Math.max(1, performance.now() - s.t) > SWIPE_SPEED;
      move(0, true);
      if ((Math.abs(x) > SWIPE_PX || (fast && Math.abs(x) > 30)) && can(step)) {
        // The next tab slides in on its own; drop the drag offset without animating it back.
        if (el.current) el.current.style.transition = 'none';
        onSwipe(step);
      }
    },
  };
}
