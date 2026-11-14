import type { ParticleStyleId } from '../core/types';
import { getSharedNoiseBuffer, playFilteredNoiseBurstVoice } from './synth-voices';

function playSweptNoiseVoice(
  ctx: AudioContext,
  sfxGain: GainNode,
  startTime: number,
  durationSec: number,
  startFreq: number,
  endFreq: number,
  qFactor: number,
  peakGain: number,
  filterType: BiquadFilterType = 'bandpass'
): void {
  const noise = ctx.createBufferSource();
  noise.buffer = getSharedNoiseBuffer(ctx, durationSec + 0.03);

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(Math.max(60, startFreq), startTime);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, endFreq), startTime + durationSec);
  filter.Q.setValueAtTime(qFactor, startTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.002, peakGain), startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGain);
  noise.start(startTime);
  noise.stop(startTime + durationSec + 0.012);
}

/**
 * Synthesizes a distinct, procedural Web Audio shred soundscape for each of the 5 `ParticleStyleId`
 * cosmetics (`SHRED-AUDIO-01`), scaling pitch with `pitchScale` and adding celebratory harmonics on `isFinalClear`.
 */
export function playStyledShredSoundscape(
  ctx: AudioContext,
  sfxGain: GainNode,
  startTime: number,
  pitchScale: number,
  style: ParticleStyleId,
  isFinalClear = false,
  isPreview = false
): void {
  const levelMul = (isPreview ? 0.86 : 1.0) * (isFinalClear ? 1.12 : 1.0);

  if (style === 'star_confetti') {
    playStarConfettiShred(ctx, sfxGain, startTime, pitchScale, levelMul, isFinalClear);
    return;
  }
  if (style === 'pixel_sparks') {
    playPixelSparksShred(ctx, sfxGain, startTime, pitchScale, levelMul, isFinalClear);
    return;
  }
  if (style === 'soap_bubbles') {
    playSoapBubblesShred(ctx, sfxGain, startTime, pitchScale, levelMul, isFinalClear);
    return;
  }
  if (style === 'lightning_bolts') {
    playLightningBoltsShred(ctx, sfxGain, startTime, pitchScale, levelMul, isFinalClear);
    return;
  }
  playMicroCubesShred(ctx, sfxGain, startTime, pitchScale, levelMul, isFinalClear, isPreview);
}

function playMicroCubesShred(
  ctx: AudioContext,
  sfxGain: GainNode,
  now: number,
  pitchScale: number,
  levelMul: number,
  isFinalClear: boolean,
  isPreview: boolean
): void {
  // Tactile rosewood/stone voxel marimba cascade + staggered courtyard cube-bounce micro-clicks
  const grainCount = isFinalClear ? 11 : isPreview ? 6 : 8;
  for (let i = 0; i < grainCount; i++) {
    const t = now + i * 0.021;
    const baseFreq = (325 + i * 84) * pitchScale;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i % 2 === 0 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.18, t + 0.032);

    gain.gain.setValueAtTime(0.22 * levelMul, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (isFinalClear ? 0.044 : 0.036));

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + (isFinalClear ? 0.048 : 0.04));
  }

  playFilteredNoiseBurstVoice(
    ctx,
    sfxGain,
    now,
    isFinalClear ? 0.17 : 0.13,
    1180 * pitchScale,
    0.068 * levelMul
  );

  // Staggered stone-tile scatter clicks as beveled cubes bounce across the plinth
  const scatterTaps = isFinalClear
    ? [
        [0.115, 1920, 0.095],
        [0.152, 2340, 0.082],
        [0.188, 1780, 0.072],
        [0.226, 2580, 0.062],
      ]
    : [
        [0.112, 1880, 0.082],
        [0.154, 2280, 0.068],
        [0.194, 2040, 0.054],
      ];
  for (const [delay, freq, amp] of scatterTaps) {
    const t = now + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.68 * pitchScale, t + 0.018);
    gain.gain.setValueAtTime(amp * levelMul, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.021);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.025);
  }
}

