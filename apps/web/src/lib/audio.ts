import { formatDelta, formatLapTime } from '@laptimer/core';

let ctx: AudioContext | null = null;

/** Must be called from a user gesture (e.g. the Start button) so browsers allow playback. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, startS: number, durS: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + startS);
  gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + startS + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startS + durS);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + startS);
  osc.stop(ctx.currentTime + startS + durS + 0.05);
}

export function beepLap(improved: boolean): void {
  tone(880, 0, 0.12);
  tone(improved ? 1320 : 660, 0.15, 0.18);
}

export function beepStart(): void {
  tone(988, 0, 0.1);
}

export function announceLap(lap: number, timeMs: number, deltaMs: number | null): void {
  if (typeof speechSynthesis === 'undefined') return;
  const time = formatLapTime(timeMs).replace(/^00:/, '');
  let delta = '';
  if (deltaMs !== null) {
    const d = formatDelta(deltaMs, 2);
    delta = `, ${d.startsWith('-') ? 'minus' : 'plus'} ${d.slice(1)}`;
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(`Lap ${lap}, ${time}${delta}`));
}

export function announceSector(sector: number, refDeltaMs: number | null): void {
  if (typeof speechSynthesis === 'undefined' || refDeltaMs === null) return;
  const d = formatDelta(refDeltaMs, 1);
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(`Sector ${sector}, ${d.startsWith('-') ? 'minus' : 'plus'} ${d.slice(1)}`));
}
