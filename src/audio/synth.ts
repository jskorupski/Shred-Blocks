import type { BoosterType } from '../core/types';

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: {
    type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
  };
}

// Cozy pentatonic / major-9th chord progressions in C major / F lydian / A minor7 / G13
const CHILL_CHORDS: ReadonlyArray<ReadonlyArray<number>> = [
  [261.63, 329.63, 392.0, 493.88, 587.33], // Cmaj9 (C4, E4, G4, B4, D5)
  [220.0, 261.63, 329.63, 392.0, 493.88],  // Am9   (A3, C4, E4, G4, B4)
  [174.61, 220.0, 261.63, 329.63, 392.0],  // Fmaj9 (F3, A3, C4, E4, G4)
  [196.0, 246.94, 293.66, 349.23, 440.0],  // G13   (G3, B3, D4, F4, A4)
];

export class SoundEngine {
  public sfxEnabled = true;
  public musicEnabled = true;
  public hapticsEnabled = true;

  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private unlocked = false;
  private lastSlideTickMs = 0;
  private lastWallClackMs = 0;

  // Ambient music scheduler state
  private musicTimerId: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private musicStep = 0;
  private chordIndex = 0;
  private isDocumentHidden = false;

  private readonly boundUnlock: () => void;
  private readonly boundVisibilityChange: () => void;

