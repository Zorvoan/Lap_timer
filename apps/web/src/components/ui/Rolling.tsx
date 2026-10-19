/**
 * Text whose digits roll like an odometer when they change, in the style of Bklit UI's number
 * flow: every digit is a column 0–9 that slides to its new value, the rest of the text stays put.
 * Digits line up from the right, so "9.9" → "10.0" rolls the right columns.
 */
import { useEffect, useRef, useState } from 'react';
import { useSeen } from '../../hooks/useSeen';

/** 9 above the 0 and 0 below the 9, so the spring's overshoot never shows an empty cell. */
const COLUMN = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

function Digit({ value }: { value: number }) {
  return (
    <span className="relative inline-block">
      {/* Sizes the cell and gives it the text's baseline; the column rolls over it. */}
      <span className="invisible">0</span>
      <span className="absolute inset-0 overflow-hidden">
        <span className="roll-col absolute inset-x-0 top-0 h-full" style={{ transform: `translateY(${-(value + 1) * 100}%)` }}>
          {COLUMN.map((d, i) => (
            <span key={i} className="block h-full text-center">
              {d}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * `from` rolls the digits up from zero when the text first comes into view (a result being
 * revealed), after `delay` ms; otherwise only later changes roll.
 */
export function Rolling({ text, from = false, delay = 0, className }: { text: string; from?: boolean; delay?: number; className?: string }) {
  // Starts at zeros when asked to; the columns then roll up once the first frame is on screen.
  const [primed, setPrimed] = useState(!from);
  const el = useRef<HTMLSpanElement>(null);
  const seen = useSeen(el, 0.6);
  useEffect(() => {
    if (primed || !seen) return;
    let raf = 0;
    const timer = setTimeout(() => (raf = requestAnimationFrame(() => setPrimed(true))), delay);
    return () => (clearTimeout(timer), cancelAnimationFrame(raf));
  }, [primed, delay, seen]);
  const shown = primed ? text : text.replace(/\d/g, '0');
  const chars = [...shown];
  return (
    <span ref={el} className={className} aria-label={text} role="text">
      <span aria-hidden="true" className="whitespace-nowrap">
        {chars.map((c, i) => {
          // Keyed by position from the right, so a digit keeps its column as the text grows.
          const k = chars.length - i;
          return /\d/.test(c) ? <Digit key={k} value={Number(c)} /> : <span key={`${k}${c}`}>{c}</span>;
        })}
      </span>
    </span>
  );
}
