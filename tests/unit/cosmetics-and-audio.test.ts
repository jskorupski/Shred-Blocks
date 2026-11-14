import { describe, expect, it, vi } from 'vitest';
import { playStyledShredSoundscape } from '../../src/audio/shred-style-voices';
import { SoundEngine } from '../../src/audio/synth';
import { applyBoosterHammer, commitBlockMove, createBoardState } from '../../src/core/board';
import { COLOR_PALETTE, type ColorId, type ParticleStyleId } from '../../src/core/types';
import { getLevelSpec } from '../../src/levels/catalog';
import { POLYOMINO_MESH_CATALOG } from '../../src/render/mesh-generator';
import { getToneOnToneGlyphRgb } from '../../src/render/render-types';
import { MAIN_FRAGMENT_SHADER } from '../../src/render/shaders-3d';
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

  it('NEON-CYBER-01: preserves hue-true neon separation (Orange vs Yellow, Red vs Pink) and WCAG AAA Colorblind glyph contrast on dark smoked glass', () => {
    expect(MAIN_FRAGMENT_SHADER).toContain('NEON-CYBER-01');
    expect(MAIN_FRAGMENT_SHADER).toContain('u_highContrast == 1 && u_materialStyle != 3');

    // Outer-perimeter proximity UV (`v_uv.x`) must be populated on smooth polyomino shells for the inset neon rim
    const mesh2x2 = POLYOMINO_MESH_CATALOG['2x2'];
    let minUvX = 1;
    let maxUvX = 0;
    for (let i = 0; i < mesh2x2.meshOuter.uvs.length; i += 2) {
      const u = mesh2x2.meshOuter.uvs[i];
      if (u < minUvX) minUvX = u;
      if (u > maxUvX) maxUvX = u;
    }
    expect(minUvX).toBeLessThan(0.05);
    expect(maxUvX).toBeGreaterThan(0.9);

    const smoothstep = (e0: number, e1: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
    const srgbToLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const relLum = ([r, g, b]: readonly [number, number, number]): number =>
      0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
    const toOklab = ([sr, sg, sb]: readonly [number, number, number]): [number, number, number] => {
      const r = srgbToLin(sr);
      const g = srgbToLin(sg);
      const b = srgbToLin(sb);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      ];
    };
    const oklabDist = (
      a: readonly [number, number, number],
      b: readonly [number, number, number]
    ): number => {
      const la = toOklab(a);
      const lb = toOklab(b);
      return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
    };

    const evalNeonShader = (
      inRgb: readonly [number, number, number],
      hc: boolean
    ): { neonCol: [number, number, number]; centerLit: [number, number, number] } => {
      const peakC = Math.max(inRgb[0], inRgb[1], inRgb[2]);
      const unitHue = inRgb.map((c) => c / Math.max(peakC, 1e-4)) as [number, number, number];
      const isWarm = (unitHue[0] >= 0.85 ? 1 : 0) * (unitHue[2] >= 0.22 ? 0 : 1);
      const canaryLift = smoothstep(0.7, 0.82, unitHue[1]) * isWarm;
      const orangeDeep =
        smoothstep(0.35, 0.45, unitHue[1]) * (1 - smoothstep(0.56, 0.69, unitHue[1])) * isWarm;
      const sharpHue: [number, number, number] = [
        clamp01(unitHue[0] ** 1.26 - canaryLift * 0.02),
        clamp01(unitHue[1] ** 1.12 + canaryLift * 0.2 - orangeDeep * 0.03),
        clamp01(unitHue[2] ** 1.3 + canaryLift * 0.02 - orangeDeep * 0.03),
      ];
      const scale = Math.max(0.68, Math.min(1, peakC * 1.1));
      const neonCol: [number, number, number] = [
        sharpHue[0] * scale,
        sharpHue[1] * scale,
        sharpHue[2] * scale,
      ];
      const coreMul = hc ? 0.215 : 0.165;
      const sky = 0.46;
      const litScale = hc ? 1.2 : 1.16;
      const spec = 0.014;
      const centerLit: [number, number, number] = [
        clamp01((0.011 + neonCol[0] * (coreMul + sky * 0.042)) * litScale + spec),
        clamp01((0.012 + neonCol[1] * (coreMul + sky * 0.042)) * litScale + spec),
        clamp01((0.02 + neonCol[2] * (coreMul + sky * 0.042)) * litScale + spec),
      ];
      return { neonCol, centerLit };
    };

    const colorIds: ColorId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const hc of [false, true]) {
      const getRes = (id: ColorId) =>
        evalNeonShader(hc ? COLOR_PALETTE[id].hcRgb : COLOR_PALETTE[id].rgb, hc);

      // Orange (6) vs Yellow (4) must remain sharply separated in green channel and perceptual OKLab space
      const orange = getRes(6);
      const yellow = getRes(4);
      expect(yellow.neonCol[1] - orange.neonCol[1]).toBeGreaterThan(0.45);
      expect(oklabDist(orange.neonCol, yellow.neonCol)).toBeGreaterThan(0.24);
      expect(oklabDist(orange.centerLit, yellow.centerLit)).toBeGreaterThan(0.075);

      // Crimson Red (1) smoked glass center must remain warm red (never cool pink/purple from sky reflections)
      const red = getRes(1);
      expect(red.centerLit[0]).toBeGreaterThan(red.centerLit[2] * 3.0);

      // Every pair among the 9 colors must maintain clear perceptual neon separation (including Red-Orange & Green-Lime)
      for (let i = 0; i < colorIds.length; i++) {
        for (let j = i + 1; j < colorIds.length; j++) {
          const a = getRes(colorIds[i]);
          const b = getRes(colorIds[j]);
          expect(oklabDist(a.neonCol, b.neonCol)).toBeGreaterThan(0.08);
        }
      }

      // Colorblind glyphs on neon_cyber must always use luminous cbNeonGlyphRgb with >= 6.5:1 WCAG contrast
      for (const id of colorIds) {
        const glyph = getToneOnToneGlyphRgb(id, hc, true);
        expect(glyph).toEqual(COLOR_PALETTE[id].cbNeonGlyphRgb);
        const lumGlyph = relLum(glyph);
        const lumGlass = relLum(getRes(id).centerLit);
        const contrast = (Math.max(lumGlyph, lumGlass) + 0.05) / (Math.min(lumGlyph, lumGlass) + 0.05);
        expect(contrast).toBeGreaterThanOrEqual(6.5);
      }
    }
  });
});
