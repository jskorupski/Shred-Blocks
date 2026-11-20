import type { AudioVolumeStep, BoosterType, ParticleStyleId } from '../core/types';
import { AmbientMusicController, type AmbientPresetId, type MusicScene } from './ambient-music';
import {
  dispatchHapticFeedback,
  HAPTIC_MAX_PULSE_MS,
  HAPTIC_MIN_PULSE_MS,
  HAPTIC_PATTERNS,
  type HapticCueId,
  type HapticCueSpec,
} from './haptics';
import { playStyledShredSoundscape } from './shred-style-voices';
import {
  getOrCreateRelicAwakenNoiseBuffer,
  playBoosterVoice,
  playButtonTapVoice,
  playIceCrackVoice,
  playLayerPeelVoice,
  playLockOpenVoice,
  playLossBuzzerVoice,
  playPickupVoice,
  playRelicAwakenVoice,
  playSlideTickVoice,
  playSnapVoice,
  playUnderParOracleVoice,
  playWallClackVoice,
  playWinFanfareVoices,
  prewarmSharedNoiseBuffer,
} from './synth-voices';

export {
  type AmbientPresetId,
  HAPTIC_MAX_PULSE_MS,
  HAPTIC_MIN_PULSE_MS,
  HAPTIC_PATTERNS,
  type HapticCueId,
  type HapticCueSpec,
  type MusicScene,
};

export const SFX_MASTER_GAIN = 0.85;
export const MUSIC_MASTER_GAIN = 0.36;

export const SFX_VOLUME_GAINS: Readonly<Record<AudioVolumeStep, number>> = {
  0: 0,
  1: 0.5,
  2: SFX_MASTER_GAIN,
  3: 1.0,
};

export const MUSIC_VOLUME_GAINS: Readonly<Record<AudioVolumeStep, number>> = {
  0: 0,
  1: 0.22,
  2: MUSIC_MASTER_GAIN,
  3: 0.48,
};

const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'] as const;
const MOVE_RECOVERY_EVENTS = ['pointermove', 'touchmove'] as const;

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: {
    type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
  };
}

export class SoundEngine {
  public sfxEnabled = true;
  public musicEnabled = true;
  public sfxVolume: AudioVolumeStep = 2;
  public musicVolume: AudioVolumeStep = 2;
  public hapticsEnabled = true;
  public equippedParticle: ParticleStyleId = 'micro_cubes';

  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private unlocked = false;
  private buffersPrewarmed = false;
  private lastSlideTickMs = 0;
  private lastWallClackMs = 0;

  // Mode-attuned drumless warm analog synthwave ambient music controller
  private readonly ambientMusic = new AmbientMusicController();
  private prewarmTimerId: ReturnType<typeof setTimeout> | null = null;
  private prewarmIdleId: number | null = null;
  private isDocumentHidden = false;
  private isWindowBlurred = false;
  private isPageHidden = false;
  private isFrozen = false;

  private readonly boundUnlock: () => void;
  private readonly boundMoveUnlock: () => void;
  private readonly boundVisibilityChange: () => void;
  private readonly boundBlur: () => void;
  private readonly boundFocus: () => void;
  private readonly boundPageHide: () => void;
  private readonly boundPageShow: () => void;
  private readonly boundFreeze: () => void;
  private readonly boundResume: () => void;
  private readonly boundCtxStateChange: () => void;