function playStarConfettiShred(
  ctx: AudioContext,
  sfxGain: GainNode,
  now: number,
  pitchScale: number,
  levelMul: number,
  isFinalClear: boolean
): void {
  // Soft festive party-popper air puff + warm paper pop
  const popOsc = ctx.createOscillator();
  const popGain = ctx.createGain();
  popOsc.type = 'sine';
  popOsc.frequency.setValueAtTime(255 * pitchScale, now);
  popOsc.frequency.exponentialRampToValueAtTime(108 * pitchScale, now + 0.036);
  popGain.gain.setValueAtTime(0.18 * levelMul, now);
  popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  popOsc.connect(popGain);
  popGain.connect(sfxGain);
  popOsc.start(now);
  popOsc.stop(now + 0.045);

  playSweptNoiseVoice(ctx, sfxGain, now, 0.075, 2400 * pitchScale, 1100 * pitchScale, 1.8, 0.08 * levelMul);

  // Sparkling celesta / glockenspiel foil-star bell cascade (fundamental + metallic tine harmonic)
  const notes = isFinalClear
    ? [1046.5, 1318.51, 1567.98, 1975.53, 2349.32, 2637.02, 3135.96]
    : [1046.5, 1318.51, 1567.98, 2093.0, 2637.02];

  notes.forEach((freq, i) => {
    const t = now + 0.014 + i * 0.029;
    const f = freq * pitchScale;

    const bell = ctx.createOscillator();
    const bellGain = ctx.createGain();
    bell.type = 'sine';
    bell.frequency.setValueAtTime(f, t);
    bellGain.gain.setValueAtTime(0.165 * levelMul, t);
    bellGain.gain.exponentialRampToValueAtTime(0.001, t + (isFinalClear ? 0.185 : 0.145));
    bell.connect(bellGain);
    bellGain.connect(sfxGain);
    bell.start(t);
    bell.stop(t + (isFinalClear ? 0.195 : 0.155));

    // Inharmonic metallic foil-tine shimmer ping
    if (f * 2.42 < 16000) {
      const tine = ctx.createOscillator();
      const tineGain = ctx.createGain();
      tine.type = 'triangle';
      tine.frequency.setValueAtTime(f * 2.42, t);
      tineGain.gain.setValueAtTime(0.052 * levelMul, t);
      tineGain.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
      tine.connect(tineGain);
      tineGain.connect(sfxGain);
      tine.start(t);
      tine.stop(t + 0.048);
    }
  });

  // High foil-confetti flutter shimmer
  playSweptNoiseVoice(
    ctx,
    sfxGain,
    now + 0.045,
    isFinalClear ? 0.19 : 0.14,
    3800,
    5200,
    3.4,
    0.042 * levelMul,
    'bandpass'
  );
}

function playPixelSparksShred(
  ctx: AudioContext,
  sfxGain: GainNode,
  now: number,
  pitchScale: number,
  levelMul: number,
  isFinalClear: boolean
): void {
  // Signature retro square-wave arcade laser-spark pitch zips
  const zips = isFinalClear
    ? [
        [0, 1420, 640, 0.05, 0.165],
        [0.036, 1880, 860, 0.048, 0.145],
        [0.074, 2520, 1140, 0.055, 0.135],
      ]
    : [
        [0, 1360, 650, 0.048, 0.16],
        [0.038, 1780, 860, 0.044, 0.13],
      ];

  for (const [delay, f0, f1, dur, amp] of zips) {
    const t = now + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f0 * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(f1 * pitchScale, t + dur);
    gain.gain.setValueAtTime(amp * levelMul, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.006);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.012);
  }

  // Crisp 8-bit ricochet spark pings bouncing off courtyard stone
  const sparkFreqs = isFinalClear
    ? [2040, 2680, 1860, 3120, 2420, 3480, 2880]
    : [1980, 2560, 1820, 2980, 2340];

  sparkFreqs.forEach((freq, i) => {
    const t = now + 0.018 + i * 0.024;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i % 2 === 0 ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(freq * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.78 * pitchScale, t + 0.02);
    gain.gain.setValueAtTime(0.085 * levelMul, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.023);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.028);
  });

  playSweptNoiseVoice(ctx, sfxGain, now, 0.068, 3200 * pitchScale, 1900 * pitchScale, 2.8, 0.065 * levelMul);
}

