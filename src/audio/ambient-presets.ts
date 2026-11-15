import type { PlayMode } from '../core/types';

export type MusicScene = 'MENU' | PlayMode;

export type AmbientPresetId = 'astrolabe' | 'rainstone' | 'carved_stone' | 'starlight' | 'velvet_horizon';

export type DrumToken = 'K' | 'k' | 'S' | 'R' | 'r' | 'H' | 'h' | 'O' | '.';

export interface AmbientChord {
  readonly root: number;
  readonly pad: ReadonlyArray<number>;
  readonly motif: ReadonlyArray<number>;
}

export interface AmbientPreset {
  readonly id: AmbientPresetId;
  readonly name: string;
  readonly stepSec: number;
  readonly swingSec: number;
  readonly warmthHz: number;
  readonly wetMix: number;
  readonly padWave: OscillatorType;
  readonly padCutoff: number;
  readonly padAmp: number;
  readonly arpWave: OscillatorType;
  readonly arpAmp: number;
  readonly arpAttack: number;
  readonly arpReleaseMul: number;
  readonly noteLpHz: number;
  readonly pattern: ReadonlyArray<number>;
  readonly drumPattern: ReadonlyArray<DrumToken>;
  readonly rubatoChance: number;
  readonly chords: ReadonlyArray<AmbientChord>;
}

/** Rotate after 32 bars (~8 full 4-chord cycles, ~85–106s) on a clean bar downbeat. */
export const AMBIENT_ROTATION_BARS = 32;

export const SCENE_ROTATION_POOLS: Record<MusicScene, ReadonlyArray<AmbientPresetId>> = {
  MENU: ['astrolabe', 'velvet_horizon', 'rainstone'],
  CHALLENGE: ['carved_stone', 'velvet_horizon', 'astrolabe'],
  ZEN: ['rainstone', 'astrolabe', 'velvet_horizon'],
  TIMED: ['starlight', 'carved_stone', 'velvet_horizon'],
};

/**
 * 5 pure-pentatonic lo-fi chill flow palettes (`0` semitones, `0` tritones across all 4 bars).
 */
