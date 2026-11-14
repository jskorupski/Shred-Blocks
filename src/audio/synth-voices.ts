import type { BoosterType, ParticleStyleId } from '../core/types';

// Cozy pentatonic / major-9th chord progressions in C major / F lydian / A minor7 / G13
const CHILL_CHORDS: ReadonlyArray<ReadonlyArray<number>> = [
  [261.63, 329.63, 392.0, 493.88, 587.33], // Cmaj9 (C4, E4, G4, B4, D5)
  [220.0, 261.63, 329.63, 392.0, 493.88], // Am9   (A3, C4, E4, G4, B4)
  [174.61, 220.0, 261.63, 329.63, 392.0], // Fmaj9 (F3, A3, C4, E4, G4)
  [196.0, 246.94, 293.66, 349.23, 440.0], // G13   (G3, B3, D4, F4, A4)
];

const sharedBurstNoiseCache = new WeakMap<AudioContext, AudioBuffer>();

function getSharedNoiseBuffer(ctx: AudioContext, minDurationSec: number): AudioBuffer {
  const cached = sharedBurstNoiseCache.get(ctx);
  const minSamples = Math.max(1, Math.ceil(ctx.sampleRate * Math.max(0.32, minDurationSec)));
  if (cached && cached.sampleRate === ctx.sampleRate && cached.length >= minSamples) {
    return cached;
  }
  const buffer = ctx.createBuffer(1, minSamples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < minSamples; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  sharedBurstNoiseCache.set(ctx, buffer);
  return buffer;
}

/**
 * Pre-generates and caches the shared white-noise PCM buffer on `ctx` during idle warm-up
 * so first pickup, slide, or shred SFX never allocates samples on the interaction frame.
 */
export function prewarmSharedNoiseBuffer(ctx: AudioContext): void {
  getSharedNoiseBuffer(ctx, 0.35);
}

export function playFilteredNoiseBurstVoice(
  ctx: AudioContext,
  sfxGain: GainNode,
  startTime: number,
  durationSec: number,
  centerFreq: number,
  peakGain: number
): void {
  const noise = ctx.createBufferSource();
  noise.buffer = getSharedNoiseBuffer(ctx, durationSec + 0.02);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(centerFreq, startTime);
  filter.Q.setValueAtTime(2.0, startTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGain);
  noise.start(startTime);
  noise.stop(startTime + durationSec + 0.01);
}

export function playBoosterVoice(
  ctx: AudioContext,
  sfxGain: GainNode,
  type: BoosterType,
  onIceCrack: () => void
): void {
  const now = ctx.currentTime;
  if (type === 'HAMMER') {
    // Heavy anvil impact + bright sparkle
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.11);
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.13);
    onIceCrack();
  } else if (type === 'ROCKET') {
    // Rising whoosh + pop
    playFilteredNoiseBurstVoice(ctx, sfxGain, now, 0.22, 950, 0.18);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.21);
  } else if (type === 'VACUUM') {
    // Rising harmonic suction chord
    const freqs = [330, 440, 554.37, 659.25];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 0.7, now + idx * 0.02);
      osc.frequency.exponentialRampToValueAtTime(f * 1.25, now + 0.18);
      gain.gain.setValueAtTime(0.16, now + idx * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(now + idx * 0.02);
      osc.stop(now + 0.21);
    });
  } else if (type === 'HINT') {
    // Shimmering crystalline insight chime
    const freqs = [1567.98, 1318.51, 1046.5, 783.99];
    freqs.forEach((f, idx) => {
      const t = now + idx * 0.035;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  } else {
    // UNDO: Quick reverse marimba two-step
    const notes = [523.25, 392.0];
    notes.forEach((f, idx) => {
      const t = now + idx * 0.035;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.055);
    });
  }
}

