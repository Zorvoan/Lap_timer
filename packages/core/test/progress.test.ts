import { describe, expect, it } from 'vitest';
import { ProgressTracker } from '../src/progress';
import { TrackModel } from '../src/track';
import { mulberry32, gaussian } from '../src/sim';
import { hairpinPoints, ovalPoints, toCoords } from './fixtures';

describe('ProgressTracker', () => {
  it('stays on the correct one of two close parallel sections', () => {
    const track = TrackModel.fromCoordinates(toCoords(hairpinPoints()), true);
    const tracker = new ProgressTracker(track);
    // Drive east along the lower straight (y = 0). Fixes are biased 7 m north: closer to the
    // upper straight (y = 12) than to the one actually being driven.
    let t = 0;
    let last = 0;
    for (let x = 20; x <= 480; x += 10) {
      const p = { x: track.pts[0].x + x, y: track.pts[0].y + (x === 20 ? 0 : 7) };
      const r = tracker.update(p, (t += 500), 20, 4, { x: 1, y: 0 });
      expect(r.along).toBeLessThan(500); // never jumps to the return straight (along > 512)
      expect(r.unwrapped).toBeGreaterThanOrEqual(last);
      last = r.unwrapped;
    }
    expect(last).toBeCloseTo(480, -1);
  });

  it('a globally nearest projection would have picked the wrong section', () => {
    const track = TrackModel.fromCoordinates(toCoords(hairpinPoints()), true);
    const p = { x: track.pts[0].x + 200, y: track.pts[0].y + 7 };
    expect(track.nearest(p).along).toBeGreaterThan(500);
  });

  it('uses direction of travel to acquire the right section', () => {
    const track = TrackModel.fromCoordinates(toCoords(hairpinPoints()), true);
    const tracker = new ProgressTracker(track);
    const p = { x: track.pts[0].x + 200, y: track.pts[0].y + 6.5 };
    const r = tracker.update(p, 0, 20, 4, { x: -1, y: 0 }); // heading west → upper straight
    expect(r.along).toBeGreaterThan(500);
    const r2 = new ProgressTracker(track).update(p, 0, 20, 4, { x: 1, y: 0 });
    expect(r2.along).toBeLessThan(500);
  });

  it('keeps progress monotonic under backward jitter', () => {
    const track = TrackModel.fromCoordinates(toCoords(ovalPoints()), true);
    const tracker = new ProgressTracker(track);
    const rng = mulberry32(7);
    let last = -Infinity;
    for (let i = 0; i < 100; i++) {
      // Nearly stationary vehicle with noisy fixes.
      const base = track.pointAt(100 + i * 0.2);
      const p = { x: base.x + gaussian(rng) * 3, y: base.y + gaussian(rng) * 3 };
      const r = tracker.update(p, i * 1000, 0.2, 5);
      expect(r.unwrapped).toBeGreaterThanOrEqual(last);
      last = r.unwrapped;
    }
    expect(last).toBeLessThan(140);
  });

  it('wraps around the start of a closed circuit without losing distance', () => {
    const track = TrackModel.fromCoordinates(toCoords(ovalPoints()), true);
    const tracker = new ProgressTracker(track);
    const L = track.length;
    const start = L - 200;
    let t = 0;
    let r = tracker.update(track.pointAt(start), t, 30, 3);
    for (let d = start + 15; d <= start + 400; d += 15) {
      r = tracker.update(track.pointAt(d), (t += 500), 30, 3);
      expect(r.confidence).toBe('good');
    }
    expect(r.unwrapped - start).toBeCloseTo(390, 0);
    expect(r.along).toBeCloseTo(track.wrap(start + 390), 0);
  });

  it('declares positions far from the track lost and re-acquires afterwards', () => {
    const track = TrackModel.fromCoordinates(toCoords(ovalPoints()), true);
    const tracker = new ProgressTracker(track);
    tracker.update(track.pointAt(10), 0, 20, 3);
    const off = track.pointAt(30);
    expect(tracker.update({ x: off.x, y: off.y - 200 }, 1000, 20, 3).confidence).toBe('lost');
    const back = tracker.update(track.pointAt(200), 10_000, 20, 3);
    expect(back.acquired).toBe(true);
    expect(back.unwrapped).toBeCloseTo(200, 0);
  });
});
