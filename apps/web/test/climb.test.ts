import { describe, expect, it } from 'vitest';
import { climbText } from '../src/lib/climb';

const profile = (f: (d: number) => number, lengthM = 2000, step = 25) => Array.from({ length: Math.round(lengthM / step) + 1 }, (_, i) => ({ d: i * step, elevation: f(i * step) }));

describe('climbText', () => {
  it('names a steady climb and descent by their net height', () => {
    expect(climbText(profile((d) => 200 + d * 0.065))).toBe('+130 m climb');
    expect(climbText(profile((d) => 330 - d * 0.065))).toBe('130 m descent');
  });

  it('calls terrain-model jitter flat', () => {
    // ±6 m noise every sample on a level road
    expect(climbText(profile((d) => 190 + (Math.round(d / 25) % 2 ? 6 : -6), 7000, 75))).toBe('Flat');
  });

  it('gives up and down for a road over a hill', () => {
    expect(climbText(profile((d) => 300 + 80 * Math.sin((d / 3000) * Math.PI), 3000, 30))).toBe('75 m up, 75 m down');
  });

  it('has nothing to say without a profile', () => {
    expect(climbText(null)).toBeNull();
    expect(climbText([{ d: 0, elevation: 100 }])).toBeNull();
  });
});