export function playWinFanfareVoices(ctx: AudioContext, outGain: GainNode, earnedStars: number): void {
  const now = ctx.currentTime;
  // Voice 1: Upbeat syncopated lead melody
  const melody: Array<{ t: number; f: number; dur: number; amp: number }> = [
    { t: 0.0, f: 523.25, dur: 0.22, amp: 0.22 }, // C5
    { t: 0.09, f: 659.25, dur: 0.22, amp: 0.22 }, // E5
    { t: 0.18, f: 783.99, dur: 0.24, amp: 0.24 }, // G5
    { t: 0.28, f: 1046.5, dur: 0.28, amp: 0.26 }, // C6
    { t: 0.42, f: 880.0, dur: 0.22, amp: 0.22 }, // A5
    { t: 0.52, f: 987.77, dur: 0.22, amp: 0.24 }, // B5
    { t: 0.63, f: 1046.5, dur: 0.24, amp: 0.25 }, // C6
    { t: 0.74, f: 1174.66, dur: 0.26, amp: 0.26 }, // D6
    { t: 0.86, f: 1318.51, dur: 0.48, amp: 0.28 }, // E6
    { t: 1.02, f: 1567.98, dur: 0.65, amp: 0.3 }, // G6
  ];

  for (const note of melody) {
    const t = now + note.t;
    for (const detune of [-5, 5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, t);
      osc.detune.setValueAtTime(detune, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(note.amp * 0.65, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.dur);

      osc.connect(gain);
      gain.connect(outGain);
      osc.start(t);
      osc.stop(t + note.dur + 0.02);
    }
  }

  // Voice 2: Warm harmonic triad/9th chord swell (Fmaj9 -> G13 -> Cmaj9)
  const chords: Array<{ t: number; dur: number; freqs: number[] }> = [
    { t: 0.0, dur: 0.44, freqs: [349.23, 440.0, 523.25, 659.25] },
    { t: 0.42, dur: 0.46, freqs: [392.0, 493.88, 587.33, 659.25] },
    { t: 0.86, dur: 0.85, freqs: [261.63, 392.0, 493.88, 587.33, 659.25] },
  ];
  for (const chord of chords) {
    const t = now + chord.t;
    for (const f of chord.freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.065, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + chord.dur);
      osc.connect(gain);
      gain.connect(outGain);
      osc.start(t);
      osc.stop(t + chord.dur + 0.02);
    }
  }

  // Voice 3: Upbeat bass pulse + star-pop crystalline chimes
  const bassNotes = [
    { t: 0.0, f: 174.61, dur: 0.2 },
    { t: 0.21, f: 261.63, dur: 0.2 },
    { t: 0.42, f: 196.0, dur: 0.2 },
    { t: 0.63, f: 293.66, dur: 0.2 },
    { t: 0.86, f: 130.81, dur: 0.35 },
    { t: 1.05, f: 261.63, dur: 0.55 },
  ];
  for (const b of bassNotes) {
    const t = now + b.t;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(b.f, t);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + b.dur);
    osc.connect(gain);
    gain.connect(outGain);
    osc.start(t);
    osc.stop(t + b.dur + 0.02);
  }

  const starChimes = [2093.0, 2637.02, 3135.96].slice(0, Math.max(1, Math.min(3, earnedStars)));
  starChimes.forEach((f, idx) => {
    const t = now + 0.14 + idx * 0.14;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(gain);
    gain.connect(outGain);
    osc.start(t);
    osc.stop(t + 0.34);
  });
}

/**
 * Under-Par Oracle Chime (`UNDER-PAR-ORACLE-01`):
 * Crystalline Lydian `#11` astral bell cascade (`F#6 -> G6 -> B6 -> D7 -> F#7 -> G7`)
 * layered right after the victory fanfare peak to celebrate outsmarting the Sanctuary solver.
 */
