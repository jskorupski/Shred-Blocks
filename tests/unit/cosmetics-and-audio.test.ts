import { describe, expect, it, vi } from 'vitest';
import { playStyledShredSoundscape } from '../../src/audio/shred-style-voices';
import { SoundEngine } from '../../src/audio/synth';
import { applyBoosterHammer, commitBlockMove, createBoardState } from '../../src/core/board';
import type { ParticleStyleId } from '../../src/core/types';
import { getLevelSpec } from '../../src/levels/catalog';
import { type AppViewContext, PARTICLE_CATALOG } from '../../src/ui/catalog-meta';
import { canResumeBoardImpl, resumeOrLoadLevelImpl } from '../../src/ui/pause-cosmetics-drawer';

interface RecordedOsc {
  type: OscillatorType;
  f0: number;
  f1: number | null;
  startAt: number;
  stopAt: number;
}

interface RecordedFilter {
  type: BiquadFilterType;
  f0: number;
  f1: number | null;
  q: number;
}

function createMockAudioContext() {
  const oscillators: RecordedOsc[] = [];
  const filters: RecordedFilter[] = [];
  let noiseStarts = 0;

  const makeParam = (onSet?: (v: number) => void, onRamp?: (v: number) => void) => ({
    value: 0,
    setValueAtTime: (v: number) => {
      onSet?.(v);
    },
    exponentialRampToValueAtTime: (v: number) => {
      onRamp?.(v);
    },
    linearRampToValueAtTime: (v: number) => {
      onRamp?.(v);
    },
  });

  const sfxGain = {
    gain: makeParam(),
    connect: () => {},
  };

  const ctx = {
    currentTime: 1.0,
    sampleRate: 44100,
    state: 'running' as AudioContextState,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({
      gain: makeParam(),
      connect: () => {},
    }),
    createOscillator: () => {
      const rec: RecordedOsc = { type: 'sine', f0: 0, f1: null, startAt: 0, stopAt: 0 };
      oscillators.push(rec);
      return {
        get type() {
          return rec.type;
        },
        set type(t: OscillatorType) {
          rec.type = t;
        },
        frequency: makeParam(
          (v) => {
            rec.f0 = v;
          },
          (v) => {
            rec.f1 = v;
          }
        ),
        connect: () => {},
        start: (t = 0) => {
          rec.startAt = t;
        },
        stop: (t = 0) => {
          rec.stopAt = t;
        },
      };
    },
    createBiquadFilter: () => {
      const rec: RecordedFilter = { type: 'bandpass', f0: 0, f1: null, q: 1 };
      filters.push(rec);
      return {
        get type() {
          return rec.type;
        },
        set type(t: BiquadFilterType) {
          rec.type = t;
        },
        frequency: makeParam(
          (v) => {
            rec.f0 = v;
          },
          (v) => {
            rec.f1 = v;
          }
        ),
        Q: makeParam((v) => {
          rec.q = v;
        }),
        connect: () => {},
      };
    },
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      buffer: null as unknown,
      connect: () => {},
      start: () => {
        noiseStarts++;
      },
      stop: () => {},
    }),
  };

  return {
    ctx: ctx as unknown as AudioContext,
    sfxGain: sfxGain as unknown as GainNode,
    oscillators,
    filters,
    getNoiseStarts: () => noiseStarts,
  };
}