function playSoapBubblesShred(
  ctx: AudioContext,
  sfxGain: GainNode,
  now: number,
  pitchScale: number,
  levelMul: number,
  isFinalClear: boolean
): void {
  // Gentle wand breath + buoyant upward-sweeping liquid-glass resonant bloops (zero harsh wood clatter)
  playSweptNoiseVoice(ctx, sfxGain, now, 0.095, 760 * pitchScale, 1420 * pitchScale, 2.8, 0.052 * levelMul);

  const bloops = isFinalClear
    ? [
        [0.0, 330, 740, 0.082, 0.21],
        [0.036, 440, 960, 0.084, 0.19],
        [0.072, 392, 880, 0.082, 0.175],
        [0.108, 523.25, 1175, 0.088, 0.17],
        [0.145, 659.25, 1397, 0.092, 0.155],
      ]
    : [
        [0.0, 340, 760, 0.08, 0.21],
        [0.04, 460, 980, 0.082, 0.185],
        [0.08, 405, 890, 0.078, 0.165],
        [0.12, 560, 1180, 0.085, 0.15],
      ];

  for (const [delay, f0, f1, dur, amp] of bloops) {
    const t = now + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(f1 * pitchScale, t + dur);

    // Rounded 7ms liquid attack avoids click transients while preserving bubbly bounce
    gain.gain.setValueAtTime(0.002, t);
    gain.gain.linearRampToValueAtTime(amp * levelMul, t + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.014);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Delicate high-Q iridescent water-film bubble pops as bubbles swell aloft
  const pops = isFinalClear
    ? [
        [0.145, 1850, 2920, 0.095],
        [0.195, 2180, 3320, 0.088],
        [0.245, 1960, 3080, 0.078],
        [0.292, 2440, 3620, 0.07],
      ]
    : [
        [0.14, 1820, 2860, 0.09],
        [0.192, 2140, 3240, 0.078],
        [0.242, 1960, 3020, 0.065],
      ];

  for (const [delay, f0, f1, amp] of pops) {
    const t = now + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(f1 * pitchScale, t + 0.015);
    gain.gain.setValueAtTime(amp * levelMul, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.019);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.024);
  }
}

function playLightningBoltsShred(
  ctx: AudioContext,
  sfxGain: GainNode,
  now: number,
  pitchScale: number,
  levelMul: number,
  isFinalClear: boolean
): void {
  // 1. Sharp electrostatic leader snap transient at t = 0
  const snap = ctx.createOscillator();
  const snapGain = ctx.createGain();
  snap.type = 'triangle';
  snap.frequency.setValueAtTime(2950 * pitchScale, now);
  snap.frequency.exponentialRampToValueAtTime(340 * pitchScale, now + 0.022);
  snapGain.gain.setValueAtTime(0.22 * levelMul, now);
  snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
  snap.connect(snapGain);
  snapGain.connect(sfxGain);
  snap.start(now);
  snap.stop(now + 0.03);

  // 2. Detuned sawtooth electric-arc power fifths routed through a swept plasma filter
  const arcFilter = ctx.createBiquadFilter();
  arcFilter.type = 'bandpass';
  arcFilter.frequency.setValueAtTime(3200 * pitchScale, now);
  arcFilter.frequency.exponentialRampToValueAtTime(860 * pitchScale, now + 0.095);
  arcFilter.Q.setValueAtTime(2.2, now);
  arcFilter.connect(sfxGain);

  for (const ratio of [1.0, 1.498, 2.02]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(620 * ratio * pitchScale, now + 0.004);
    osc.frequency.exponentialRampToValueAtTime(245 * ratio * pitchScale, now + 0.088);
    gain.gain.setValueAtTime(0.145 * levelMul, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.094);
    osc.connect(gain);
    gain.connect(arcFilter);
    osc.start(now + 0.004);
    osc.stop(now + 0.1);
  }

  // 3. Swept high-Q plasma crackle + asynchronous secondary restrike arc
  playSweptNoiseVoice(ctx, sfxGain, now, 0.082, 3600 * pitchScale, 1150 * pitchScale, 4.2, 0.155 * levelMul);

  const restrikeTimes = isFinalClear ? [0.078, 0.142] : [0.08];
  restrikeTimes.forEach((delay, idx) => {
    const t = now + delay;
    const scale = idx === 0 ? 1.0 : 1.24;
    playSweptNoiseVoice(
      ctx,
      sfxGain,
      t,
      0.062,
      3900 * scale,
      1480 * scale,
      4.6,
      (idx === 0 ? 0.12 : 0.105) * levelMul
    );

    const jolt = ctx.createOscillator();
    const joltGain = ctx.createGain();
    jolt.type = 'sawtooth';
    jolt.frequency.setValueAtTime(980 * scale * pitchScale, t);
    jolt.frequency.exponentialRampToValueAtTime(380 * scale * pitchScale, t + 0.048);
    joltGain.gain.setValueAtTime(0.105 * levelMul, t);
    joltGain.gain.exponentialRampToValueAtTime(0.001, t + 0.052);
    jolt.connect(joltGain);
    joltGain.connect(sfxGain);
    jolt.start(t);
    jolt.stop(t + 0.058);
  });
}
