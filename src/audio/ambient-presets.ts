export type MusicScene = 'MENU' | 'CHALLENGE' | 'ZEN' | 'TIMED';

export type AmbientPresetId =
  | 'starlight_kids'
  | 'horizon_awake'
  | 'hawkins_stargazer'
  | 'coastal_dive'
  | 'amber_cassette';

export interface AmbientChord {
  readonly bass: number;
  readonly pad: readonly [number, number, number, number];
  readonly leadA: number | null;
  readonly leadB: number | null;
}

export interface JunoPadOpts {
  readonly durScale: number;
  readonly attack: number;
  readonly cutStart: number;
  readonly cutPeak?: number;
  readonly cutEnd?: number;
  readonly amp: number;
  readonly wetAmt: number;
}

export interface MoogBassOpts {
  readonly stepMod: number;
  readonly durScale?: number;
  readonly fixedDur?: number;
  readonly attack: number;
  readonly cutoff: number;
  readonly amp: number;
  readonly ampOff: number;
  readonly sawAmt: number;
}

export interface AnalogArpConfig {
  readonly attack: number;
  readonly decay: number;
  readonly cutBase: number;
  readonly cutLfoAmp: number;
  readonly cutLfoRate: number;
  readonly cutLfoFn: 'sin' | 'cos';
  readonly cutLo: number;
  readonly q: number;
  readonly amp: number;
  readonly sawMix: number;
  readonly wetAmt: number;
}

export interface LeadSighConfig {
  readonly stepA: number;
  readonly durA: number;
  readonly ampA: number;
  readonly stepB?: number;
  readonly durB?: number;
  readonly ampB?: number;
}

export interface AmbientPreset {
  readonly id: AmbientPresetId;
  readonly name: string;
  readonly stepSec: number;
  readonly arpPattern: ReadonlyArray<number>;
  readonly arp: readonly [number, number, number, number, number];
  readonly chords: ReadonlyArray<AmbientChord>;
  readonly pad: JunoPadOpts;
  readonly innerPadStep8: JunoPadOpts | null;
  readonly bass: MoogBassOpts;
  readonly arpVoice: 'pluck' | AnalogArpConfig;
  readonly lead: LeadSighConfig | null;
}

/** Smoothly crossfade to the next analog palette in the active mode pool every 32 bars. */
export const AMBIENT_ROTATION_BARS = 32;

export const SCENE_ROTATION_POOLS: Record<MusicScene, ReadonlyArray<AmbientPresetId>> = {
  MENU: ['horizon_awake', 'amber_cassette', 'coastal_dive'],
  CHALLENGE: ['starlight_kids', 'horizon_awake', 'amber_cassette'],
  ZEN: ['coastal_dive', 'amber_cassette', 'horizon_awake'],
  TIMED: ['hawkins_stargazer', 'starlight_kids', 'horizon_awake'],
};

/**
 * Five drumless Warm Analog Synthwave palettes inspired by Stranger Things ("Kids") and Tycho.
 * Every harmonic stack enforces pure 5-note pentatonic pitch sets (0 semitones, 0 tritones)
 * and >= 26ms soft lowpass envelopes so fast gameplay SFX transients stay unobscured.
 */
