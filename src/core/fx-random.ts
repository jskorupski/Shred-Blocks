/**
 * Seedable visual-FX randomness (`VISUAL-GOLDEN-01`). Gameplay never uses this; only cosmetic particle bursts do.
 * By default it delegates to `Math.random`; `setFxRandomSeed(n)` switches to a deterministic Mulberry32 stream so
 * golden screenshot tests can capture identical mid-burst frames run after run.
 */
let seededState: number | null = null;

export function setFxRandomSeed(seed: number | null): void {
  seededState = seed === null ? null : seed >>> 0 || 1;
}

export function fxRandom(): number {
  if (seededState === null) return Math.random();
  seededState = (seededState + 0x6d2b79f5) >>> 0;
  let t = seededState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
