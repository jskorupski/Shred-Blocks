import { describe, expect, it, vi } from 'vitest';
import { AmbientMusicController } from '../../src/audio/ambient-music';
import {
  MUSIC_MASTER_GAIN,
  MUSIC_VOLUME_GAINS,
  SFX_MASTER_GAIN,
  SFX_VOLUME_GAINS,
  SoundEngine,
} from '../../src/audio/synth';

function createMockSoundDomEnv(initialState: AudioContextState) {
  const listeners = new Map<string, Set<() => void>>();
  const windowListeners = new Map<string, Set<() => void>>();
  const docListeners = new Map<string, Set<() => void>>();
  const stateRef = { value: initialState };
  const docState = { hidden: false };
  const audioSession = { type: 'auto' };
  const vibrateSpy = vi.fn((_pattern: number | number[]) => true);
  let lastCtorOptions: AudioContextOptions | undefined;
  let resumeCount = 0;
  let silentBufferCount = 0;

  const sfxGainNode = {
    gain: {
      value: 0,
      setValueAtTime: vi.fn((v: number) => {
        sfxGainNode.gain.value = v;
      }),
      setTargetAtTime: vi.fn((v: number) => {
        sfxGainNode.gain.value = v;
      }),
      cancelScheduledValues: vi.fn(),
      cancelAndHoldAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const musicGainNode = {
    gain: {
      value: 0,
      setValueAtTime: vi.fn((v: number) => {
        musicGainNode.gain.value = v;
      }),
      setTargetAtTime: vi.fn((v: number) => {
        musicGainNode.gain.value = v;
      }),
      cancelScheduledValues: vi.fn(),
      cancelAndHoldAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  let gainCall = 0;
  const mockParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });

  const mockCtx = {
    currentTime: 1.5,
    sampleRate: 44100,
    destination: {},
    get state() {
      return stateRef.value;
    },
    resume: vi.fn(() => {
      resumeCount += 1;
      stateRef.value = 'running';
      return Promise.resolve();
    }),
    suspend: vi.fn(() => {
      stateRef.value = 'suspended';
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    addEventListener: (t: string, cb: () => void) => {
      const set = listeners.get(t) ?? new Set();
      set.add(cb);
      listeners.set(t, set);
    },
    removeEventListener: (t: string, cb: () => void) => {
      listeners.get(t)?.delete(cb);
    },
    createGain: () => {
      gainCall += 1;
      if (gainCall === 1) return sfxGainNode;
      if (gainCall === 2) return musicGainNode;
      return { gain: mockParam(), connect: vi.fn(), disconnect: vi.fn() };
    },
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: mockParam(),
      Q: mockParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createDelay: () => ({
      delayTime: mockParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createDynamicsCompressor: () => ({
      threshold: mockParam(),
      ratio: mockParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createStereoPanner: () => ({
      pan: mockParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createBuffer: (_ch: number, len: number, sampleRate: number) => ({
      length: len,
      sampleRate,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => ({
      buffer: null as { length: number } | null,
      connect: vi.fn(),
      start: vi.fn(() => {
        silentBufferCount += 1;
      }),
      stop: vi.fn(),
    }),
    createOscillator: () => ({
      type: 'sine',
      frequency: mockParam(),
      detune: mockParam(),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
  };

  vi.stubGlobal('window', {
    AudioContext: class {
      constructor(opts?: AudioContextOptions) {
        lastCtorOptions = opts;
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
  vi.stubGlobal('navigator', { audioSession, vibrate: vibrateSpy });

  return {
    sfxGainNode,
    musicGainNode,
    stateRef,
    docState,
    audioSession,
    vibrateSpy,
    listeners,
    windowListeners,
    docListeners,
    emitWindow: (t: string) => {
      for (const cb of windowListeners.get(t) ?? []) cb();
    },
    emitDoc: (t: string) => {
      for (const cb of docListeners.get(t) ?? []) cb();
    },
    getStats: () => ({ resumeCount, silentBufferCount, lastCtorOptions }),
  };
}

describe('Audio Unlock Gaps & 4-State Stepped Sanctuary Volume Controls', () => {
  it('defines gentle ear-safe Level 2 defaults and stepped Level 1..3 gain curves', () => {
    expect(SFX_MASTER_GAIN).toBe(0.85);
    expect(MUSIC_MASTER_GAIN).toBe(0.36);
    expect(SFX_VOLUME_GAINS).toEqual({ 0: 0, 1: 0.5, 2: 0.85, 3: 1.0 });
    expect(MUSIC_VOLUME_GAINS).toEqual({ 0: 0, 1: 0.22, 2: 0.36, 3: 0.48 });

    const { sfxGainNode, musicGainNode } = createMockSoundDomEnv('running');
    try {
      const sound = new SoundEngine();
      sound.unlock();
      expect(sound.sfxVolume).toBe(2);
      expect(sound.musicVolume).toBe(2);
      expect(sfxGainNode.gain.value).toBeCloseTo(0.85);
      expect(musicGainNode.gain.value).toBeCloseTo(0.36);

      sound.setSfxVolume(1);
      sound.setMusicVolume(3);
      expect(sfxGainNode.gain.value).toBeCloseTo(0.5);
      expect(musicGainNode.gain.value).toBeCloseTo(0.48);

      sound.setMusicVolume(0);
      expect(sound.musicEnabled).toBe(false);
      expect(musicGainNode.gain.value).toBe(0);

      sound.setMusicEnabled(true);
      expect(sound.musicVolume).toBe(2);
      expect(musicGainNode.gain.value).toBeCloseTo(0.36);
      sound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('auto-starts Title music on statechange -> running, retries locked gestures, and recovers interrupted iOS audio', async () => {
    const env = createMockSoundDomEnv('suspended');
    try {
      const sound = new SoundEngine();
      // Ensures gesture & drag-recovery listeners span touch/pointer/keyboard events
      for (const evt of [
        'pointerdown',
        'pointerup',
        'touchstart',
        'touchend',
        'click',
        'keydown',
        'pointermove',
        'touchmove',
      ]) {
        expect(env.windowListeners.has(evt)).toBe(true);
      }

      // Trigger prewarm without user gesture: remains suspended initially
      (sound as unknown as { ensureContext: () => AudioContext }).ensureContext();
      expect((sound as unknown as { unlocked: boolean }).unlocked).toBe(false);

      // Browser asynchronously promotes context to 'running' (Chromium MEI / permitted PWA autoplay)
      env.stateRef.value = 'running';
      for (const cb of env.listeners.get('statechange') ?? []) cb();
      expect((sound as unknown as { unlocked: boolean }).unlocked).toBe(true);
      expect(
        (sound as unknown as { ambientMusic: { isRunning: () => boolean } }).ambientMusic.isRunning()
      ).toBe(true);

      // Simulate iOS Safari audio interruption (alarm/Siri/lock-screen): pointerdown fires, then touchend/resume restores running
      env.stateRef.value = 'interrupted' as AudioContextState;
      const before = env.getStats();
      sound.unlock();
      await Promise.resolve();
      const after = env.getStats();
      expect(after.silentBufferCount).toBe(before.silentBufferCount + 1);
      expect(after.resumeCount).toBe(before.resumeCount + 1);
      expect(env.stateRef.value).toBe('running');

      // Fast-path skip once already running (zero warm-up allocations per tap)
      sound.unlock();
      expect(env.getStats().silentBufferCount).toBe(after.silentBufferCount);
      sound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('immediately silences and suspends audio on visibilitychange, window blur, freeze, pagehide, beforeunload, and late in-flight resume races, then recovers on foreground return', async () => {
    const env = createMockSoundDomEnv('running');
    try {
      const sound = new SoundEngine();
      const ambient = (sound as unknown as { ambientMusic: { isRunning: () => boolean } }).ambientMusic;
      sound.unlock();
      expect(ambient.isRunning()).toBe(true);
      expect(env.musicGainNode.gain.value).toBeCloseTo(0.36);
      expect(env.sfxGainNode.gain.value).toBeCloseTo(0.85);
      expect(env.audioSession.type).toBe('playback');

      // 1. Window blur (switching to Chrome / Recents / another app) hard-mutes & suspends immediately
      env.emitWindow('blur');
      expect(ambient.isRunning()).toBe(false);
      expect(env.musicGainNode.gain.value).toBe(0);
      expect(env.sfxGainNode.gain.value).toBe(0);
      expect(env.audioSession.type).toBe('ambient');
      expect(env.stateRef.value).toBe('suspended');

      // Delayed cascade SFX or fanfare fired while blurred must never wake or vibrate
      const statsWhileBlurred = env.getStats();
      env.vibrateSpy.mockClear();
      sound.playShred(0);
      sound.playWinFanfare(3);
      expect(env.getStats().resumeCount).toBe(statsWhileBlurred.resumeCount);
      expect(env.vibrateSpy).not.toHaveBeenCalled();
      expect(ambient.isRunning()).toBe(false);

      // Returning focus restores gains, audioSession, running AudioContext, music, and haptics
      env.emitWindow('focus');
      await Promise.resolve();
      expect(env.stateRef.value).toBe('running');
      expect(ambient.isRunning()).toBe(true);
      expect(env.musicGainNode.gain.value).toBeCloseTo(0.36);
      expect(env.sfxGainNode.gain.value).toBeCloseTo(0.85);
      expect(env.audioSession.type).toBe('playback');
      sound.playButtonTap();
      expect(env.vibrateSpy).toHaveBeenCalledTimes(1);

      // Spurious window blur while page stays visible (!document.hidden) self-heals on pointermove drag
      env.vibrateSpy.mockClear();
      env.emitWindow('blur');
      env.emitWindow('pointermove');
      sound.playSlideTick();
      expect(env.vibrateSpy).toHaveBeenCalledTimes(1);

      // 2. Mobile tab switch (blur + visibilitychange hidden -> visible without focus) cleanly resumes
      env.emitWindow('blur');
      env.docState.hidden = true;
      env.emitDoc('visibilitychange');
      expect(ambient.isRunning()).toBe(false);
      env.docState.hidden = false;
      env.emitDoc('visibilitychange');
      await Promise.resolve();
      expect(env.stateRef.value).toBe('running');
      expect(ambient.isRunning()).toBe(true);
      expect(env.musicGainNode.gain.value).toBeCloseTo(0.36);

      // 3. In-flight resume() finishing after blur/background immediately re-suspends instead of leaking audio
      env.emitWindow('blur');
      expect(env.stateRef.value).toBe('suspended');
      env.stateRef.value = 'running';
      for (const cb of env.listeners.get('statechange') ?? []) cb();
      expect(env.stateRef.value).toBe('suspended');
      expect(ambient.isRunning()).toBe(false);
      expect(env.musicGainNode.gain.value).toBe(0);
      expect(env.audioSession.type).toBe('ambient');

      // Recover back to foreground
      env.emitWindow('focus');
      await Promise.resolve();
      expect(ambient.isRunning()).toBe(true);

      // 4. pagehide / beforeunload / document freeze all hard-mute immediately; pageshow & resume restore
      env.emitWindow('pagehide');
      expect(ambient.isRunning()).toBe(false);
      expect(env.musicGainNode.gain.value).toBe(0);
      expect(env.stateRef.value).toBe('suspended');
      env.emitWindow('pageshow');
      await Promise.resolve();
      expect(ambient.isRunning()).toBe(true);

      env.emitDoc('freeze');
      expect(ambient.isRunning()).toBe(false);
      expect(env.musicGainNode.gain.value).toBe(0);
      expect(env.stateRef.value).toBe('suspended');
      env.emitDoc('resume');
      await Promise.resolve();
      expect(ambient.isRunning()).toBe(true);

      env.emitWindow('beforeunload');
      expect(ambient.isRunning()).toBe(false);
      expect(env.musicGainNode.gain.value).toBe(0);
      expect(env.stateRef.value).toBe('suspended');

      // 5. destroy() removes all window & document lifecycle listeners cleanly
      sound.destroy();
      for (const set of env.windowListeners.values()) {
        expect(set.size).toBe(0);
      }
      for (const set of env.docListeners.values()) {
        expect(set.size).toBe(0);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('prevents Web Audio static: requests balanced latency, skips foreground tap gain-resets, ramps notes to 0, and cleans up wow LFO/voice graphs onended', () => {
    const env = createMockSoundDomEnv('running');
    try {
      const sound = new SoundEngine();
      sound.unlock();
      expect(env.getStats().lastCtorOptions).toEqual({ latencyHint: 'balanced' });

      // Foreground gesture events must not cancel/reschedule live master gains every tap
      env.sfxGainNode.gain.cancelAndHoldAtTime.mockClear();
      env.sfxGainNode.gain.cancelScheduledValues.mockClear();
      env.sfxGainNode.gain.setTargetAtTime.mockClear();
      env.musicGainNode.gain.cancelAndHoldAtTime.mockClear();
      env.musicGainNode.gain.cancelScheduledValues.mockClear();
      env.musicGainNode.gain.setTargetAtTime.mockClear();

      for (const evt of ['touchstart', 'pointerdown', 'touchend', 'pointerup', 'click']) {
        env.emitWindow(evt);
      }
      expect(env.sfxGainNode.gain.cancelAndHoldAtTime).not.toHaveBeenCalled();
      expect(env.sfxGainNode.gain.cancelScheduledValues).not.toHaveBeenCalled();
      expect(env.sfxGainNode.gain.setTargetAtTime).not.toHaveBeenCalled();
      expect(env.musicGainNode.gain.cancelAndHoldAtTime).not.toHaveBeenCalled();
      expect(env.musicGainNode.gain.cancelScheduledValues).not.toHaveBeenCalled();
      expect(env.musicGainNode.gain.setTargetAtTime).not.toHaveBeenCalled();

      // Volume change anchors live gain smoothly via cancelAndHoldAtTime
      sound.setMusicVolume(1);
      expect(env.musicGainNode.gain.cancelAndHoldAtTime).toHaveBeenCalledTimes(1);
      expect(env.musicGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.22, 1.5, 0.08);
      sound.destroy();
    } finally {
      vi.unstubAllGlobals();
    }

    // Verify all 5 AmbientMusicController voices ramp gain to 0 and tear down subgraphs + wowDepthGain fan-out onended
    const activeWowTargets = new Set<AudioParam>();
    let wowDepthNode: Record<string, unknown> | null = null;
    const endedHandlers: Array<() => void> = [];
    const disconnectedNodes = new Set<object>();
    const noteGainNodes: Array<{ rampedToZero: boolean }> = [];
    let gainIndex = 0;

    const makeParam = (onLinearRamp?: (v: number) => void) => ({
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn((v: number) => onLinearRamp?.(v)),
      exponentialRampToValueAtTime: vi.fn(),
    });

    const musicGain = { gain: makeParam(), connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode;
    const mockCtx = {
      currentTime: 0,
      sampleRate: 44100,
      createGain: () => {
        gainIndex += 1;
        // gainIndex === 2 is wowDepthGain inside ensureGraph (dryBus=1, wowDepthGain=2)
        const state = { rampedToZero: false };
        const node: Record<string, unknown> = {
          gain: makeParam((v) => {
            if (v === 0) state.rampedToZero = true;
          }),
          connect: vi.fn((dest: unknown) => {
            if (node === wowDepthNode && dest && typeof dest === 'object') {
              activeWowTargets.add(dest as AudioParam);
            }
          }),
          disconnect: vi.fn((dest?: unknown) => {
            if (node === wowDepthNode && dest && typeof dest === 'object') {
              activeWowTargets.delete(dest as AudioParam);
            } else {
              disconnectedNodes.add(node);
            }
          }),
        };
        if (gainIndex === 2) {
          wowDepthNode = node;
        } else if (gainIndex >= 11) {
          noteGainNodes.push(state);
        }
        return node;
      },
      createBiquadFilter: () => {
        const node = {
          type: 'lowpass',
          frequency: makeParam(),
          Q: makeParam(),
          connect: vi.fn(),
          disconnect: vi.fn(() => disconnectedNodes.add(node)),
        };
        return node;
      },
      createDelay: () => ({ delayTime: makeParam(), connect: vi.fn(), disconnect: vi.fn() }),
      createDynamicsCompressor: () => ({
        threshold: makeParam(),
        knee: makeParam(),
        ratio: makeParam(),
        attack: makeParam(),
        release: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createStereoPanner: () => ({ pan: makeParam(), connect: vi.fn(), disconnect: vi.fn() }),
      createOscillator: () => {
        const osc = {
          type: 'sine',
          frequency: makeParam(),
          detune: makeParam(),
          connect: vi.fn(),
          disconnect: vi.fn(() => disconnectedNodes.add(osc)),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        const origStop = osc.stop;
        osc.stop = vi.fn((when?: number) => {
          origStop(when);
          if (typeof osc.onended === 'function') {
            endedHandlers.push(osc.onended);
          }
        });
        return osc;
      },
    } as unknown as AudioContext;

    const ctrl = new AmbientMusicController();
    // Run 1 full bar across MENU (horizon_awake), CHALLENGE (starlight_kids -> LeadSigh), ZEN (coastal_dive -> HorizonPluck)
    for (const scene of ['MENU', 'CHALLENGE', 'ZEN'] as const) {
      ctrl.setScene(scene, mockCtx, musicGain, true);
      let t = 0.05;
      for (let step = 0; step < 16; step++) {
        t += ctrl.advanceStep(mockCtx, musicGain, t);
      }
    }

    expect(activeWowTargets.size).toBeGreaterThan(0);
    expect(endedHandlers.length).toBeGreaterThan(20);
    expect(noteGainNodes.some((g) => g.rampedToZero)).toBe(true);

    // Fire all natural note completion handlers and verify zero leaked wow targets or subgraphs
    for (const onEnded of endedHandlers) {
      onEnded();
    }
    expect(activeWowTargets.size).toBe(0);
    expect(disconnectedNodes.size).toBeGreaterThan(endedHandlers.length);
    ctrl.destroy();
  });
});