export function playUnderParOracleVoice(ctx: AudioContext, outGain: GainNode): void {
  const now = ctx.currentTime;
  const bells: ReadonlyArray<{ t: number; f: number; dur: number; amp: number }> = [
    { t: 0.34, f: 1479.98, dur: 0.44, amp: 0.14 }, // F#6 (Lydian #11 sparkle)
    { t: 0.44, f: 1567.98, dur: 0.46, amp: 0.15 }, // G6
    { t: 0.54, f: 1975.53, dur: 0.5, amp: 0.16 }, // B6
    { t: 0.65, f: 2349.32, dur: 0.54, amp: 0.15 }, // D7
    { t: 0.77, f: 2959.96, dur: 0.62, amp: 0.14 }, // F#7
    { t: 0.91, f: 3135.96, dur: 0.82, amp: 0.17 }, // G7
  ];
  for (const bell of bells) {
    const t = now + bell.t;
    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(bell.f, t);
      osc.detune.setValueAtTime(detune, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(bell.amp * 0.6, t + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.001, t + bell.dur);
      osc.connect(gain);
      gain.connect(outGain);
      osc.start(t);
      osc.stop(t + bell.dur + 0.02);
    }
  }
}

export function playLossBuzzerVoice(ctx: AudioContext, sfxGain: GainNode): void {
  const now = ctx.currentTime;
  const notes = [392.0, 311.13, 261.63];
  notes.forEach((freq, idx) => {
    const t = now + idx * 0.14;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.97, t + 0.24);

    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.28);
  });
}

export function playButtonTapVoice(ctx: AudioContext, sfxGain: GainNode): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(480, now);
  osc.frequency.exponentialRampToValueAtTime(620, now + 0.02);

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.025);
}

const RELIC_AWAKEN_DURATION_SEC = 1.68;
const relicAwakenNoiseCache = new WeakMap<AudioContext, AudioBuffer>();

/**
 * Pre-generates and caches the `1.68s` 1-pole warm pink/brown noise buffer once per `AudioContext`
 * (`PERF-TRANSITION-01`) so tapping Play on mobile never runs an `80,640`-sample loop on the click frame.
 */
export function getOrCreateRelicAwakenNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = relicAwakenNoiseCache.get(ctx);
  if (cached) return cached;

  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * RELIC_AWAKEN_DURATION_SEC));
  const noiseBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  const edgeSamples = Math.max(1, Math.floor(ctx.sampleRate * 0.032));
  let lpState = 0;
  for (let i = 0; i < sampleCount; i++) {
    const white = Math.random() * 2 - 1;
    lpState = 0.86 * lpState + 0.14 * white;
    let env = 1;
    if (i < edgeSamples) {
      env = 0.5 * (1 - Math.cos((Math.PI * i) / edgeSamples));
    } else if (i > sampleCount - edgeSamples) {
      const rem = sampleCount - i;
      env = 0.5 * (1 - Math.cos((Math.PI * rem) / edgeSamples));
    }
    data[i] = lpState * 2.9 * env;
  }

  relicAwakenNoiseCache.set(ctx, noiseBuffer);
  return noiseBuffer;
}

/**
 * Relic Awakening (`RELIC-AWAKEN-01`, Title Screen -> Gameplay):
 * Warm, longer-lasting mystic stone detonation (~1.68s): slightly louder sub-bass boom (`116 -> 34 Hz`),
 * sustained rolling tectonic stone-fracture rumble + secondary aftershock rumble, sub-octave seismic sine,
 * and dual-band warm pink-noise whoosh + airy swish through a flat `1280 Hz` Butterworth warmth ceiling
 * (zero bells, dings, or harsh highs).
 */