  constructor(initial?: {
    sfxEnabled?: boolean;
    musicEnabled?: boolean;
    sfxVolume?: AudioVolumeStep;
    musicVolume?: AudioVolumeStep;
    hapticsEnabled?: boolean;
  }) {
    if (initial?.sfxVolume !== undefined) {
      this.sfxVolume = initial.sfxVolume;
      this.sfxEnabled = initial.sfxVolume > 0;
    } else if (initial?.sfxEnabled !== undefined) {
      this.sfxEnabled = initial.sfxEnabled;
      this.sfxVolume = initial.sfxEnabled ? 2 : 0;
    }
    if (initial?.musicVolume !== undefined) {
      this.musicVolume = initial.musicVolume;
      this.musicEnabled = initial.musicVolume > 0;
    } else if (initial?.musicEnabled !== undefined) {
      this.musicEnabled = initial.musicEnabled;
      this.musicVolume = initial.musicEnabled ? 2 : 0;
    }
    if (initial?.hapticsEnabled !== undefined) this.hapticsEnabled = initial.hapticsEnabled;

    this.boundUnlock = () => this.unlock();
    this.boundMoveUnlock = () => {
      if (this.isWindowBlurred && !(typeof document !== 'undefined' && document.hidden)) {
        this.unlock();
      }
    };
    this.boundVisibilityChange = () => this.handleVisibilityChange();
    this.boundBlur = () => {
      this.isWindowBlurred = true;
      this.enterBackground();
    };
    this.boundFocus = () => {
      this.isWindowBlurred = false;
      this.isPageHidden = false;
      this.isFrozen = false;
      this.isDocumentHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;
      this.recoverForeground();
    };
    this.boundPageHide = () => {
      this.isPageHidden = true;
      this.enterBackground();
    };
    this.boundPageShow = () => {
      this.isPageHidden = false;
      this.isFrozen = false;
      this.isWindowBlurred = false;
      this.isDocumentHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;
      this.recoverForeground();
    };
    this.boundFreeze = () => {
      this.isFrozen = true;
      this.enterBackground();
    };
    this.boundResume = () => {
      this.isFrozen = false;
      this.isDocumentHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;
      this.recoverForeground();
    };
    this.boundCtxStateChange = () => {
      if (this.ctx?.state === 'running') {
        this.handleContextRunning();
      }
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.isDocumentHidden = Boolean(document.hidden);
      for (const evt of UNLOCK_EVENTS) {
        window.addEventListener(evt, this.boundUnlock, { capture: true, passive: true });
      }
      for (const evt of MOVE_RECOVERY_EVENTS) {
        window.addEventListener(evt, this.boundMoveUnlock, { capture: true, passive: true });
      }
      window.addEventListener('blur', this.boundBlur);
      window.addEventListener('focus', this.boundFocus);
      window.addEventListener('pagehide', this.boundPageHide);
      window.addEventListener('pageshow', this.boundPageShow);
      window.addEventListener('beforeunload', this.boundPageHide);
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
      document.addEventListener('freeze', this.boundFreeze);
      document.addEventListener('resume', this.boundResume);
      this.syncAudioSessionType();
      this.scheduleIdlePrewarm();
    }
  }

  private isBackgrounded(): boolean {
    return this.isDocumentHidden || this.isWindowBlurred || this.isPageHidden || this.isFrozen;
  }

  private prewarmBuffersOnce(ctx: AudioContext): void {
    if (this.buffersPrewarmed) return;
    this.buffersPrewarmed = true;
    try {
      getOrCreateRelicAwakenNoiseBuffer(ctx);
      prewarmSharedNoiseBuffer(ctx);
    } catch {
      // Ignore on restricted environments
    }
  }

  private handleContextRunning(): void {
    const ctx = this.ctx;
    if (ctx?.state !== 'running') return;
    if (this.isBackgrounded()) {
      // Re-suspend immediately if an async resume() finished after backgrounding or blur
      this.enterBackground();
      return;
    }
    this.unlocked = true;
    this.prewarmBuffersOnce(ctx);
    this.syncAudioSessionType();
    this.restoreMasterGains();
    if (this.musicEnabled) {
      this.startMusicLoop();
    }
  }

  private resumeContext(ctx: AudioContext): void {
    if (this.isBackgrounded()) return;
    if (ctx.state !== 'running' && ctx.state !== 'closed' && typeof ctx.resume === 'function') {
      void ctx
        .resume()
        .then(() => this.handleContextRunning())
        .catch(() => {});
    }
  }

  private scheduleIdlePrewarm(): void {
    if (!this.sfxEnabled && !this.musicEnabled) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    const runPrewarm = () => {
      this.prewarmIdleId = null;
      this.prewarmTimerId = null;
      if (this.ctx || this.isBackgrounded()) return;
      const ctx = this.ensureContext();
      if (!ctx) return;
      this.prewarmBuffersOnce(ctx);
      if (ctx.state === 'running') {
        this.handleContextRunning();
      }
    };
    this.prewarmTimerId = setTimeout(() => {
      this.prewarmTimerId = null;
      const ric = (
        window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
      ).requestIdleCallback;
      if (typeof ric === 'function') {
        this.prewarmIdleId = ric(runPrewarm, { timeout: 600 });
      } else {
        runPrewarm();
      }
    }, 180);
  }

