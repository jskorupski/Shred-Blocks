import type { BoosterType } from '../core/types';

// Cozy pentatonic / major-9th chord progressions in C major / F lydian / A minor7 / G13
const CHILL_CHORDS: ReadonlyArray<ReadonlyArray<number>> = [
  [261.63, 329.63, 392.0, 493.88, 587.33], // Cmaj9 (C4, E4, G4, B4, D5)
  [220.0, 261.63, 329.63, 392.0, 493.88], // Am9   (A3, C4, E4, G4, B4)
  [174.61, 220.0, 261.63, 329.63, 392.0], // Fmaj9 (F3, A3, C4, E4, G4)
  [196.0, 246.94, 293.66, 349.23, 440.0], // G13   (G3, B3, D4, F4, A4)
];

export function playFilteredNoiseBurstVoice(
  ctx: AudioContext,
  sfxGain: GainNode,
  startTime: number,
  durationSec: number,
  centerFreq: number,
  peakGain: number
): void {
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

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
  } else if (type === 'FREEZE') {
    // Shimmering crystalline slow-down chime
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

/**
 * Relic Awakening (`RELIC-AWAKEN-01`, Title Screen -> Gameplay):
 * Warm, non-harsh mystic stone detonation: deep sub-bass rumbling boom (`112 -> 38 Hz`),
 * rolling earthy low-pass rumble, and dual-band warm pink-noise whoosh + airy swish
 * through a flat `1280 Hz` Butterworth warmth ceiling (zero bells, dings, or harsh highs).
 */
export function playRelicAwakenVoice(ctx: AudioContext, sfxGain: GainNode): void {
  const now = ctx.currentTime;
  const totalDur = 0.88;

  // Velvet master bus: 1280 Hz Butterworth lowpass (Q = 0.5) guarantees zero harsh highs or clipping
  const masterFilter = ctx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.setValueAtTime(1280, now);
  masterFilter.Q.setValueAtTime(0.5, now);

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.86, now);
  masterFilter.connect(masterGain);
  masterGain.connect(sfxGain);

  // Shared 1-pole warm pink/brown noise buffer with feathered cosine edges (click-free)
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * totalDur));
  const noiseBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  const edgeSamples = Math.max(1, Math.floor(ctx.sampleRate * 0.024));
  let lpState = 0;
  for (let i = 0; i < sampleCount; i++) {
    const white = Math.random() * 2 - 1;
    lpState = 0.84 * lpState + 0.16 * white;
    let env = 1;
    if (i < edgeSamples) {
      env = 0.5 * (1 - Math.cos((Math.PI * i) / edgeSamples));
    } else if (i > sampleCount - edgeSamples) {
      const rem = sampleCount - i;
      env = 0.5 * (1 - Math.cos((Math.PI * rem) / edgeSamples));
    }
    data[i] = lpState * 2.6 * env;
  }

  // 1. Deep Sub-Bass Boom (112 Hz -> 56 Hz -> 38 Hz pure sine, soft 20ms attack)
  const subOsc = ctx.createOscillator();
  const subGain = ctx.createGain();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(112, now);
  subOsc.frequency.exponentialRampToValueAtTime(56, now + 0.18);
  subOsc.frequency.exponentialRampToValueAtTime(38, now + 0.78);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.linearRampToValueAtTime(0.34, now + 0.02);
  subGain.gain.setValueAtTime(0.32, now + 0.075);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.78);
  subOsc.connect(subGain);
  subGain.connect(masterFilter);
  subOsc.start(now);
  subOsc.stop(now + 0.8);

  // 2. Rolling Tectonic Stone Rumble (lowpass noise 210 -> 82 Hz + detuned low cavern undertone)
  const rumbleSrc = ctx.createBufferSource();
  rumbleSrc.buffer = noiseBuffer;
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.setValueAtTime(210, now);
  rumbleFilter.frequency.exponentialRampToValueAtTime(82, now + 0.82);
  rumbleFilter.Q.setValueAtTime(0.7, now);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.0001, now);
  rumbleGain.gain.linearRampToValueAtTime(0.32, now + 0.045);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.84);
  rumbleSrc.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(masterFilter);
  rumbleSrc.start(now);
  rumbleSrc.stop(now + 0.86);

  for (const detune of [-8, 8]) {
    const cavernOsc = ctx.createOscillator();
    const cavernLp = ctx.createBiquadFilter();
    const cavernGain = ctx.createGain();
    cavernOsc.type = 'triangle';
    cavernOsc.frequency.setValueAtTime(73.42, now);
    cavernOsc.frequency.exponentialRampToValueAtTime(55.0, now + 0.78);
    cavernOsc.detune.setValueAtTime(detune, now);
    cavernLp.type = 'lowpass';
    cavernLp.frequency.setValueAtTime(175, now);
    cavernLp.Q.setValueAtTime(0.6, now);
    cavernGain.gain.setValueAtTime(0.0001, now);
    cavernGain.gain.linearRampToValueAtTime(0.11, now + 0.055);
    cavernGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    cavernOsc.connect(cavernLp);
    cavernLp.connect(cavernGain);
    cavernGain.connect(masterFilter);
    cavernOsc.start(now);
    cavernOsc.stop(now + 0.82);
  }

  // 3. Expansive Mystic Whoosh + Soft Airy Swish (wide low-Q swept bandpass, zero whistle)
  const whooshSrc = ctx.createBufferSource();
  whooshSrc.buffer = noiseBuffer;
  whooshSrc.playbackRate.setValueAtTime(0.92, now);
  whooshSrc.playbackRate.linearRampToValueAtTime(1.16, now + 0.16);
  whooshSrc.playbackRate.exponentialRampToValueAtTime(0.76, now + 0.76);
  const whooshBp = ctx.createBiquadFilter();
  whooshBp.type = 'bandpass';
  whooshBp.Q.setValueAtTime(0.72, now);
  whooshBp.frequency.setValueAtTime(145, now);
  whooshBp.frequency.exponentialRampToValueAtTime(510, now + 0.15);
  whooshBp.frequency.exponentialRampToValueAtTime(140, now + 0.76);
  const whooshGain = ctx.createGain();
  whooshGain.gain.setValueAtTime(0.0001, now);
  whooshGain.gain.linearRampToValueAtTime(0.28, now + 0.038);
  whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.76);
  whooshSrc.connect(whooshBp);
  whooshBp.connect(whooshGain);
  whooshGain.connect(masterFilter);
  whooshSrc.start(now);
  whooshSrc.stop(now + 0.78);

  const swishSrc = ctx.createBufferSource();
  swishSrc.buffer = noiseBuffer;
  swishSrc.playbackRate.setValueAtTime(1.04, now + 0.015);
  swishSrc.playbackRate.exponentialRampToValueAtTime(0.82, now + 0.7);
  const swishBp = ctx.createBiquadFilter();
  swishBp.type = 'bandpass';
  swishBp.Q.setValueAtTime(0.92, now + 0.015);
  swishBp.frequency.setValueAtTime(260, now + 0.015);
  swishBp.frequency.exponentialRampToValueAtTime(840, now + 0.19);
  swishBp.frequency.exponentialRampToValueAtTime(220, now + 0.7);
  const swishGain = ctx.createGain();
  swishGain.gain.setValueAtTime(0.0001, now + 0.015);
  swishGain.gain.linearRampToValueAtTime(0.16, now + 0.075);
  swishGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
  swishSrc.connect(swishBp);
  swishBp.connect(swishGain);
  swishGain.connect(masterFilter);
  swishSrc.start(now + 0.015);
  swishSrc.stop(now + 0.74);

  // 4. Warm Low-Baritone Mystic Breath Fifth (110 Hz A2 + 164.81 Hz E3, slow 85ms swell, zero ding)
  for (const freq of [110.0, 164.81]) {
    const auraOsc = ctx.createOscillator();
    const auraGain = ctx.createGain();
    auraOsc.type = 'sine';
    auraOsc.frequency.setValueAtTime(freq, now + 0.02);
    auraOsc.frequency.exponentialRampToValueAtTime(freq * 0.94, now + 0.76);
    auraGain.gain.setValueAtTime(0.0001, now + 0.02);
    auraGain.gain.linearRampToValueAtTime(0.06, now + 0.105);
    auraGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.76);
    auraOsc.connect(auraGain);
    auraGain.connect(masterFilter);
    auraOsc.start(now + 0.02);
    auraOsc.stop(now + 0.78);
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