export function playRelicAwakenVoice(ctx: AudioContext, sfxGain: GainNode): void {
  const now = ctx.currentTime;

  // Velvet master bus: 1280 Hz Butterworth lowpass (Q = 0.5) guarantees zero harsh highs or clipping
  const masterFilter = ctx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.setValueAtTime(1280, now);
  masterFilter.Q.setValueAtTime(0.5, now);

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.98, now);
  masterFilter.connect(masterGain);
  masterGain.connect(sfxGain);

  const noiseBuffer = getOrCreateRelicAwakenNoiseBuffer(ctx);

  // 1. Deep Sub-Bass Boom + Sub-Octave Seismic Rumble (116 -> 50 -> 34 Hz & 45 -> 33 Hz sines)
  const subOsc = ctx.createOscillator();
  const subGain = ctx.createGain();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(116, now);
  subOsc.frequency.exponentialRampToValueAtTime(50, now + 0.24);
  subOsc.frequency.exponentialRampToValueAtTime(34, now + 1.52);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.linearRampToValueAtTime(0.45, now + 0.022);
  subGain.gain.setValueAtTime(0.41, now + 0.14);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.54);
  subOsc.connect(subGain);
  subGain.connect(masterFilter);
  subOsc.start(now);
  subOsc.stop(now + 1.56);

  const seismicOsc = ctx.createOscillator();
  const seismicGain = ctx.createGain();
  seismicOsc.type = 'sine';
  seismicOsc.frequency.setValueAtTime(45, now + 0.04);
  seismicOsc.frequency.exponentialRampToValueAtTime(33, now + 1.58);
  seismicGain.gain.setValueAtTime(0.0001, now + 0.04);
  seismicGain.gain.linearRampToValueAtTime(0.26, now + 0.22);
  seismicGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
  seismicOsc.connect(seismicGain);
  seismicGain.connect(masterFilter);
  seismicOsc.start(now + 0.04);
  seismicOsc.stop(now + 1.62);

  // 2. Sustained Tectonic Stone Rumble + Secondary Stone-Break Aftershock Rumble
  const rumbleSrc = ctx.createBufferSource();
  rumbleSrc.buffer = noiseBuffer;
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.setValueAtTime(235, now);
  rumbleFilter.frequency.exponentialRampToValueAtTime(64, now + 1.6);
  rumbleFilter.Q.setValueAtTime(0.76, now);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.0001, now);
  rumbleGain.gain.linearRampToValueAtTime(0.46, now + 0.045);
  rumbleGain.gain.setValueAtTime(0.36, now + 0.34);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.64);
  rumbleSrc.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(masterFilter);
  rumbleSrc.start(now);
  rumbleSrc.stop(now + 1.66);

  const fractureSrc = ctx.createBufferSource();
  fractureSrc.buffer = noiseBuffer;
  fractureSrc.playbackRate.setValueAtTime(0.78, now + 0.14);
  const fractureFilter = ctx.createBiquadFilter();
  fractureFilter.type = 'lowpass';
  fractureFilter.frequency.setValueAtTime(175, now + 0.14);
  fractureFilter.frequency.exponentialRampToValueAtTime(54, now + 1.62);
  fractureFilter.Q.setValueAtTime(0.82, now + 0.14);
  const fractureGain = ctx.createGain();
  fractureGain.gain.setValueAtTime(0.0001, now + 0.14);
  fractureGain.gain.linearRampToValueAtTime(0.34, now + 0.3);
  fractureGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.64);
  fractureSrc.connect(fractureFilter);
  fractureFilter.connect(fractureGain);
  fractureGain.connect(masterFilter);
  fractureSrc.start(now + 0.14);
  fractureSrc.stop(now + 1.66);

  for (const detune of [-9, 9]) {
    const cavernOsc = ctx.createOscillator();
    const cavernLp = ctx.createBiquadFilter();
    const cavernGain = ctx.createGain();
    cavernOsc.type = 'triangle';
    cavernOsc.frequency.setValueAtTime(73.42, now);
    cavernOsc.frequency.exponentialRampToValueAtTime(49.0, now + 1.5);
    cavernOsc.detune.setValueAtTime(detune, now);
    cavernLp.type = 'lowpass';
    cavernLp.frequency.setValueAtTime(175, now);
    cavernLp.Q.setValueAtTime(0.6, now);
    cavernGain.gain.setValueAtTime(0.0001, now);
    cavernGain.gain.linearRampToValueAtTime(0.16, now + 0.07);
    cavernGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.54);
    cavernOsc.connect(cavernLp);
    cavernLp.connect(cavernGain);
    cavernGain.connect(masterFilter);
    cavernOsc.start(now);
    cavernOsc.stop(now + 1.56);
  }

  // 3. Expansive Mystic Whoosh + Soft Airy Swish (wide low-Q swept bandpass, zero whistle)
  const whooshSrc = ctx.createBufferSource();
  whooshSrc.buffer = noiseBuffer;
  whooshSrc.playbackRate.setValueAtTime(0.92, now);
  whooshSrc.playbackRate.linearRampToValueAtTime(1.16, now + 0.2);
  whooshSrc.playbackRate.exponentialRampToValueAtTime(0.7, now + 1.38);
  const whooshBp = ctx.createBiquadFilter();
  whooshBp.type = 'bandpass';
  whooshBp.Q.setValueAtTime(0.72, now);
  whooshBp.frequency.setValueAtTime(145, now);
  whooshBp.frequency.exponentialRampToValueAtTime(520, now + 0.18);
  whooshBp.frequency.exponentialRampToValueAtTime(118, now + 1.38);
  const whooshGain = ctx.createGain();
  whooshGain.gain.setValueAtTime(0.0001, now);
  whooshGain.gain.linearRampToValueAtTime(0.32, now + 0.042);
  whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
  whooshSrc.connect(whooshBp);
  whooshBp.connect(whooshGain);
  whooshGain.connect(masterFilter);
  whooshSrc.start(now);
  whooshSrc.stop(now + 1.42);

  const swishSrc = ctx.createBufferSource();
  swishSrc.buffer = noiseBuffer;
  swishSrc.playbackRate.setValueAtTime(1.04, now + 0.02);
  swishSrc.playbackRate.exponentialRampToValueAtTime(0.78, now + 1.24);
  const swishBp = ctx.createBiquadFilter();
  swishBp.type = 'bandpass';
  swishBp.Q.setValueAtTime(0.9, now + 0.02);
  swishBp.frequency.setValueAtTime(260, now + 0.02);
  swishBp.frequency.exponentialRampToValueAtTime(840, now + 0.22);
  swishBp.frequency.exponentialRampToValueAtTime(190, now + 1.24);
  const swishGain = ctx.createGain();
  swishGain.gain.setValueAtTime(0.0001, now + 0.02);
  swishGain.gain.linearRampToValueAtTime(0.18, now + 0.09);
  swishGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.26);
  swishSrc.connect(swishBp);
  swishBp.connect(swishGain);
  swishGain.connect(masterFilter);
  swishSrc.start(now + 0.02);
  swishSrc.stop(now + 1.28);

  // 4. Warm Low-Baritone Mystic Breath Fifth (110 Hz A2 + 164.81 Hz E3, slow swell, zero ding)
  for (const freq of [110.0, 164.81]) {
    const auraOsc = ctx.createOscillator();
    const auraGain = ctx.createGain();
    auraOsc.type = 'sine';
    auraOsc.frequency.setValueAtTime(freq, now + 0.025);
    auraOsc.frequency.exponentialRampToValueAtTime(freq * 0.92, now + 1.46);
    auraGain.gain.setValueAtTime(0.0001, now + 0.025);
    auraGain.gain.linearRampToValueAtTime(0.075, now + 0.14);
    auraGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.48);
    auraOsc.connect(auraGain);
    auraGain.connect(masterFilter);
    auraOsc.start(now + 0.025);
    auraOsc.stop(now + 1.5);
  }
}