export const AMBIENT_PRESETS: ReadonlyArray<AmbientPreset> = [
  {
    id: 'astrolabe',
    name: 'Twilight Astrolabe',
    stepSec: 0.192,
    swingSec: 0.012,
    warmthHz: 1240,
    wetMix: 0.44,
    padWave: 'triangle',
    padCutoff: 780,
    padAmp: 0.22,
    arpWave: 'sine',
    arpAmp: 0.056,
    arpAttack: 0.075,
    arpReleaseMul: 4.4,
    noteLpHz: 880,
    pattern: [0, -1, 2, -1, 3, -1, 1, -1, 4, -1, 3, -1, 2, -1, 1, -1],
    drumPattern: ['K', '.', 'h', '.', 'R', '.', 'h', 'k', '.', '.', 'K', 'h', 'R', '.', 'H', '.'],
    rubatoChance: 0.94,
    chords: [
      { root: 87.31, pad: [130.81, 220.0, 293.66, 392.0], motif: [261.63, 293.66, 349.23, 392.0, 440.0] },
      { root: 73.42, pad: [146.83, 220.0, 261.63, 349.23], motif: [261.63, 293.66, 349.23, 392.0, 440.0] },
      { root: 98.0, pad: [146.83, 196.0, 261.63, 349.23], motif: [261.63, 293.66, 349.23, 392.0, 440.0] },
      { root: 65.41, pad: [130.81, 196.0, 293.66, 392.0], motif: [261.63, 293.66, 349.23, 392.0, 440.0] },
    ],
  },
  {
    id: 'rainstone',
    name: 'Rainstone & Bamboo',
    stepSec: 0.208,
    swingSec: 0.01,
    warmthHz: 1160,
    wetMix: 0.48,
    padWave: 'sine',
    padCutoff: 740,
    padAmp: 0.23,
    arpWave: 'sine',
    arpAmp: 0.054,
    arpAttack: 0.09,
    arpReleaseMul: 4.8,
    noteLpHz: 820,
    pattern: [0, -1, 2, -1, -1, -1, 3, -1, 1, -1, 4, -1, 2, -1, -1, -1],
    drumPattern: ['K', '.', 'h', '.', 'R', '.', 'h', '.', 'k', '.', 'K', '.', 'R', '.', 'h', '.'],
    rubatoChance: 0.9,
    chords: [
      { root: 73.42, pad: [146.83, 220.0, 293.66, 369.99], motif: [246.94, 293.66, 329.63, 369.99, 440.0] },
      { root: 123.47, pad: [185.0, 246.94, 293.66, 440.0], motif: [246.94, 293.66, 329.63, 369.99, 440.0] },
      { root: 82.41, pad: [164.81, 246.94, 293.66, 369.99], motif: [246.94, 293.66, 329.63, 369.99, 440.0] },
      { root: 110.0, pad: [164.81, 220.0, 293.66, 369.99], motif: [246.94, 293.66, 329.63, 369.99, 440.0] },
    ],
  },
  {
    id: 'carved_stone',
    name: 'Carved Stone Focus',
    stepSec: 0.178,
    swingSec: 0.014,
    warmthHz: 1260,
    wetMix: 0.42,
    padWave: 'triangle',
    padCutoff: 780,
    padAmp: 0.22,
    arpWave: 'sine',
    arpAmp: 0.058,
    arpAttack: 0.065,
    arpReleaseMul: 4.2,
    noteLpHz: 900,
    pattern: [0, -1, 2, -1, 3, -1, 2, 4, -1, -1, 2, -1, 1, -1, 3, -1],
    drumPattern: ['K', '.', 'H', 'k', 'S', '.', 'H', '.', 'K', '.', 'K', 'h', 'S', '.', 'H', 'r'],
    rubatoChance: 0.96,
    chords: [
      { root: 110.0, pad: [164.81, 220.0, 261.63, 392.0], motif: [261.63, 293.66, 329.63, 392.0, 440.0] },
      { root: 65.41, pad: [130.81, 196.0, 261.63, 329.63], motif: [261.63, 293.66, 329.63, 392.0, 440.0] },
      { root: 73.42, pad: [146.83, 220.0, 261.63, 392.0], motif: [261.63, 293.66, 329.63, 392.0, 440.0] },
      { root: 82.41, pad: [164.81, 220.0, 293.66, 392.0], motif: [261.63, 293.66, 329.63, 392.0, 440.0] },
    ],
  },
  {
    id: 'starlight',
    name: 'Starlight Current',
    stepSec: 0.22,
    swingSec: 0.0,
    warmthHz: 1300,
    wetMix: 0.44,
    padWave: 'sine',
    padCutoff: 820,
    padAmp: 0.21,
    arpWave: 'sine',
    arpAmp: 0.054,
    arpAttack: 0.06,
    arpReleaseMul: 3.6,
    noteLpHz: 920,
    pattern: [0, 1, 2, 4, -1, 1, 0, 2, 3, 4, -1, 2],
    drumPattern: ['K', '.', 'h', 'S', '.', 'k', 'K', '.', 'h', 'S', '.', 'H'],
    rubatoChance: 0.96,
    chords: [
      { root: 77.78, pad: [155.56, 233.08, 311.13, 392.0], motif: [261.63, 311.13, 349.23, 392.0, 466.16] },
      { root: 65.41, pad: [130.81, 196.0, 261.63, 311.13], motif: [261.63, 311.13, 349.23, 392.0, 466.16] },
      { root: 87.31, pad: [174.61, 233.08, 311.13, 392.0], motif: [261.63, 311.13, 349.23, 392.0, 466.16] },
      { root: 116.54, pad: [174.61, 261.63, 349.23, 466.16], motif: [261.63, 311.13, 349.23, 392.0, 466.16] },
    ],
  },
  {
    id: 'velvet_horizon',
    name: 'Velvet Horizon',
    stepSec: 0.188,
    swingSec: 0.016,
    warmthHz: 1220,
    wetMix: 0.44,
    padWave: 'triangle',
    padCutoff: 760,
    padAmp: 0.22,
    arpWave: 'sine',
    arpAmp: 0.056,
    arpAttack: 0.07,
    arpReleaseMul: 4.5,
    noteLpHz: 860,
    pattern: [0, -1, 2, 3, -1, -1, 1, -1, 3, -1, 4, -1, 2, -1, 1, -1],
    drumPattern: ['K', '.', 'H', '.', 'S', '.', 'H', 'k', '.', 'K', '.', 'h', 'S', '.', 'O', '.'],
    rubatoChance: 0.94,
    chords: [
      { root: 98.0, pad: [146.83, 196.0, 246.94, 329.63], motif: [246.94, 293.66, 329.63, 392.0, 440.0] },
      { root: 82.41, pad: [164.81, 246.94, 293.66, 392.0], motif: [246.94, 293.66, 329.63, 392.0, 440.0] },
      { root: 110.0, pad: [164.81, 220.0, 293.66, 392.0], motif: [246.94, 293.66, 329.63, 392.0, 440.0] },
      { root: 73.42, pad: [146.83, 220.0, 329.63, 440.0], motif: [246.94, 293.66, 329.63, 392.0, 440.0] },
    ],
  },
];

const pinkNoiseCache = new WeakMap<AudioContext, AudioBuffer>();
let cachedTapeCurve: Float32Array<ArrayBuffer> | null = null;

/** Returns the cached `tanh(x * 1.5)` curve used to warm the lo-fi drum bus. */
export function getTapeCurve(): Float32Array<ArrayBuffer> {
  if (cachedTapeCurve) return cachedTapeCurve;
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(x * 1.5);
  }
  cachedTapeCurve = curve;
  return curve;
}

/** Pre-builds a 1-second deterministic pink-smoothed noise buffer for the lo-fi drum kit. */
export function prewarmAmbientMusicBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.round(sampleRate));
  const cached = pinkNoiseCache.get(ctx);
  if (cached && cached.sampleRate === sampleRate && cached.length === len) {
    return cached;
  }
  const buf = ctx.createBuffer(1, len, sampleRate);
  const data = buf.getChannelData(0);
  let seed = 0x51a7b3cd;
  let last = 0;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 0xffffffff) * 2 - 1;
    last = last * 0.75 + white * 0.25;
    data[i] = Math.max(-0.98, Math.min(0.98, last * 1.8));
  }
  pinkNoiseCache.set(ctx, buf);
  return buf;
}