  constructor(initial?: { sfxEnabled?: boolean; musicEnabled?: boolean; hapticsEnabled?: boolean }) {
    if (initial?.sfxEnabled !== undefined) this.sfxEnabled = initial.sfxEnabled;
    if (initial?.musicEnabled !== undefined) this.musicEnabled = initial.musicEnabled;
    if (initial?.hapticsEnabled !== undefined) this.hapticsEnabled = initial.hapticsEnabled;

    this.boundUnlock = () => this.unlock();
    this.boundVisibilityChange = () => this.handleVisibilityChange();

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.addEventListener('pointerdown', this.boundUnlock, { passive: true });
      window.addEventListener('keydown', this.boundUnlock, { passive: true });
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
      this.syncAudioSessionType();
    }
  }

  public destroy(): void {
    this.stopMusicLoop();
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.removeEventListener('pointerdown', this.boundUnlock);
      window.removeEventListener('keydown', this.boundUnlock);
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => {});
    }
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    this.syncAudioSessionType();
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(enabled ? 0.85 : 0, this.ctx.currentTime, 0.015);
    }
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    this.syncAudioSessionType();
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(enabled ? 0.22 : 0, this.ctx.currentTime, 0.08);
    }
    if (enabled && this.unlocked && !this.isDocumentHidden) {
      this.startMusicLoop();
    } else if (!enabled) {
      this.stopMusicLoop();
    }
  }

  public setHapticsEnabled(enabled: boolean): void {
    this.hapticsEnabled = enabled;
  }

  public updateSettings(settings: {
    sfxEnabled?: boolean;
    musicEnabled?: boolean;
    hapticsEnabled?: boolean;
  }): void {
    if (settings.sfxEnabled !== undefined) this.setSfxEnabled(settings.sfxEnabled);
    if (settings.musicEnabled !== undefined) this.setMusicEnabled(settings.musicEnabled);
    if (settings.hapticsEnabled !== undefined) this.setHapticsEnabled(settings.hapticsEnabled);
  }

  /**
   * UX-05: Configure iOS 17+ `navigator.audioSession.type = 'playback'` when audio is enabled
   * so users hear game audio even if the hardware Ring/Silent switch is on silent.
   */
  private syncAudioSessionType(): void {
    if (typeof navigator === 'undefined') return;
    try {
      const nav = navigator as NavigatorWithAudioSession;
      if (nav.audioSession) {
        nav.audioSession.type = this.sfxEnabled || this.musicEnabled ? 'playback' : 'ambient';
      }
    } catch {
      // Ignore on unsupported browsers
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      this.ctx = new AudioCtx();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxEnabled ? 0.85 : 0;
      this.sfxGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicEnabled ? 0.22 : 0;
      this.musicGain.connect(this.ctx.destination);
    } catch {
      return null;
    }

    return this.ctx;
  }

  public unlock(): void {
    this.syncAudioSessionType();
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    if (!this.unlocked) {
      this.unlocked = true;
      // Play a silent 1-sample warm-up pulse to unlock iOS WebKit audio pipeline
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {
        // Ignore
      }
    }

    if (this.musicEnabled && !this.isDocumentHidden) {
      this.startMusicLoop();
    }
  }

  private handleVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    this.isDocumentHidden = document.hidden;
    if (document.hidden) {
      this.stopMusicLoop();
      if (this.ctx && this.ctx.state === 'running') {
        void this.ctx.suspend().catch(() => {});
      }
    } else {
      if (this.unlocked && this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      if (this.unlocked && this.musicEnabled) {
        this.startMusicLoop();
      }
    }
  }

  /**
   * Triggers Android vibration or iOS sub-bass acoustic-haptic transient.
   */
  public triggerHaptic(pattern: number | number[] = 10, subBassFreq = 62): void {
    if (!this.hapticsEnabled) return;

    let vibrated = false;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        vibrated = navigator.vibrate(pattern);
      } catch {
        vibrated = false;
      }
    }

    // iOS Safari fallback (or tactile enhancement when SFX is active):
    // Short low-frequency sub-bass transient that couples with mobile speaker enclosure
    if (!vibrated && this.sfxEnabled) {
      const ctx = this.ensureContext();
      if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(subBassFreq, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.028);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.032);
    }
  }

  /**
   * 1. Block Pickup (`pointerdown` on movable block):
   * Warm marimba-like wooden pop (`180 Hz -> 420 Hz`, `45 ms` exponential decay) + `8 ms` haptic pulse.
   */
  public playPickup(): void {
    this.triggerHaptic(8, 68);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.042);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.048);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /**
   * 2. Grid Cell Slide Tick (crossing integer cell boundary while dragging):
   * Subtle hollow bamboo tick (`640 Hz` bandpass burst, `18 ms`, rate-limited to `>= 28 ms`).
   */
  public playSlideTick(): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastSlideTickMs < 28) return;
    this.lastSlideTickMs = nowMs;

    this.triggerHaptic(4, 75);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.018);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(640, now);
    filter.Q.setValueAtTime(3.5, now);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.02);
  }

  /**
   * 3. Obstacle / Wall Clack (block contacts wall, obstacle, or tapping an immobile block):
   * Dull muted thud (`110 Hz` triangle + low-pass impulse, `35 ms`).
   */
  public playWallClack(): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastWallClackMs < 60) return;
    this.lastWallClackMs = nowMs;

    this.triggerHaptic([10, 20, 8], 52);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(118, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.035);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  /**
   * 4. Grid Snap (`pointerup` settling into integer grid cell):
   * Clean magnetic click (`520 Hz -> 260 Hz`, `22 ms`).
   */
  public playSnap(): void {
    this.triggerHaptic(6, 65);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.022);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.024);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.026);
  }

  /**
   * 5. Shredder Gate Grind + Pop (block Shreds through matching Gate):
   * Crisp rhythmic series of `8` ascending xylophone/marimba micro-grains (`320 Hz .. 960 Hz`)
   * + filtered white-noise mechanical whirr + staggered haptic buzz (`[12, 18, 12] ms`).
   */
  public playShred(cascadeIndex = 0): void {
    this.triggerHaptic([12, 18, 12], 70);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const pitchScale = Math.pow(2, Math.min(12, Math.max(0, cascadeIndex)) / 12);
    const grainCount = 8;

    for (let i = 0; i < grainCount; i++) {
      const startTime = now + i * 0.021;
      const baseFreq = (320 + i * 85) * pitchScale;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(baseFreq, startTime);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.18, startTime + 0.032);

      gain.gain.setValueAtTime(0.22, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.036);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(startTime);
      osc.stop(startTime + 0.038);
    }

    // Soft filtered noise whirr for the mechanical shredder rollers
    this.playFilteredNoiseBurst(now, 0.16, 1200 * pitchScale, 0.09);
  }

  /**
   * 6. Multi-Layer Shell Peel (outer layer shreds off, inner core remains):
   * Crisp zipper/pop arpeggio (`440 Hz -> 660 Hz -> 880 Hz`, `90 ms`).
   */
  public playLayerPeel(): void {
    this.triggerHaptic([8, 14, 10], 74);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    const sfxGain = this.sfxGain;
    if (!ctx || !sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const notes = [440, 660, 880];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.028;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.12, t + 0.035);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.038);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.04);
    });
  }

  /**
   * 7. Ice Crack / Shatter:
   * High-frequency crystalline FM chime (`1800 Hz + 2450 Hz` inharmonic partials, `65 ms`).
   */
  public playIceCrack(): void {
    this.triggerHaptic(10, 80);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const partials = [1800, 2450, 3120];
    for (const freq of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, now + 0.065);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.068);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.07);
    }
  }

  /**
   * 8. Key / Lock / Scissors / Shutter Unlock:
   * Metallic tumbler click + warm fifth (`587 Hz -> 880 Hz`, `110 ms`).
   */
  public playLockOpen(): void {
    this.triggerHaptic([10, 20, 14], 66);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    const sfxGain = this.sfxGain;
    if (!ctx || !sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const notes = [587.33, 880.0];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.048;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.26, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.08);
    });
  }

  /**
   * 9. Booster Activation (Hammer, Rocket, Vacuum, Freeze, Undo):
   * Distinct procedural sound signature per booster.
   */
  public playBooster(type: BoosterType = 'HAMMER'): void {
    this.triggerHaptic([15, 25, 18], 58);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

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
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.13);
      this.playIceCrack();
    } else if (type === 'ROCKET') {
      // Rising whoosh + pop
      this.playFilteredNoiseBurst(now, 0.22, 950, 0.18);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.sfxGain);
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
        gain.connect(this.sfxGain!);
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
        gain.connect(this.sfxGain!);
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
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.055);
      });
    }
  }

  /**
   * 10. Level Win Fanfare:
   * Upbeat, joyful 3-voice celebratory victory fanfare:
   * - Voice 1: Syncopated marimba & bell lead melody (`C5 -> E5 -> G5 -> C6 -> A5 -> B5 -> C6 -> D6 -> E6 -> G6`)
   * - Voice 2: Lush twilight sanctuary harmonic chord progression (`Fmaj9 -> G13 -> Cmaj9`)
   * - Voice 3: Upbeat bass groove + sparkling star-pop crystalline chimes (`C7 -> E7 -> G7`)
   */
  public playWinFanfare(earnedStars = 3): void {
    this.triggerHaptic([18, 30, 18, 30, 28, 40, 35], 64);
    if (!this.sfxEnabled && !this.musicEnabled) return;
    const ctx = this.ensureContext();
    const outGain = this.sfxEnabled ? this.sfxGain : this.musicGain;
    if (!ctx || !outGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

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
      { t: 1.02, f: 1567.98, dur: 0.65, amp: 0.30 }, // G6
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
   * 11. Level Loss / Out of Time:
   * Gentle, non-startling descending soft synth chord (`G4 - Eb4 - C4`).
   */
  public playLossBuzzer(): void {
    this.triggerHaptic([20, 40, 25], 50);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

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
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  /**
   * Convenience UI button tap sound.
   */
  public playButtonTap(): void {
    this.triggerHaptic(5, 72);
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state !== 'running' && ctx.currentTime === 0) {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.02);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.025);
  }

  private playFilteredNoiseBurst(
    startTime: number,
    durationSec: number,
    centerFreq: number,
    peakGain: number
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;

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
    gain.connect(this.sfxGain);
    noise.start(startTime);
    noise.stop(startTime + durationSec + 0.01);
  }

  /**
   * Starts the Chill Ambient Background Music Synthesizer lookahead scheduler.
   * Uses a soft Rhodes/marimba arpeggiator + warm low-pass pad loop.
   */
  private startMusicLoop(): void {
    if (this.musicTimerId !== null) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.musicGain) return;

    this.nextNoteTime = ctx.currentTime + 0.08;
    this.musicTimerId = setInterval(() => this.scheduleMusicLookahead(), 120);
  }

  private stopMusicLoop(): void {
    if (this.musicTimerId !== null) {
      clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }
  }

  private scheduleMusicLookahead(): void {
    if (!this.musicEnabled || this.isDocumentHidden || !this.ctx || !this.musicGain) return;
    if (this.ctx.state !== 'running') return;
    if (this.nextNoteTime < this.ctx.currentTime) {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }

    const stepDuration = 0.42; // ~142 BPM eighth-note chill pulse
    while (this.nextNoteTime < this.ctx.currentTime + 0.35) {
      this.scheduleAmbientStep(this.nextNoteTime, stepDuration);
      this.nextNoteTime += stepDuration;
    }
  }

  private scheduleAmbientStep(time: number, stepDuration: number): void {
    const ctx = this.ctx;
    const musicGain = this.musicGain;
    if (!ctx || !musicGain) return;

    const chord = CHILL_CHORDS[this.chordIndex % CHILL_CHORDS.length];

    // On step 0 of every 8-step bar, swell a warm low-pass synth pad root + fifth
    if (this.musicStep % 8 === 0) {
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
    const patternIndex = [0, 2, 1, 3, 4, 2, -1, 3][this.musicStep % 8];
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

    this.musicStep++;
    if (this.musicStep % 8 === 0) {
      this.chordIndex = (this.chordIndex + 1) % CHILL_CHORDS.length;
    }
  }
}
