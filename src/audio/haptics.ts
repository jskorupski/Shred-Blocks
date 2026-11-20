export const HAPTIC_MIN_PULSE_MS = 10;
export const HAPTIC_MAX_PULSE_MS = 100;

export type HapticCueId =
  | 'pickup'
  | 'slideTick'
  | 'wallClack'
  | 'snap'
  | 'shred'
  | 'shredFinalClear'
  | 'particlePreview'
  | 'layerPeel'
  | 'iceCrack'
  | 'lockOpen'
  | 'booster'
  | 'winFanfare'
  | 'underParOracle'
  | 'lossBuzzer'
  | 'buttonTap'
  | 'relicAwaken';

export interface HapticCueSpec {
  readonly pattern: number | number[];
  readonly subBassFreq: number;
}

/**
 * Canonical tactile patterns (`HAPTICS-01`) calibrated so every active pulse is
 * `>= 10ms` (clearing Android LRA motor rise-time inertia) while remaining concise
 * and crisp (`<= 100ms` single segment). Pre-allocated arrays avoid GC pressure on drags.
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticCueId, HapticCueSpec>> = {
  slideTick: { pattern: 10, subBassFreq: 75 },
  buttonTap: { pattern: 12, subBassFreq: 72 },
  snap: { pattern: 12, subBassFreq: 65 },
  particlePreview: { pattern: 12, subBassFreq: 65 },
  pickup: { pattern: 14, subBassFreq: 68 },
  iceCrack: { pattern: 15, subBassFreq: 80 },
  layerPeel: { pattern: [12, 16, 14], subBassFreq: 74 },
  wallClack: { pattern: [14, 22, 12], subBassFreq: 52 },
  lockOpen: { pattern: [14, 22, 16], subBassFreq: 66 },
  shred: { pattern: [14, 18, 14], subBassFreq: 70 },
  shredFinalClear: { pattern: [16, 18, 16, 20, 24], subBassFreq: 90 },
  booster: { pattern: [16, 24, 18], subBassFreq: 58 },
  relicAwaken: { pattern: [26, 28, 18, 34, 16], subBassFreq: 55 },
  underParOracle: { pattern: [16, 24, 16, 24, 32], subBassFreq: 74 },
  lossBuzzer: { pattern: [20, 40, 25], subBassFreq: 50 },
  winFanfare: { pattern: [18, 30, 18, 30, 28, 40, 35], subBassFreq: 64 },
};

export interface DispatchHapticParams {
  hapticsEnabled: boolean;
  backgrounded: boolean;
  sfxEnabled: boolean;
  pattern: number | number[];
  subBassFreq: number;
  getRunningSfx: () => { ctx: AudioContext; sfxGain: GainNode } | null;
}

/**
 * Triggers Android hardware vibration (`navigator.vibrate`) or falls back to a
 * short Web Audio sub-bass speaker-enclosure transient on platforms without Vibration API
 * (such as iOS Safari / Chrome for iOS) when SFX are enabled.
 */
export function dispatchHapticFeedback(params: DispatchHapticParams): boolean {
  if (!params.hapticsEnabled || params.backgrounded) return false;

  let vibrated = false;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      vibrated = Boolean(navigator.vibrate(params.pattern));
    } catch {
      vibrated = false;
    }
  }

  // WebKit / iOS fallback when `navigator.vibrate` is unavailable or suppressed and SFX is active:
  if (!vibrated && params.sfxEnabled) {
    const running = params.getRunningSfx();
    if (!running) return false;
    const { ctx, sfxGain } = running;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(params.subBassFreq, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.028);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  return vibrated;
}