export const AMBIENT_PRESETS: ReadonlyArray<AmbientPreset> = [
  {
    id: 'starlight_kids',
    name: "Paper Lanterns '84",
    stepSec: 0.182,
    arpPattern: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
    arp: [220.0, 246.94, 277.18, 329.63, 369.99],
    chords: [
      { bass: 110.0, pad: [164.81, 220.0, 277.18, 329.63], leadA: 440.0, leadB: 493.88 },
      { bass: 92.5, pad: [185.0, 220.0, 277.18, 369.99], leadA: 554.37, leadB: 440.0 },
      { bass: 69.3, pad: [138.59, 220.0, 246.94, 329.63], leadA: 493.88, leadB: 369.99 },
      { bass: 82.41, pad: [164.81, 246.94, 277.18, 369.99], leadA: 440.0, leadB: null },
    ],
    pad: { durScale: 1.25, attack: 0.65, cutStart: 480, amp: 0.044, wetAmt: 0.52 },
    innerPadStep8: null,
    bass: { stepMod: 16, durScale: 1.15, attack: 0.06, cutoff: 185, amp: 0.165, ampOff: 0.165, sawAmt: 0.35 },
    arpVoice: {
      attack: 0.028,
      decay: 0.56,
      cutBase: 580,
      cutLfoAmp: 185,
      cutLfoRate: 0.09,
      cutLfoFn: 'sin',
      cutLo: 270,
      q: 1.15,
      amp: 0.072,
      sawMix: 0.42,
      wetAmt: 0.55,
    },
    lead: { stepA: 0, durA: 0.56, ampA: 0.046, stepB: 8, durB: 0.54, ampB: 0.042 },
  },
  {
    id: 'horizon_awake',
    name: 'Horizon Awake',
    stepSec: 0.21,
    arpPattern: [0, 2, 3, -1, 1, 3, 4, 2, 0, -1, 3, 1, 2, 4, -1, 1],
    arp: [329.63, 369.99, 415.3, 493.88, 554.37],
    chords: [
      { bass: 69.3, pad: [138.59, 207.65, 277.18, 329.63], leadA: null, leadB: null },
      { bass: 82.41, pad: [164.81, 246.94, 329.63, 369.99], leadA: null, leadB: null },
      { bass: 61.74, pad: [123.47, 185.0, 246.94, 369.99], leadA: null, leadB: null },
      { bass: 92.5, pad: [185.0, 246.94, 329.63, 415.3], leadA: null, leadB: null },
    ],
    pad: { durScale: 1.38, attack: 0.72, cutStart: 520, amp: 0.06, wetAmt: 0.62 },
    innerPadStep8: { durScale: 0.75, attack: 0.55, cutStart: 480, amp: 0.042, wetAmt: 0.55 },
    bass: { stepMod: 16, durScale: 0.9, attack: 0.38, cutoff: 180, amp: 0.14, ampOff: 0.14, sawAmt: 0.0 },
    arpVoice: {
      attack: 0.036,
      decay: 0.88,
      cutBase: 640,
      cutLfoAmp: 0,
      cutLfoRate: 0,
      cutLfoFn: 'sin',
      cutLo: 340,
      q: 0.7,
      amp: 0.068,
      sawMix: 0.28,
      wetAmt: 0.7,
    },
    lead: null,
  },
  {
    id: 'hawkins_stargazer',
    name: "Stargazer '83",
    stepSec: 0.176,
    arpPattern: [0, 2, 3, 4, 3, 2, 1, 2, 0, 2, 3, 4, 3, 2, 1, 0],
    arp: [261.63, 293.66, 349.23, 392.0, 440.0],
    chords: [
      { bass: 87.31, pad: [174.61, 261.63, 293.66, 349.23], leadA: null, leadB: null },
      { bass: 73.42, pad: [146.83, 220.0, 261.63, 349.23], leadA: null, leadB: null },
      { bass: 98.0, pad: [196.0, 261.63, 293.66, 392.0], leadA: null, leadB: null },
      { bass: 65.41, pad: [130.81, 196.0, 261.63, 392.0], leadA: null, leadB: null },
    ],
    pad: { durScale: 1.28, attack: 0.65, cutStart: 500, amp: 0.048, wetAmt: 0.55 },
    innerPadStep8: null,
    bass: {
      stepMod: 2,
      fixedDur: 0.176 * 2.2,
      attack: 0.036,
      cutoff: 220,
      amp: 0.145,
      ampOff: 0.105,
      sawAmt: 0.28,
    },
    arpVoice: {
      attack: 0.026,
      decay: 0.48,
      cutBase: 600,
      cutLfoAmp: 140,
      cutLfoRate: 0.08,
      cutLfoFn: 'cos',
      cutLo: 280,
      q: 1.0,
      amp: 0.066,
      sawMix: 0.38,
      wetAmt: 0.55,
    },
    lead: null,
  },
  {
    id: 'coastal_dive',
    name: 'Coastal Dive',
    stepSec: 0.245,
    arpPattern: [0, -1, 2, -1, 4, -1, 3, 1, -1, -1, 2, -1, 3, -1, -1, -1],
    arp: [311.13, 349.23, 415.3, 466.16, 523.25],
    chords: [
      { bass: 103.83, pad: [155.56, 207.65, 233.08, 311.13], leadA: null, leadB: null },
      { bass: 87.31, pad: [174.61, 207.65, 261.63, 311.13], leadA: null, leadB: null },
      { bass: 77.78, pad: [155.56, 233.08, 261.63, 349.23], leadA: null, leadB: null },
      { bass: 116.54, pad: [174.61, 233.08, 261.63, 349.23], leadA: null, leadB: null },
    ],
    pad: { durScale: 1.45, attack: 1.2, cutStart: 470, amp: 0.062, wetAmt: 0.72 },
    innerPadStep8: null,
    bass: { stepMod: 16, durScale: 1.05, attack: 0.55, cutoff: 170, amp: 0.125, ampOff: 0.125, sawAmt: 0.0 },
    arpVoice: 'pluck',
    lead: null,
  },
  {
    id: 'amber_cassette',
    name: 'Amber Cassette',
    stepSec: 0.215,
    arpPattern: [0, 1, 2, 4, 3, 2, 1, -1, 0, 1, 3, 4, 3, 1, 2, -1],
    arp: [261.63, 293.66, 349.23, 392.0, 466.16],
    chords: [
      { bass: 116.54, pad: [174.61, 233.08, 261.63, 349.23], leadA: 587.33, leadB: null },
      { bass: 98.0, pad: [196.0, 233.08, 293.66, 349.23], leadA: 466.16, leadB: null },
      { bass: 73.42, pad: [146.83, 233.08, 261.63, 349.23], leadA: 523.25, leadB: null },
      { bass: 87.31, pad: [174.61, 261.63, 293.66, 392.0], leadA: 466.16, leadB: null },
    ],
    pad: { durScale: 1.38, attack: 1.1, cutStart: 340, cutPeak: 640, cutEnd: 410, amp: 0.056, wetAmt: 0.68 },
    innerPadStep8: null,
    bass: { stepMod: 16, durScale: 1.18, attack: 0.14, cutoff: 195, amp: 0.145, ampOff: 0.145, sawAmt: 0.24 },
    arpVoice: {
      attack: 0.032,
      decay: 0.78,
      cutBase: 580,
      cutLfoAmp: 0,
      cutLfoRate: 0,
      cutLfoFn: 'sin',
      cutLo: 290,
      q: 0.8,
      amp: 0.064,
      sawMix: 0.26,
      wetAmt: 0.68,
    },
    lead: { stepA: 4, durA: 0.72, ampA: 0.052 },
  },
];