  public destroy(): void {
    this.ambientMusic.destroy();
    if (this.prewarmTimerId !== null) {
      clearTimeout(this.prewarmTimerId);
      this.prewarmTimerId = null;
    }
    if (this.prewarmIdleId !== null && typeof window !== 'undefined') {
      const cancelIdle = (window as unknown as { cancelIdleCallback?: (id: number) => void })
        .cancelIdleCallback;
      if (typeof cancelIdle === 'function') cancelIdle(this.prewarmIdleId);
      this.prewarmIdleId = null;
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      for (const evt of UNLOCK_EVENTS) {
        window.removeEventListener(evt, this.boundUnlock, { capture: true });
      }
      for (const evt of MOVE_RECOVERY_EVENTS) {
        window.removeEventListener(evt, this.boundMoveUnlock, { capture: true });
      }
      window.removeEventListener('blur', this.boundBlur);
      window.removeEventListener('focus', this.boundFocus);
      window.removeEventListener('pagehide', this.boundPageHide);
      window.removeEventListener('pageshow', this.boundPageShow);
      window.removeEventListener('beforeunload', this.boundPageHide);
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
      document.removeEventListener('freeze', this.boundFreeze);
      document.removeEventListener('resume', this.boundResume);
    }
    if (this.ctx) {
      if (typeof this.ctx.removeEventListener === 'function') {
        this.ctx.removeEventListener('statechange', this.boundCtxStateChange);
      }
      if (this.ctx.state !== 'closed' && typeof this.ctx.close === 'function') {
        void this.ctx.close().catch(() => {});
      }
    }
  }

  public setSfxVolume(step: AudioVolumeStep): void {
    this.sfxVolume = step;
    this.sfxEnabled = step > 0;
    this.syncAudioSessionType();
    if (this.sfxGain && this.ctx && !this.isBackgrounded()) {
      this.sfxGain.gain.setTargetAtTime?.(SFX_VOLUME_GAINS[step], this.ctx.currentTime, 0.015);
    }
  }

  public setMusicVolume(step: AudioVolumeStep): void {
    this.musicVolume = step;
    this.musicEnabled = step > 0;
    this.syncAudioSessionType();
    if (this.musicGain && this.ctx && !this.isBackgrounded()) {
      this.musicGain.gain.setTargetAtTime?.(MUSIC_VOLUME_GAINS[step], this.ctx.currentTime, 0.08);
    }
    if (this.musicEnabled && this.unlocked && !this.isBackgrounded()) {
      if (this.ctx && this.ctx.state !== 'running') {
        this.resumeContext(this.ctx);
      } else {
        this.startMusicLoop();
      }
    } else if (!this.musicEnabled) {
      this.stopMusicLoop();
    }
  }

  public setSfxEnabled(enabled: boolean): void {
    this.setSfxVolume(enabled ? (this.sfxVolume > 0 ? this.sfxVolume : 2) : 0);
  }

  public setMusicEnabled(enabled: boolean): void {
    this.setMusicVolume(enabled ? (this.musicVolume > 0 ? this.musicVolume : 2) : 0);
  }

  public setMusicScene(scene: MusicScene): void {
    const playing =
      this.musicEnabled && this.unlocked && !this.isBackgrounded() && this.ambientMusic.isRunning();
    this.ambientMusic.setScene(scene, this.ctx, this.musicGain, playing);
  }

  public getMusicScene(): MusicScene {
    return this.ambientMusic.getScene();
  }

  public getActiveMusicPreset(): AmbientPresetId {
    return this.ambientMusic.getActivePresetId();
  }

  public setHapticsEnabled(enabled: boolean): void {
    this.hapticsEnabled = enabled;
  }

  public updateSettings(settings: {
    sfxEnabled?: boolean;
    musicEnabled?: boolean;
    sfxVolume?: AudioVolumeStep;
    musicVolume?: AudioVolumeStep;
    hapticsEnabled?: boolean;
    equippedParticle?: ParticleStyleId;
    musicScene?: MusicScene;
  }): void {
    if (settings.sfxVolume !== undefined) this.setSfxVolume(settings.sfxVolume);
    else if (settings.sfxEnabled !== undefined) this.setSfxEnabled(settings.sfxEnabled);
    if (settings.musicScene !== undefined) this.setMusicScene(settings.musicScene);
    if (settings.musicVolume !== undefined) this.setMusicVolume(settings.musicVolume);
    else if (settings.musicEnabled !== undefined) this.setMusicEnabled(settings.musicEnabled);
    if (settings.hapticsEnabled !== undefined) this.setHapticsEnabled(settings.hapticsEnabled);
    if (settings.equippedParticle !== undefined) this.equippedParticle = settings.equippedParticle;
  }

