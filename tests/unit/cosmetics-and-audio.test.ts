import { describe, expect, it, vi } from 'vitest';
import {
  AMBIENT_PRESETS,
  AMBIENT_ROTATION_BARS,
  AmbientMusicController,
  SCENE_ROTATION_POOLS,
} from '../../src/audio/ambient-music';
import { playStyledShredSoundscape } from '../../src/audio/shred-style-voices';
import { SoundEngine } from '../../src/audio/synth';
import { applyBoosterHammer, commitBlockMove, createBoardState } from '../../src/core/board';
import { COLOR_PALETTE, type ColorId, type ParticleStyleId, type TrayId } from '../../src/core/types';
import { getLevelSpec } from '../../src/levels/catalog';
import { POLYOMINO_MESH_CATALOG } from '../../src/render/mesh-generator';
import { resolveOriginGhostStyle, resolveReturnHomeStyle } from '../../src/render/pass2-drag-fx';
import {
  getToneOnToneGlyphRgb,
  HIGH_CONTRAST_TRAY_PALETTES,
  TRAY_PALETTES,
} from '../../src/render/render-types';
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

  it('WOOD-GRAIN-01 & THEME-A11Y-STUDIO-SYNC-01: offsets carved_wood grain per u_blockSeed, tempers plastic vibrancy into stained hardwood, and preserves >= 3:1 Colorblind contrast', () => {
    expect(MAIN_FRAGMENT_SHADER).toContain('WOOD-GRAIN-01');
    expect(MAIN_FRAGMENT_SHADER).toContain('u_blockSeed * 0.618034');
    expect(MAIN_FRAGMENT_SHADER).toContain('vec2(19.7, 13.3) * u_blockSeed');

    // Verify per-block grain domain coordinates never collide across distinct block IDs at identical localPos
    const sampleWoodCoord = (seed: number, lx: number, ly: number): [number, number] => {
      const swap = (seed * 0.618034) % 1 >= 0.5;
      const wx0 = swap ? ly : lx;
      const wy0 = swap ? lx : ly;
      const sx = Math.sin(seed * 1.37 + 3.1) * 43758.5453;
      const hx = sx - Math.floor(sx);
      const ang = (hx - 0.5) * 0.3;
      const cA = Math.cos(ang);
      const sA = Math.sin(ang);
      return [cA * wx0 - sA * wy0 + 19.7 * seed, sA * wx0 + cA * wy0 + 13.3 * seed];
    };
    for (let id = 1; id <= 8; id++) {
      const a = sampleWoodCoord(id, 0.5, 0.5);
      const b = sampleWoodCoord(id + 1, 0.5, 0.5);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(15);
    }

    const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
    const srgbToLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const relLum = ([r, g, b]: readonly [number, number, number]): number =>
      0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);

    const evalWoodStain = (
      inRgb: readonly [number, number, number],
      hc: boolean
    ): [number, number, number] => {
      const luma = 0.299 * inRgb[0] + 0.587 * inRgb[1] + 0.114 * inRgb[2];
      const satMix = hc ? 0.9 : 0.78;
      const mul = hc ? 0.84 : 0.74;
      const walnutMul = (hc ? 0.08 : 0.13) * (0.55 + 0.45 * luma);
      const walnut = [0.34, 0.23, 0.14] as const;
      const stained = [0, 1, 2].map((i) => {
        const dye = luma * (1 - satMix) + inRgb[i] * satMix;
        return clamp01(dye * mul + walnut[i] * walnutMul);
      }) as [number, number, number];
      const litMul = hc ? 1.18 : 1.12;
      return stained.map((c) => clamp01(c * litMul + 0.015)) as [number, number, number];
    };

    const colorIds: ColorId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const id of colorIds) {
      // Standard mode wood must be grounded below neon-plastic 0.92 peak saturation while keeping clear hue
      const stdTop = evalWoodStain(COLOR_PALETTE[id].rgb, false);
      expect(Math.max(stdTop[0], stdTop[1], stdTop[2])).toBeLessThan(0.88);

      // Colorblind mode + High-Contrast Colorblind mode must maintain >= 3.0:1 WCAG 1.4.11 non-text sigil contrast
      for (const hc of [false, true]) {
        const woodCb = evalWoodStain(hc ? COLOR_PALETTE[id].cbHcRgb : COLOR_PALETTE[id].cbRgb, hc);
        const glyph = getToneOnToneGlyphRgb(id, hc, false).map((c) => clamp01(c * 1.12 + 0.02)) as [
          number,
          number,
          number,
        ];
        const l1 = relLum(woodCb);
        const l2 = relLum(glyph);
        const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        expect(cr).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  it('ORIGIN-GHOST-01: adapts mid-drag origin ghost & return-home contrast across all 5 board trays and 4 A11y modes', () => {
    const srgbToLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const relLum = (rgb: readonly [number, number, number]): number =>
      0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2]);
    const mixRgb = (
      fg: readonly [number, number, number],
      bg: readonly [number, number, number],
      alpha: number
    ): [number, number, number] => [
      fg[0] * alpha + bg[0] * (1 - alpha),
      fg[1] * alpha + bg[1] * (1 - alpha),
      fg[2] * alpha + bg[2] * (1 - alpha),
    ];
    const contrast = (a: readonly [number, number, number], b: readonly [number, number, number]): number => {
      const la = relLum(a);
      const lb = relLum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const trays: TrayId[] = [
      'industrial_slate',
      'warm_birch',
      'midnight_arcade',
      'frosted_quartz',
      'mint_studio',
    ];
    const lightTrays = new Set<TrayId>(['warm_birch', 'frosted_quartz', 'mint_studio']);
    const colorIds: ColorId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    for (const trayId of trays) {
      for (const highContrast of [false, true]) {
        const palette = highContrast ? HIGH_CONTRAST_TRAY_PALETTES[trayId] : TRAY_PALETTES[trayId];
        for (const colorblind of [false, true]) {
          for (const colorId of colorIds) {
            const entry = COLOR_PALETTE[colorId];
            const blockRgb = colorblind
              ? highContrast
                ? entry.cbHcRgb
                : entry.cbRgb
              : highContrast
                ? entry.hcRgb
                : entry.rgb;
            const style = resolveOriginGhostStyle(trayId, palette, blockRgb, highContrast, 0);

            if (!highContrast && lightTrays.has(trayId)) {
              expect(style.isLightTray).toBe(true);
              expect(style.padAlpha).toBeGreaterThanOrEqual(0.2);
              expect(style.padAlpha).toBeLessThanOrEqual(0.28);
            } else {
              expect(style.isLightTray).toBe(false);
              if (trayId === 'industrial_slate' && !highContrast) {
                expect(style.padAlpha).toBeLessThanOrEqual(0.12);
              }
              if (trayId === 'midnight_arcade' && !highContrast) {
                expect(style.padAlpha).toBeGreaterThanOrEqual(0.15);
                expect(style.haloAlpha).toBeGreaterThanOrEqual(0.6);
              }
            }

            for (const tile of [palette.floorTileA, palette.floorTileB]) {
              const overHalo = mixRgb(style.haloRgb, tile, style.haloAlpha);
              const compBracket = mixRgb(style.bracketRgb, overHalo, style.bracketAlpha);
              expect(contrast(compBracket, tile)).toBeGreaterThanOrEqual(2.6);
            }
          }
        }

        const home = resolveReturnHomeStyle(trayId, palette, highContrast, 0);
        for (const tile of [palette.floorTileA, palette.floorTileB]) {
          const overHalo = mixRgb(home.haloRgb, tile, home.haloAlpha);
          const compBracket = mixRgb(home.bracketRgb, overHalo, home.bracketAlpha);
          expect(contrast(compBracket, tile)).toBeGreaterThanOrEqual(2.6);
        }
      }
    }
  });

  describe('AMBIENT-MUSIC-01: Mode-Attuned Drumless Warm Analog Synthwave & Pure-Pentatonic Rotation', () => {
    const createAmbientMockCtx = () => {
      const filters: Array<{ type: BiquadFilterType; freq: number; q: number }> = [];
      const oscStarts: Array<{ type: OscillatorType; freq: number; startAt: number; stopAt: number }> = [];
      const bufStarts: Array<{ len: number; when: number }> = [];
      let delayCount = 0;
      let compCount = 0;
      let disconnectCount = 0;
      let immediateStopCount = 0;

      const makeParam = (onSet?: (v: number) => void) => ({
        value: 0,
        setValueAtTime: (v: number) => onSet?.(v),
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
        setTargetAtTime: (v: number) => onSet?.(v),
        cancelScheduledValues: () => {},
      });
      const disconnect = () => {
        disconnectCount += 1;
      };
      const baseNode = { connect: () => {}, disconnect };
      const musicGain = { ...baseNode, gain: makeParam() } as unknown as GainNode;

      const ctx = {
        currentTime: 2.0,
        sampleRate: 44100,
        state: 'running' as AudioContextState,
        destination: {},
        createGain: () => ({ ...baseNode, gain: makeParam() }),
        createBiquadFilter: () => {
          const rec = { type: 'lowpass' as BiquadFilterType, freq: 0, q: 0 };
          filters.push(rec);
          return {
            ...baseNode,
            get type() {
              return rec.type;
            },
            set type(t: BiquadFilterType) {
              rec.type = t;
            },
            frequency: makeParam((v) => {
              rec.freq = v;
            }),
            Q: makeParam((v) => {
              rec.q = v;
            }),
          };
        },
        createDelay: () => {
          delayCount += 1;
          return { ...baseNode, delayTime: makeParam() };
        },
        createDynamicsCompressor: () => {
          compCount += 1;
          return { ...baseNode, threshold: makeParam(), ratio: makeParam() };
        },
        createStereoPanner: () => ({ ...baseNode, pan: makeParam() }),
        createBuffer: (_ch: number, len: number, sampleRate: number) => {
          const buf = new Float32Array(len);
          return { length: len, sampleRate, getChannelData: () => buf };
        },
        createBufferSource: () => {
          let bufLen = 0;
          return {
            set buffer(b: { length: number } | null) {
              bufLen = b?.length ?? 0;
            },
            connect: () => {},
            start: (when = 0) => bufStarts.push({ len: bufLen, when }),
            stop: () => {},
          };
        },
        createOscillator: () => {
          const rec = { type: 'sine' as OscillatorType, freq: 0, startAt: 0, stopAt: 0 };
          return {
            get type() {
              return rec.type;
            },
            set type(t: OscillatorType) {
              rec.type = t;
            },
            frequency: makeParam((v) => {
              rec.freq = v;
            }),
            detune: makeParam(),
            connect: () => {},
            start: (t = 0) => {
              rec.startAt = t;
              oscStarts.push(rec);
            },
            stop: (t?: number) => {
              if (t === undefined) {
                immediateStopCount += 1;
              } else {
                rec.stopAt = t;
              }
            },
          };
        },
      } as unknown as AudioContext;

      return {
        ctx,
        musicGain,
        filters,
        oscStarts,
        bufStarts,
        getStats: () => ({ delayCount, compCount, disconnectCount, immediateStopCount }),
      };
    };

    it('keeps every synthwave preset pure-pentatonic (0 semitones, 0 tritones, >= 1.9 semitone pad spacing)', () => {
      const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);

      expect(AMBIENT_PRESETS).toHaveLength(5);
      for (const preset of AMBIENT_PRESETS) {
        expect(preset.arpPattern).toHaveLength(16);
        expect(preset.arp).toHaveLength(5);
        expect(preset.chords).toHaveLength(4);

        const pcs = new Set<number>();
        for (const freq of preset.arp) {
          pcs.add(((Math.round(hzToMidi(freq)) % 12) + 12) % 12);
        }
        for (const chord of preset.chords) {
          const stack = [chord.bass, ...chord.pad].map(hzToMidi);
          for (let i = 1; i < stack.length; i++) {
            expect(stack[i] - stack[i - 1]).toBeGreaterThanOrEqual(1.9);
          }
          const melodic = [...stack];
          if (chord.leadA !== null) melodic.push(hzToMidi(chord.leadA));
          if (chord.leadB !== null) melodic.push(hzToMidi(chord.leadB));
          for (const midi of melodic) {
            pcs.add(((Math.round(midi) % 12) + 12) % 12);
          }
        }
        const sorted = [...pcs].sort((a, b) => a - b);
        expect(sorted).toHaveLength(5);
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const diff = (sorted[j] - sorted[i]) % 12;
            expect(diff).not.toBe(1);
            expect(diff).not.toBe(11);
            expect(diff).not.toBe(6);
          }
        }
      }
    });

    it('routes mode openers without restarting on identical scenes and rotates smoothly after 32 bars', () => {
      const { ctx, musicGain } = createAmbientMockCtx();
      const ctrl = new AmbientMusicController();

      expect(ctrl.getScene()).toBe('MENU');
      expect(ctrl.getActivePresetId()).toBe(SCENE_ROTATION_POOLS.MENU[0]);
      expect(ctrl.getActivePresetId()).toBe('horizon_awake');

      ctrl.setScene('CHALLENGE', ctx, musicGain, false);
      expect(ctrl.getActivePresetId()).toBe('starlight_kids');
      ctrl.advanceStep(ctx, musicGain, 2.02);
      // Re-asserting the same scene (e.g. Next Level / Restart in Challenge) must not reset bars or step
      ctrl.setScene('CHALLENGE', ctx, musicGain, true);
      ctrl.setScene('CHALLENGE', ctx, musicGain, true);
      expect(ctrl.getActivePresetId()).toBe('starlight_kids');

      let t = 2.2;
      const barLen = AMBIENT_PRESETS.find((p) => p.id === 'starlight_kids')?.arpPattern.length ?? 0;
      expect(barLen).toBe(16);
      for (let s = 1; s < AMBIENT_ROTATION_BARS * barLen; s++) {
        t += ctrl.advanceStep(ctx, musicGain, t);
      }
      expect(ctrl.getBarsInCurrentTrack()).toBe(AMBIENT_ROTATION_BARS);
      expect(ctrl.getActivePresetId()).toBe('starlight_kids');

      // Downbeat of bar 33 rotates smoothly to the next palette in the CHALLENGE pool
      ctrl.advanceStep(ctx, musicGain, t);
      expect(ctrl.getActivePresetId()).toBe(SCENE_ROTATION_POOLS.CHALLENGE[1]);
      expect(ctrl.getActivePresetId()).toBe('horizon_awake');

      ctrl.setScene('ZEN', ctx, musicGain, false);
      expect(ctrl.getActivePresetId()).toBe('coastal_dive');
      ctrl.setScene('TIMED', ctx, musicGain, false);
      expect(ctrl.getActivePresetId()).toBe('hawkins_stargazer');
      ctrl.destroy();
    });

    it('synthesizes drumless Juno chorus, 860 Hz tape echo wash, wow LFO, zero noise drums, and tears down cleanly', () => {
      const { ctx, musicGain, filters, oscStarts, bufStarts, getStats } = createAmbientMockCtx();

      const ctrl = new AmbientMusicController();
      ctrl.setScene('CHALLENGE', ctx, musicGain, false);

      // Step through 1 full bar (16 steps) of starlight_kids
      let t = 2.05;
      for (let i = 0; i < 16; i++) {
        t += ctrl.advanceStep(ctx, musicGain, t);
      }

      const stats = getStats();
      expect(bufStarts).toHaveLength(0);
      expect(stats.delayCount).toBe(4);
      expect(stats.compCount).toBe(1);
      expect(filters.some((f) => f.type === 'lowpass' && f.freq === 1750)).toBe(true);
      expect(filters.filter((f) => f.type === 'lowpass' && f.freq === 860)).toHaveLength(2);
      expect(oscStarts.length).toBeGreaterThanOrEqual(25);

      ctrl.destroy();
      const postDestroyStats = getStats();
      expect(postDestroyStats.disconnectCount).toBeGreaterThan(0);
      expect(postDestroyStats.immediateStopCount).toBe(3);

      const sound = new SoundEngine({ sfxEnabled: false, musicEnabled: false, hapticsEnabled: false });
      sound.setMusicScene('TIMED');
      expect(sound.getMusicScene()).toBe('TIMED');
      expect(sound.getActiveMusicPreset()).toBe('hawkins_stargazer');
      sound.destroy();
    });
  });
});
