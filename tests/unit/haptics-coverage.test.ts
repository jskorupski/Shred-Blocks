import { describe, expect, it, vi } from 'vitest';
import {
  HAPTIC_MAX_PULSE_MS,
  HAPTIC_MIN_PULSE_MS,
  HAPTIC_PATTERNS,
  SoundEngine,
} from '../../src/audio/synth';
import { decodeSaveCode, encodeSaveCode, validateSavePayloadV1 } from '../../src/storage/save-code';
import { createDefaultSavePayload, SaveManager } from '../../src/storage/save-manager';

interface HapticTestEnv {
  docState: { hidden: boolean };
  vibrateSpy: ReturnType<typeof vi.fn>;
  nowMs: { value: number };
  oscStarts: Array<{ startFreq: number }>;
  emitWindow: (type: string) => void;
  emitDoc: (type: string) => void;
}

function createHapticsMockEnv(options?: {
  hasVibrate?: boolean;
  vibrateReturn?: boolean | 'throw';
  ctxState?: AudioContextState;
}): HapticTestEnv {
  const windowListeners = new Map<string, Set<() => void>>();
  const docListeners = new Map<string, Set<() => void>>();
  const docState = { hidden: false };
  const nowMs = { value: 1000 };
  const oscStarts: Array<{ startFreq: number }> = [];
  const vibrateReturn = options?.vibrateReturn ?? true;
  const ctxState = options?.ctxState ?? 'running';

  const vibrateSpy = vi.fn((_pattern: number | number[]) => {
    if (vibrateReturn === 'throw') {
      throw new Error('Blocked by hardware policy');
    }
    return vibrateReturn;
  });

  const makeParam = (onSet?: (v: number) => void) => ({
    value: 0,
    setValueAtTime: vi.fn((v: number) => onSet?.(v)),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  const mockCtx = {
    currentTime: 2.0,
    sampleRate: 44100,
    destination: {},
    state: ctxState,
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createGain: () => ({
      gain: makeParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createBuffer: (_ch: number, len: number) => ({
      length: len,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => ({
      buffer: null,
      playbackRate: makeParam(),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createOscillator: () => {
      const record = { startFreq: 0 };
      return {
        type: 'sine',
        frequency: makeParam((f) => {
          if (record.startFreq === 0) {
            record.startFreq = f;
            oscStarts.push(record);
          }
        }),
        detune: makeParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
    },
  };

  vi.stubGlobal('window', {
    AudioContext: class {
      constructor() {
        Object.defineProperties(this, Object.getOwnPropertyDescriptors(mockCtx));
      }
    },
    addEventListener: (t: string, cb: () => void) => {
      const set = windowListeners.get(t) ?? new Set();
      set.add(cb);
      windowListeners.set(t, set);
    },
    removeEventListener: (t: string, cb: () => void) => {
      windowListeners.get(t)?.delete(cb);
    },
    requestAnimationFrame: () => 0,
  });
  vi.stubGlobal('document', {
    get hidden() {
      return docState.hidden;
    },
    addEventListener: (t: string, cb: () => void) => {
      const set = docListeners.get(t) ?? new Set();
      set.add(cb);
      docListeners.set(t, set);
    },
    removeEventListener: (t: string, cb: () => void) => {
      docListeners.get(t)?.delete(cb);
    },
  });
  vi.stubGlobal('performance', {
    now: () => nowMs.value,
  });
  if (options?.hasVibrate === false) {
    vi.stubGlobal('navigator', {});
  } else {
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
  }

  return {
    docState,
    vibrateSpy,
    nowMs,
    oscStarts,
    emitWindow: (type: string) => {
      for (const cb of windowListeners.get(type) ?? []) cb();
    },
    emitDoc: (type: string) => {
      for (const cb of docListeners.get(type) ?? []) cb();
    },
  };
}

const SOUND_PLAY_INVOCATIONS: Record<string, (engine: SoundEngine) => void> = {
  playPickup: (e) => e.playPickup(),
  playSlideTick: (e) => e.playSlideTick(),
  playWallClack: (e) => e.playWallClack(),
  playSnap: (e) => e.playSnap(),
  playShred: (e) => e.playShred(0, 'micro_cubes', false),
  playParticlePreview: (e) => e.playParticlePreview('star_confetti'),
  playLayerPeel: (e) => e.playLayerPeel(),
  playIceCrack: (e) => e.playIceCrack(),
  playLockOpen: (e) => e.playLockOpen(),
  playBooster: (e) => e.playBooster('HINT'),
  playWinFanfare: (e) => e.playWinFanfare(3),
  playUnderParOracleChime: (e) => e.playUnderParOracleChime(),
  playLossBuzzer: (e) => e.playLossBuzzer(),
  playButtonTap: (e) => e.playButtonTap(),
  playRelicAwaken: (e) => e.playRelicAwaken(),
};

describe('HAPTICS-01: Defensive Haptics Coverage, Calibration & Lifecycle Audit', () => {
  it('enforces LRA-perceptible pulse durations (>= 10ms, <= 100ms) and covers 100% of SoundEngine.play* methods', () => {
    for (const [cue, spec] of Object.entries(HAPTIC_PATTERNS)) {
      const seq = Array.isArray(spec.pattern) ? spec.pattern : [spec.pattern];
      expect(seq.length, `${cue} pattern non-empty`).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < seq.length; i++) {
        const ms = seq[i];
        if (i % 2 === 0) {
          expect(ms, `${cue} active pulse[${i}] >= ${HAPTIC_MIN_PULSE_MS}ms`).toBeGreaterThanOrEqual(
            HAPTIC_MIN_PULSE_MS
          );
          expect(ms, `${cue} active pulse[${i}] <= ${HAPTIC_MAX_PULSE_MS}ms`).toBeLessThanOrEqual(
            HAPTIC_MAX_PULSE_MS
          );
        } else {
          expect(ms, `${cue} gap[${i}] > 0ms`).toBeGreaterThan(0);
          expect(ms, `${cue} gap[${i}] <= ${HAPTIC_MAX_PULSE_MS}ms`).toBeLessThanOrEqual(HAPTIC_MAX_PULSE_MS);
        }
      }
    }

    const protoPlayMethods = Object.getOwnPropertyNames(SoundEngine.prototype)
      .filter((name) => name.startsWith('play'))
      .sort();
    expect(protoPlayMethods).toEqual(Object.keys(SOUND_PLAY_INVOCATIONS).sort());

    const env = createHapticsMockEnv();
    try {
      const sound = new SoundEngine({ sfxVolume: 2, musicVolume: 0, hapticsEnabled: true });
      sound.unlock();
      for (const methodName of protoPlayMethods) {
        env.vibrateSpy.mockClear();
        env.nowMs.value += 100;
        SOUND_PLAY_INVOCATIONS[methodName](sound);
        expect(env.vibrateSpy, `${methodName} must invoke navigator.vibrate`).toHaveBeenCalledTimes(1);
      }

      // Final-clear shred elevates to the celebratory finale pattern
      env.vibrateSpy.mockClear();
      sound.playShred(0, 'micro_cubes', true);
      expect(env.vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.shredFinalClear.pattern);
      sound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps haptics active when SFX is muted (sfxVolume: 0) and hard-silences every method when hapticsEnabled is false', () => {
    const env = createHapticsMockEnv();
    try {
      const mutedSfxSound = new SoundEngine({ sfxVolume: 0, musicVolume: 0, hapticsEnabled: true });
      expect(mutedSfxSound.sfxEnabled).toBe(false);
      for (const [methodName, invoke] of Object.entries(SOUND_PLAY_INVOCATIONS)) {
        env.vibrateSpy.mockClear();
        env.nowMs.value += 100;
        invoke(mutedSfxSound);
        expect(env.vibrateSpy, `${methodName} must vibrate even when SFX is muted`).toHaveBeenCalledTimes(1);
      }

      // Turning haptics OFF suppresses 100% of cues (including playRelicAwaken & direct triggerHaptic)
      mutedSfxSound.updateSettings({ sfxVolume: 3, hapticsEnabled: false });
      mutedSfxSound.unlock();
      env.vibrateSpy.mockClear();
      env.oscStarts.length = 0;
      for (const [methodName, invoke] of Object.entries(SOUND_PLAY_INVOCATIONS)) {
        env.nowMs.value += 100;
        invoke(mutedSfxSound);
        expect(env.vibrateSpy, `${methodName} must not vibrate when haptics disabled`).not.toHaveBeenCalled();
      }
      env.oscStarts.length = 0;
      expect(mutedSfxSound.triggerHaptic([16, 20], 64)).toBe(false);
      expect(env.vibrateSpy).not.toHaveBeenCalled();
      expect(env.oscStarts).toHaveLength(0);
      mutedSfxSound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('respects slide/clack throttles, background locks, and self-heals spurious window.blur during pointer/touch drags', () => {
    const env = createHapticsMockEnv();
    try {
      const sound = new SoundEngine({ sfxVolume: 2, musicVolume: 0, hapticsEnabled: true });
      sound.unlock();

      // playSlideTick: >= 28ms throttle; playWallClack: >= 60ms throttle
      sound.playSlideTick();
      env.nowMs.value += 15;
      sound.playSlideTick();
      env.nowMs.value += 20;
      sound.playSlideTick();
      expect(env.vibrateSpy).toHaveBeenCalledTimes(2);

      env.vibrateSpy.mockClear();
      sound.playWallClack();
      env.nowMs.value += 40;
      sound.playWallClack();
      env.nowMs.value += 25;
      sound.playWallClack();
      expect(env.vibrateSpy).toHaveBeenCalledTimes(2);

      // Spurious window.blur while document stays visible self-heals on pointermove / touchmove / touchstart
      for (const recoveryEvt of ['pointermove', 'touchmove', 'touchstart'] as const) {
        env.vibrateSpy.mockClear();
        env.emitWindow('blur');
        sound.playButtonTap();
        expect(env.vibrateSpy).not.toHaveBeenCalled();

        env.emitWindow(recoveryEvt);
        env.nowMs.value += 100;
        sound.playSlideTick();
        expect(env.vibrateSpy, `${recoveryEvt} should recover from spurious blur`).toHaveBeenCalledTimes(1);
      }

      // True background (document.hidden === true, pagehide, freeze) must stay suppressed even on touchmove
      env.vibrateSpy.mockClear();
      env.docState.hidden = true;
      env.emitDoc('visibilitychange');
      env.emitWindow('touchmove');
      env.emitWindow('touchstart');
      sound.playPickup();
      sound.playRelicAwaken();
      expect(env.vibrateSpy).not.toHaveBeenCalled();

      env.docState.hidden = false;
      env.emitDoc('visibilitychange');
      env.emitWindow('pagehide');
      sound.playButtonTap();
      expect(env.vibrateSpy).not.toHaveBeenCalled();

      env.emitWindow('pageshow');
      env.emitDoc('freeze');
      sound.playButtonTap();
      expect(env.vibrateSpy).not.toHaveBeenCalled();
      sound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses WebKit sub-bass speaker fallback cleanly when navigator.vibrate is missing or throws, without crashing when SFX is off', () => {
    const iosEnv = createHapticsMockEnv({ hasVibrate: false, ctxState: 'running' });
    try {
      const iosSound = new SoundEngine({ sfxVolume: 2, musicVolume: 0, hapticsEnabled: true });
      iosSound.unlock();
      iosEnv.oscStarts.length = 0;

      expect(iosSound.triggerHaptic(14, 72)).toBe(false);
      expect(iosEnv.oscStarts).toEqual([{ startFreq: 72 }]);

      // If haptics are turned off on iOS, fallback oscillator never fires even with SFX ON
      iosSound.setHapticsEnabled(false);
      iosEnv.oscStarts.length = 0;
      expect(iosSound.triggerHaptic(14, 72)).toBe(false);
      expect(iosEnv.oscStarts).toHaveLength(0);
      iosSound.setHapticsEnabled(true);

      // If SFX is off on iOS, triggerHaptic silently skips without allocating fallback oscillators
      iosSound.setSfxVolume(0);
      iosEnv.oscStarts.length = 0;
      iosSound.playRelicAwaken();
      expect(iosEnv.oscStarts).toHaveLength(0);
      iosSound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }

    const throwingEnv = createHapticsMockEnv({ vibrateReturn: 'throw', ctxState: 'running' });
    try {
      const sound = new SoundEngine({ sfxVolume: 2, musicVolume: 0, hapticsEnabled: true });
      sound.unlock();
      throwingEnv.oscStarts.length = 0;
      expect(() => sound.playRelicAwaken()).not.toThrow();
      expect(throwingEnv.oscStarts.some((o) => o.startFreq === HAPTIC_PATTERNS.relicAwaken.subBassFreq)).toBe(
        true
      );
      sound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults hapticsEnabled to true and round-trips false/true losslessly across SaveManager & SB1 codecs', () => {
    expect(createDefaultSavePayload().settings.hapticsEnabled).toBe(true);
    expect(
      validateSavePayloadV1({
        schemaVersion: 1,
        appId: 'shredblocks-color-jam',
        writeSeq: 1,
        highestLevelUnlocked: 1,
        coins: 0,
        boosters: {},
        settings: {},
        levelRecords: {},
      }).settings.hapticsEnabled
    ).toBe(true);

    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    try {
      const manager = new SaveManager();
      expect(manager.getPayload().settings.hapticsEnabled).toBe(true);

      manager.updateSettings({ hapticsEnabled: false, sfxVolume: 0 });
      const reloaded = new SaveManager();
      expect(reloaded.getPayload().settings.hapticsEnabled).toBe(false);
      expect(reloaded.getPayload().settings.sfxVolume).toBe(0);

      for (const qrCompact of [false, true] as const) {
        const disabledCode = encodeSaveCode(reloaded.getPayload(), { qrCompact });
        const decodedOff = decodeSaveCode(disabledCode);
        expect(decodedOff.settings.hapticsEnabled).toBe(false);
        expect(decodedOff.settings.sfxVolume).toBe(0);

        reloaded.updateSettings({ hapticsEnabled: true });
        const enabledCode = encodeSaveCode(reloaded.getPayload(), { qrCompact });
        const decodedOn = decodeSaveCode(enabledCode);
        expect(decodedOn.settings.hapticsEnabled).toBe(true);
        reloaded.updateSettings({ hapticsEnabled: false });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