export function scheduleAmbientStepVoice(
  ctx: AudioContext,
  musicGain: GainNode,
  time: number,
  stepDuration: number,
  musicStep: number,
  chordIndex: number
): { nextStep: number; nextChordIndex: number } {
  const chord = CHILL_CHORDS[chordIndex % CHILL_CHORDS.length];
  // On step 0 of every 8-step bar, swell a warm low-pass synth pad root + fifth
  if (musicStep % 8 === 0) {
    const rootFreq = chord[0] * 0.5;
    const fifthFreq = chord[2] * 0.5;
    for (const padFreq of [rootFreq, fifthFreq]) {
      const padOsc = ctx.createOscillator();
      const padFilter = ctx.createBiquadFilter();
      const padGain = ctx.createGain();

      padOsc.type = 'triangle';
      padOsc.frequency.setValueAtTime(padFreq, time);

      padFilter.type = 'lowpass';
      padFilter.frequency.setValueAtTime(420, time);

      const barDur = stepDuration * 8;
      padGain.gain.setValueAtTime(0.001, time);
      padGain.gain.linearRampToValueAtTime(0.14, time + barDur * 0.35);
      padGain.gain.exponentialRampToValueAtTime(0.001, time + barDur * 0.98);

      padOsc.connect(padFilter);
      padFilter.connect(padGain);
      padGain.connect(musicGain);
      padOsc.start(time);
      padOsc.stop(time + barDur);
    }
  }

  // Play a soft Rhodes / marimba arpeggio note on selected steps (sparse, non-fatiguing)
  const patternIndex = [0, 2, 1, 3, 4, 2, -1, 3][musicStep % 8];
  if (patternIndex >= 0) {
    const noteFreq = chord[patternIndex % chord.length];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(noteFreq, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.18, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + stepDuration * 1.45);

    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(time);
    osc.stop(time + stepDuration * 1.5);
  }

  const nextStep = musicStep + 1;
  const nextChordIndex = nextStep % 8 === 0 ? (chordIndex + 1) % CHILL_CHORDS.length : chordIndex;
  return { nextStep, nextChordIndex };
}

