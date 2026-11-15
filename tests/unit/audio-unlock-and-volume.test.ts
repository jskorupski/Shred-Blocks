import { describe, expect, it, vi } from 'vitest';
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
  vi.stubGlobal('navigator', { audioSession });

  return {
    sfxGainNode,
    musicGainNode,
    stateRef,
    docState,
    audioSession,
    listeners,
    windowListeners,
    docListeners,
    emitWindow: (t: string) => {
      for (const cb of windowListeners.get(t) ?? []) cb();
    },
    emitDoc: (t: string) => {
      for (const cb of docListeners.get(t) ?? []) cb();
    },
    getStats: () => ({ resumeCount, silentBufferCount }),
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
      // Ensures gesture listeners span pointerdown/pointerup/touchend/click/keydown
      for (const evt of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
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
      sound.playShred(0);
      sound.playWinFanfare(3);
      expect(env.getStats().resumeCount).toBe(statsWhileBlurred.resumeCount);
      expect(ambient.isRunning()).toBe(false);

      // Returning focus restores gains, audioSession, running AudioContext, and music
      env.emitWindow('focus');
      await Promise.resolve();
      expect(env.stateRef.value).toBe('running');
      expect(ambient.isRunning()).toBe(true);
      expect(env.musicGainNode.gain.value).toBeCloseTo(0.36);
      expect(env.sfxGainNode.gain.value).toBeCloseTo(0.85);
      expect(env.audioSession.type).toBe('playback');

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
});
