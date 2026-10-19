import { useEffect, useState, type RefObject } from 'react';

/**
 * True once the element has been scrolled into view (a quarter of it on screen), and from then on.
 * Entrance animations wait for it, so a chart further down plays when the user gets to it.
 */
export function useSeen(ref: RefObject<Element>, threshold = 0.25): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  });
  return seen;
}