export function playShredStyleOvertoneVoice(
  ctx: AudioContext,
  sfxGain: GainNode,
  startTime: number,
  pitchScale: number,
  style: ParticleStyleId,
  previewOnly = false
): void {
  const amp = previewOnly ? 0.2 : 0.12;
  if (style === 'star_confetti') {
    // Celesta bell fifth sparkle
    const notes = [1567.98, 2093.0];
    notes.forEach((f, i) => {
      const t = startTime + (previewOnly ? i * 0.045 : 0.06 + i * 0.035);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * pitchScale, t);
      gain.gain.setValueAtTime(amp, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  } else if (style === 'pixel_sparks') {
    // Crisp arcade laser-spark pitch zip
    const t = startTime + (previewOnly ? 0 : 0.03);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1320 * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(660 * pitchScale, t + 0.042);
    gain.gain.setValueAtTime(amp * 0.72, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.048);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.052);
  } else if (style === 'soap_bubbles') {
    // Buoyant liquid-glass upward droplet cluster bloop + effervescent pop
    for (const [delay, f0, f1, peak] of [
      [0, 380, 790, 1.05],
      [0.058, 540, 1080, 0.72],
    ]) {
      const t = startTime + (previewOnly ? 0 : 0.035) + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0 * pitchScale, t);
      osc.frequency.exponentialRampToValueAtTime(f1 * pitchScale, t + 0.08);
      gain.gain.setValueAtTime(amp * peak, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.092);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  } else if (style === 'lightning_bolts') {
    // Arcane electric snap fifth + primary & re-strike crackle bursts
    const t = startTime + (previewOnly ? 0 : 0.015);
    for (const ratio of [1.0, 1.498, 2.0]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640 * ratio * pitchScale, t);
      osc.frequency.exponentialRampToValueAtTime(280 * ratio * pitchScale, t + 0.068);
      gain.gain.setValueAtTime(amp * 0.54, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.074);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.08);
    }
    playFilteredNoiseBurstVoice(ctx, sfxGain, t, 0.065, 2750 * pitchScale, amp * 0.75);
    playFilteredNoiseBurstVoice(ctx, sfxGain, t + 0.075, 0.05, 3400 * pitchScale, amp * 0.48);
  } else if (previewOnly) {
    // micro_cubes preview: crisp tactile wooden marimba double tap
    for (let i = 0; i < 2; i++) {
      const t = startTime + i * 0.038;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime((440 + i * 146) * pitchScale, t);
      gain.gain.setValueAtTime(amp, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.055);
    }
  }
}