  /**
   * UX-05: Configure iOS 17+ `navigator.audioSession.type = 'playback'` while active in the foreground,
   * and demote to `'ambient'` whenever audio is disabled or the app loses focus/visibility.
   */
  private syncAudioSessionType(): void {
    if (typeof navigator === 'undefined') return;
    try {
      const nav = navigator as NavigatorWithAudioSession;
      if (nav.audioSession) {
        const activeForegroundAudio = (this.sfxEnabled || this.musicEnabled) && !this.isBackgrounded();
        nav.audioSession.type = activeForegroundAudio ? 'playback' : 'ambient';
      }
    } catch {
      // Ignore on unsupported browsers
    }
  }

  private muteMasterGainsImmediate(): void {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const node of [this.sfxGain, this.musicGain]) {
      if (!node) continue;
      node.gain.cancelScheduledValues?.(now);
      node.gain.setValueAtTime?.(0, now);
      node.gain.value = 0;
    }
  }

  private restoreMasterGains(): void {
    if (!this.ctx || this.isBackgrounded()) return;
    const now = this.ctx.currentTime;
    const targetSfx = SFX_VOLUME_GAINS[this.sfxEnabled ? this.sfxVolume : 0];
    const targetMusic = MUSIC_VOLUME_GAINS[this.musicEnabled ? this.musicVolume : 0];
    if (this.sfxGain) {
      this.sfxGain.gain.cancelScheduledValues?.(now);
      if (typeof this.sfxGain.gain.setTargetAtTime === 'function') {
        this.sfxGain.gain.setTargetAtTime(targetSfx, now, 0.015);
      } else {
        this.sfxGain.gain.value = targetSfx;
      }
    }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues?.(now);
      if (typeof this.musicGain.gain.setTargetAtTime === 'function') {
        this.musicGain.gain.setTargetAtTime(targetMusic, now, 0.06);
      } else {
        this.musicGain.gain.value = targetMusic;
      }
    }
  }

  private enterBackground(): void {
    this.ambientMusic.stopImmediate();
    this.muteMasterGainsImmediate();
    this.syncAudioSessionType();
    if (this.ctx && this.ctx.state !== 'closed' && typeof this.ctx.suspend === 'function') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  private recoverForeground(): void {
    if (this.isBackgrounded()) return;
    this.syncAudioSessionType();
    this.restoreMasterGains();
    if (!this.unlocked) return;
    if (this.ctx && this.ctx.state !== 'running') {
      this.resumeContext(this.ctx);
    } else if (this.musicEnabled) {
      this.startMusicLoop();
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
      const backgrounded = this.isBackgrounded();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = backgrounded ? 0 : SFX_VOLUME_GAINS[this.sfxEnabled ? this.sfxVolume : 0];
      this.sfxGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = backgrounded
        ? 0
        : MUSIC_VOLUME_GAINS[this.musicEnabled ? this.musicVolume : 0];
      this.musicGain.connect(this.ctx.destination);
      if (typeof this.ctx.addEventListener === 'function') {
        this.ctx.addEventListener('statechange', this.boundCtxStateChange);
      }
    } catch {
      return null;
    }

    return this.ctx;
  }

  public unlock(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    this.isWindowBlurred = false;
    this.isPageHidden = false;
    this.isFrozen = false;

    if (this.unlocked && this.ctx?.state === 'running') {
      this.syncAudioSessionType();
      this.restoreMasterGains();
      if (this.musicEnabled && !this.isBackgrounded() && !this.ambientMusic.isRunning()) {
        this.startMusicLoop();
      }
      return;
    }

    this.unlocked = true;
    this.syncAudioSessionType();
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.prewarmBuffersOnce(ctx);
    if (ctx.state === 'running') {
      this.handleContextRunning();
      return;
    }

    // Play a silent 1-sample warm-up pulse on each user gesture until ctx becomes running
    // so iOS WebKit unlocks even when pointerdown alone is ignored before touchend/click.
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Ignore
    }
    this.resumeContext(ctx);
  }

  private handleVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    this.isDocumentHidden = Boolean(document.hidden);
    if (this.isDocumentHidden) {
      this.enterBackground();
    } else {
      // Returning to a mobile browser tab/PWA often emits visibilitychange without window.focus
      this.isWindowBlurred = false;
      this.isPageHidden = false;
      this.isFrozen = false;
      this.recoverForeground();
    }
  }

  private getReadySfx(): { ctx: AudioContext; sfxGain: GainNode } | null {
    if (!this.sfxEnabled || this.isBackgrounded()) return null;
    const ctx = this.ensureContext();
    const sfxGain = this.sfxGain;
    if (!ctx || !sfxGain) return null;
    if (ctx.state !== 'running') {
      this.resumeContext(ctx);
      if (ctx.currentTime === 0) return null;
    }
    return { ctx, sfxGain };
  }

  /**
   * Triggers Android vibration or WebKit/iOS sub-bass acoustic-haptic transient (`HAPTICS-01`).
   */
  public triggerHaptic(pattern: number | number[] = 12, subBassFreq = 62): boolean {
    return dispatchHapticFeedback({
      hapticsEnabled: this.hapticsEnabled,
      backgrounded: this.isBackgrounded(),
      sfxEnabled: this.sfxEnabled,
      pattern,
      subBassFreq,
      getRunningSfx: () => {
        const ctx = this.ensureContext();
        if (!ctx || !this.sfxGain || ctx.state !== 'running') return null;
        return { ctx, sfxGain: this.sfxGain };
      },
    });
  }

  private triggerCueHaptic(cue: HapticCueId): void {
    const spec = HAPTIC_PATTERNS[cue];
    this.triggerHaptic(spec.pattern, spec.subBassFreq);
  }

  /**
   * 1. Block Pickup (`pointerdown` on movable block):
   * Warm marimba-like wooden pop (`180 Hz -> 420 Hz`, `45 ms` exponential decay) + `14 ms` haptic pulse.
   */
  public playPickup(): void {
    this.triggerCueHaptic('pickup');
    const ready = this.getReadySfx();
    if (ready) playPickupVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 2. Grid Cell Slide Tick (crossing integer cell boundary while dragging):
   * Subtle hollow bamboo tick (`640 Hz` bandpass burst, `18 ms`, rate-limited to `>= 28 ms`).
   */
  public playSlideTick(): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastSlideTickMs < 28) return;
    this.lastSlideTickMs = nowMs;

    this.triggerCueHaptic('slideTick');
    const ready = this.getReadySfx();
    if (ready) playSlideTickVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 3. Obstacle / Wall Clack (block contacts wall, obstacle, or tapping an immobile block):
   * Dull muted thud (`110 Hz` triangle + low-pass impulse, `35 ms`).
   */
  public playWallClack(): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastWallClackMs < 60) return;
    this.lastWallClackMs = nowMs;

    this.triggerCueHaptic('wallClack');
    const ready = this.getReadySfx();
    if (ready) playWallClackVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 4. Grid Snap (`pointerup` settling into integer grid cell):
   * Clean magnetic click (`520 Hz -> 260 Hz`, `22 ms`).
   */
  public playSnap(): void {
    this.triggerCueHaptic('snap');
    const ready = this.getReadySfx();
    if (ready) playSnapVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 5. Shredder Gate Grind + Pop (block Shreds through matching Gate):
   * Crisp rhythmic series of `8` ascending xylophone/marimba micro-grains (`320 Hz .. 960 Hz`)
   * + filtered white-noise mechanical whirr + staggered haptic buzz (`[14, 18, 14] ms`).
   */
  public playShred(
    cascadeIndex = 0,
    style: ParticleStyleId = this.equippedParticle,
    isFinalClear = false
  ): void {
    this.triggerCueHaptic(isFinalClear ? 'shredFinalClear' : 'shred');
    const ready = this.getReadySfx();
    if (!ready) return;
    const pitchScale = 2 ** (Math.min(12, Math.max(0, cascadeIndex + (isFinalClear ? 2 : 0))) / 12);
    playStyledShredSoundscape(
      ready.ctx,
      ready.sfxGain,
      ready.ctx.currentTime,
      pitchScale,
      style,
      isFinalClear,
      false
    );
  }

  public playParticlePreview(style: ParticleStyleId): void {
    this.triggerCueHaptic('particlePreview');
    const ready = this.getReadySfx();
    if (ready) {
      playStyledShredSoundscape(ready.ctx, ready.sfxGain, ready.ctx.currentTime, 1.0, style, false, true);
    }
  }

  /**
   * 6. Multi-Layer Shell Peel (outer layer shreds off, inner core remains):
   * Crisp zipper/pop arpeggio (`440 Hz -> 660 Hz -> 880 Hz`, `90 ms`).
   */
  public playLayerPeel(): void {
    this.triggerCueHaptic('layerPeel');
    const ready = this.getReadySfx();
    if (ready) playLayerPeelVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 7. Ice Crack / Shatter:
   * High-frequency crystalline FM chime (`1800 Hz + 2450 Hz` inharmonic partials, `65 ms`).
   */
  public playIceCrack(): void {
    this.triggerCueHaptic('iceCrack');
    const ready = this.getReadySfx();
    if (ready) playIceCrackVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 8. Key / Lock / Scissors / Shutter Unlock:
   * Metallic tumbler click + warm fifth (`587 Hz -> 880 Hz`, `110 ms`).
   */
  public playLockOpen(): void {
    this.triggerCueHaptic('lockOpen');
    const ready = this.getReadySfx();
    if (ready) playLockOpenVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 9. Booster Activation (Hammer, Rocket, Vacuum, Hint, Undo):
   * Distinct procedural sound signature per booster.
   */
  public playBooster(type: BoosterType = 'HAMMER'): void {
    this.triggerCueHaptic('booster');
    const ready = this.getReadySfx();
    if (!ready) return;
    playBoosterVoice(ready.ctx, ready.sfxGain, type, () => this.playIceCrack());
  }

  /**
   * 10. Level Win Fanfare:
   * Upbeat, joyful 3-voice celebratory victory fanfare:
   * - Voice 1: Syncopated marimba & bell lead melody (`C5 -> E5 -> G5 -> C6 -> A5 -> B5 -> C6 -> D6 -> E6 -> G6`)
   * - Voice 2: Lush twilight sanctuary harmonic chord progression (`Fmaj9 -> G13 -> Cmaj9`)
   * - Voice 3: Upbeat bass groove + sparkling star-pop crystalline chimes (`C7 -> E7 -> G7`)
   */
  public playWinFanfare(earnedStars = 3): void {
    this.triggerCueHaptic('winFanfare');
    if ((!this.sfxEnabled && !this.musicEnabled) || this.isBackgrounded()) return;
    const ctx = this.ensureContext();
    const outGain = this.sfxEnabled ? this.sfxGain : this.musicGain;
    if (!ctx || !outGain) return;
    if (ctx.state !== 'running') {
      this.resumeContext(ctx);
      if (ctx.currentTime === 0) return;
    }

    playWinFanfareVoices(ctx, outGain, earnedStars);
  }

  /**
   * 10b. Under-Par Oracle Chime (`UNDER-PAR-ORACLE-01`):
   * Shimmering Lydian `#11` astral bell cascade layered over the win fanfare when beating Par booster-free.
   */
  public playUnderParOracleChime(): void {
    this.triggerCueHaptic('underParOracle');
    if ((!this.sfxEnabled && !this.musicEnabled) || this.isBackgrounded()) return;
    const ctx = this.ensureContext();
    const outGain = this.sfxEnabled ? this.sfxGain : this.musicGain;
    if (!ctx || !outGain) return;
    if (ctx.state !== 'running') {
      this.resumeContext(ctx);
      if (ctx.currentTime === 0) return;
    }

    playUnderParOracleVoice(ctx, outGain);
  }

  /**
   * 11. Level Loss / Out of Time:
   * Gentle, non-startling descending soft synth chord (`G4 - Eb4 - C4`).
   */
  public playLossBuzzer(): void {
    this.triggerCueHaptic('lossBuzzer');
    const ready = this.getReadySfx();
    if (!ready) return;
    playLossBuzzerVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * Convenience UI button tap sound.
   */
  public playButtonTap(): void {
    this.triggerCueHaptic('buttonTap');
    const ready = this.getReadySfx();
    if (!ready) return;
    playButtonTapVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * 12. Relic Awakening (`RELIC-AWAKEN-01`, Title Screen -> Gameplay):
   * Deep sustained tectonic stone-break rumble + warm swept whoosh/swish (zero bells, dings, or harsh highs).
   */
  public playRelicAwaken(): void {
    this.triggerCueHaptic('relicAwaken');
    const ready = this.getReadySfx();
    if (!ready) return;
    playRelicAwakenVoice(ready.ctx, ready.sfxGain);
  }

  /**
   * Starts the Mode-Attuned Drumless Warm Analog Synthwave lookahead scheduler (`AMBIENT-MUSIC-01`).
   */
  private startMusicLoop(): void {
    if (!this.musicEnabled || this.isBackgrounded()) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.musicGain || ctx.state !== 'running') return;
    this.ambientMusic.start(ctx, this.musicGain);
  }

  private stopMusicLoop(): void {
    this.ambientMusic.stop();
  }
}