describe('SHRED-AUDIO-01 & SESSION-RESUME-01: 5 Signature Shred Soundscapes & Mid-Level Resume Isolation', () => {
  it('SHRED-AUDIO-01: synthesizes 5 acoustically distinct procedural Web Audio voices across normal, final-clear, and preview shreds', () => {
    const signatures = new Set<string>();

    for (const entry of PARTICLE_CATALOG) {
      const style: ParticleStyleId = entry.id;
      const normalMock = createMockAudioContext();
      playStyledShredSoundscape(normalMock.ctx, normalMock.sfxGain, 1.0, 1.0, style, false, false);

      const finalMock = createMockAudioContext();
      playStyledShredSoundscape(finalMock.ctx, finalMock.sfxGain, 1.0, 1.12, style, true, false);

      const previewMock = createMockAudioContext();
      playStyledShredSoundscape(previewMock.ctx, previewMock.sfxGain, 1.0, 1.0, style, false, true);

      expect(normalMock.oscillators.length, style).toBeGreaterThanOrEqual(4);
      expect(finalMock.oscillators.length, style).toBeGreaterThan(normalMock.oscillators.length);
      expect(previewMock.oscillators.length, style).toBeGreaterThanOrEqual(4);

      for (const osc of [...normalMock.oscillators, ...finalMock.oscillators]) {
        expect(osc.f0, style).toBeGreaterThan(80);
        expect(osc.stopAt, style).toBeGreaterThan(osc.startAt);
      }

      const waveSummary = Array.from(new Set(normalMock.oscillators.map((o) => o.type)))
        .sort()
        .join('+');
      const upwardBends = normalMock.oscillators.filter((o) => o.f1 !== null && o.f1 > o.f0).length;
      const downwardBends = normalMock.oscillators.filter((o) => o.f1 !== null && o.f1 < o.f0).length;
      const sig = `${waveSummary}|osc:${normalMock.oscillators.length}|up:${upwardBends}|dn:${downwardBends}|flt:${normalMock.filters.length}|nz:${normalMock.getNoiseStarts()}`;
      signatures.add(sig);

      if (style === 'pixel_sparks') {
        expect(normalMock.oscillators.some((o) => o.type === 'square' && (o.f1 ?? 0) < o.f0)).toBe(true);
      } else if (style === 'soap_bubbles') {
        expect(normalMock.oscillators.every((o) => o.type === 'sine')).toBe(true);
        expect(upwardBends).toBeGreaterThanOrEqual(6);
      } else if (style === 'lightning_bolts') {
        expect(normalMock.oscillators.some((o) => o.type === 'sawtooth')).toBe(true);
        expect(normalMock.getNoiseStarts()).toBeGreaterThanOrEqual(2);
      } else if (style === 'star_confetti') {
        expect(normalMock.oscillators.some((o) => o.type === 'sine' && o.f0 >= 1000)).toBe(true);
        expect(normalMock.getNoiseStarts()).toBeGreaterThanOrEqual(2);
      } else if (style === 'micro_cubes') {
        expect(upwardBends).toBeGreaterThanOrEqual(8);
        expect(downwardBends).toBeGreaterThanOrEqual(3);
      }
    }

    // Every one of the 5 particle cosmetics produces a unique synthesis graph fingerprint
    expect(signatures.size).toBe(PARTICLE_CATALOG.length);

    // SoundEngine.playShred & playParticlePreview route cleanly without browser AudioContext errors
    const engine = new SoundEngine({ sfxEnabled: true, musicEnabled: false, hapticsEnabled: false });
    const mockAudio = createMockAudioContext();
    (engine as unknown as { ctx: AudioContext; sfxGain: GainNode }).ctx = mockAudio.ctx;
    (engine as unknown as { ctx: AudioContext; sfxGain: GainNode }).sfxGain = mockAudio.sfxGain;
    engine.playShred(1, 'soap_bubbles', false);
    engine.playParticlePreview('lightning_bolts');
    expect(mockAudio.oscillators.length).toBeGreaterThan(8);
  });

  it('SESSION-RESUME-01 & MODE-ISOLATION-01: preserves mid-level board state on same-stage/same-mode return while resetting on mode or stage change', () => {
    const board = createBoardState(getLevelSpec(12));
    const movable = board.blocks.find((b) => b.status === 'ACTIVE');
    expect(movable).toBeDefined();
    if (movable) {
      applyBoosterHammer(board, movable.row, movable.col);
    }
    expect(board.sessionBlocksShredded).toBe(1);

    let playMode: 'CHALLENGE' | 'ZEN' | 'TIMED' = 'CHALLENGE';
    const loadLevelSpy = vi.fn();
    const switchScreenSpy = vi.fn();
    const setCurrentLevelSpy = vi.fn();

    const mockApp = {
      board,
      boardPlayMode: 'CHALLENGE' as const,
      levelOutcomeHandled: false,
      blueprintMix: 0,
      lastPointerActivityMs: 0,
      saveManager: {
        getPayload: () => ({
          currentLevelId: 12,
          settings: { playMode },
          modeState: {
            CHALLENGE: { highestUnlocked: 20, currentLevelId: 12 },
            ZEN: { highestUnlocked: 20, currentLevelId: 12 },
            TIMED: { highestUnlocked: 20, currentLevelId: 12 },
          },
        }),
        setCurrentLevel: setCurrentLevelSpy,
      },
      inputController: { cancelTargeting: vi.fn() },
      renderer: { resize: vi.fn() },
      canResumeBoard: (id?: number) => canResumeBoardImpl(mockApp as unknown as AppViewContext, id),
      loadLevel: loadLevelSpy,
      closeAllModals: vi.fn(),
      switchScreen: switchScreenSpy,
      syncAllUiFromSave: vi.fn(),
      syncInGameHud: vi.fn(),
      renderNow: vi.fn(),
    } as unknown as AppViewContext;

    // 1. Returning to the same Level 12 in Challenge mode resumes the exact BoardState without calling loadLevel
    expect(canResumeBoardImpl(mockApp, 12)).toBe(true);
    resumeOrLoadLevelImpl(mockApp, 12, true);
    expect(loadLevelSpy).not.toHaveBeenCalled();
    expect(switchScreenSpy).toHaveBeenCalledWith('game');
    expect(mockApp.board.sessionBlocksShredded).toBe(1);

    // 2. Selecting a DIFFERENT level (Level 11) performs a fresh Move-0 loadLevel
    expect(canResumeBoardImpl(mockApp, 11)).toBe(false);
    resumeOrLoadLevelImpl(mockApp, 11, true);
    expect(loadLevelSpy).toHaveBeenCalledWith(11, true, true);
    loadLevelSpy.mockClear();

    // 3. Switching Play Mode (CHALLENGE -> ZEN) invalidates resume (`MODE-ISOLATION-01`) and loads Move-0
    playMode = 'ZEN';
    expect(canResumeBoardImpl(mockApp, 12)).toBe(false);
    resumeOrLoadLevelImpl(mockApp, 12, true);
    expect(loadLevelSpy).toHaveBeenCalledWith(12, true, true);
    loadLevelSpy.mockClear();

    // 4. Terminal / outcome-handled boards never resume stale end-states
    playMode = 'CHALLENGE';
    mockApp.levelOutcomeHandled = true;
    expect(canResumeBoardImpl(mockApp, 12)).toBe(false);
    resumeOrLoadLevelImpl(mockApp, 12, true);
    expect(loadLevelSpy).toHaveBeenCalledWith(12, true, true);

    // Confirm Level 1 board cleared to victory also returns canResumeBoard === false
    const wonBoard = createBoardState(getLevelSpec(1));
    commitBlockMove(wonBoard, 1, 0, 1, 'CHALLENGE');
    commitBlockMove(wonBoard, 2, 1, 3, 'CHALLENGE');
    commitBlockMove(wonBoard, 2, 1, 4, 'CHALLENGE');
    mockApp.board = wonBoard;
    mockApp.levelOutcomeHandled = false;
    expect(canResumeBoardImpl(mockApp, 1)).toBe(false);
  });
});
