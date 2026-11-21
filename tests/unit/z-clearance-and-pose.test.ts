import { describe, expect, it, vi } from 'vitest';
import { createBoardState } from '../../src/core/board';
import { getActiveColor, getLayersRemaining } from '../../src/core/polyomino';
import type { BoardState, ColorId, LevelSpec, SkinId } from '../../src/core/types';
import {
  computeBoardAnimatedBlockPoses,
  getBlockSurfaceTopLocalZ,
} from '../../src/render/block-pose-and-clearance';
import { Camera3D } from '../../src/render/camera-3d';
import { getRoomVisualStateImpl } from '../../src/render/particle-fx';
import { renderPass1Courtyard } from '../../src/render/pass1-courtyard';
import { renderPass1WallsAndGates } from '../../src/render/pass1-gates-barriers';
import {
  renderPass1PortcullisBarriers,
  renderPass2ReticleAndPromptsImpl,
} from '../../src/render/pass2-barriers-and-reticles';
import { renderPass3BlocksImpl } from '../../src/render/pass3-block-shells';
import { uploadAtlasAndStaticMeshesImpl } from '../../src/render/relic-awakening-fx';
import {
  drawBadgeMedallion3DImpl,
  QualityGovernor,
  type RenderPassContext,
  type RenderSceneOptions,
  TRAY_PALETTES,
} from '../../src/render/render-types';

const ALL_SKINS: ReadonlyArray<SkinId> = [
  'classic_studs',
  'relic_stone',
  'gummy_jelly',
  'carved_wood',
  'neon_cyber',
];

function createSpyRenderContext(options: RenderSceneOptions = {}): {
  rctx: RenderPassContext;
  gl: WebGL2RenderingContext;
  meshCalls: Array<{
    tx: number;
    ty: number;
    tz: number;
    sx: number;
    sy: number;
    sz: number;
    style: number;
  }>;
  badgeCalls: Array<{ key: string; cx: number; cy: number; z: number; size: number }>;
  numberCalls: Array<{ value: number; cx: number; cy: number; z: number }>;
  medallionCalls: Array<{
    cx: number;
    cy: number;
    zBase: number;
    width: number;
    height: number;
    topZ: number;
  }>;
} {
  const meshCalls: Array<{
    tx: number;
    ty: number;
    tz: number;
    sx: number;
    sy: number;
    sz: number;
    style: number;
  }> = [];
  const badgeCalls: Array<{ key: string; cx: number; cy: number; z: number; size: number }> = [];
  const numberCalls: Array<{ value: number; cx: number; cy: number; z: number }> = [];
  const medallionCalls: Array<{
    cx: number;
    cy: number;
    zBase: number;
    width: number;
    height: number;
    topZ: number;
  }> = [];

  const noop = () => {};
  const gl = {
    CULL_FACE: 0x0b44,
    enable: noop,
    disable: noop,
    depthMask: noop,
    uniform1i: noop,
    uniform1f: noop,
    uniform3f: noop,
    uniform4f: noop,
    uniform4fv: noop,
    blendFuncSeparate: noop,
  } as unknown as WebGL2RenderingContext;

  const rctx: RenderPassContext = {
    canvas: { width: 390, height: 844 } as unknown as HTMLCanvasElement,
    camera: new Camera3D(6, 6, 1),
    qualityGovernor: new QualityGovernor(),
    gl,
    ctx2d: null,
    uUseClipPlane: null,
    uBlockSeed: null,
    uClipPlane: null,
    uCapColor: null,
    uTraceCount: null,
    uTracePts: null,
    particlePool: new Float32Array(64),
    particleInstanceData: new Float32Array(64),
    activeParticleCount: 0,
    smokeInstanceData: new Float32Array(64),
    activeSmokeCount: 0,
    relicPlates: [],
    activeRelicPlateCount: 0,
    particlePoolCount: 0,
    particleWriteCursor: 0,
    lastBoardLevelId: 1,
    lastSessionShredded: 0,
    lastMovesCommitted: 0,
    blockLayerSnapshots: new Map(),
    crateSnapshots: new Map(),
    gateSnapshots: new Map(),
    elevatorSnapshots: new Map(),
    barrierSnapshots: new Map(),
    roomAwakenMap: new Map(),
    activeVisualShreds: [],
    activeShockwaves: [],
    activeGateBursts: [],
    activePathTraces: [],
    blockBounceMap: new Map(),
    boardShakeTimer: 0,
    boardShakeDirX: 0,
    boardShakeDirY: 0,
    ambientMoteAccumSec: 0,
    lastOptions: options,
    startTimeMs: 0,
    getEffectiveTrayPalette: (trayId) => TRAY_PALETTES[trayId],
    getColorRgb: (c) => (c === 0 ? [0.22, 0.24, 0.28] : [0.85, 0.25, 0.35]),
    getMaterialStyleCode: () => 0,
    getParticleStyleCode: () => 0,
    getRoomVisualState: (board, roomId) => getRoomVisualStateImpl(rctx, board, roomId),
    spawnParticlesAt: noop,
    spawnShockwave: noop,
    spawnPathTrace: noop,
    drawMesh: (_gl, _mesh, tx, ty, tz, sx, sy, sz, _r, _g, _b, _a = 1, _rx = 0, _rz = 0, style = 0) => {
      meshCalls.push({ tx, ty, tz, sx, sy, sz, style });
    },
    drawAtlasBadge: (_gl, key, cx, cy, z, size) => {
      badgeCalls.push({ key, cx, cy, z, size });
    },
    drawNumberBadges: (_gl, value, cx, cy, z) => {
      numberCalls.push({ value, cx, cy, z });
    },
    drawBadgeMedallion3D: (glCtx, cx, cy, zBase, width, height, fr, fg, fb, rr, rg, rb, sxy, sz) => {
      const topZ = drawBadgeMedallion3DImpl(
        rctx,
        glCtx,
        cx,
        cy,
        zBase,
        width,
        height,
        fr,
        fg,
        fb,
        rr,
        rg,
        rb,
        sxy,
        sz
      );
      medallionCalls.push({ cx, cy, zBase, width, height, topZ });
      return topZ;
    },
  };

  return { rctx, gl, meshCalls, badgeCalls, numberCalls, medallionCalls };
}

function makeObstacleShowcaseBoard(): BoardState {
  const spec: LevelSpec = {
    id: 999,
    name: 'Z-Clearance Showcase',
    difficulty: 'HARD',
    rows: 6,
    cols: 6,
    pillars: [[1, 1]],
    crates: [{ id: 1, row: 0, col: 4, hp: 2 }],
    generators: [
      {
        id: 1,
        row: 0,
        col: 0,
        spawnRow: 0,
        spawnCol: 2,
        cooldown: 2,
        queue: [{ shapeId: '1x1', colorStack: [1] }],
      },
    ],
    elevators: [{ id: 1, row: 2, col: 2, width: 2, height: 1, deltaRow: 0, deltaCol: 1 }],
    floorPaths: [
      { row: 4, col: 1, color: 2 },
      { row: 4, col: 2, color: 2 },
    ],
    barriers: [
      {
        id: 1,
        orientation: 'H',
        shredsRemaining: 2,
        unlocksRoomId: 1,
        cells: [[3, 0]],
        roomCells: [[4, 0]],
      },
      {
        id: 2,
        orientation: 'H',
        shredsRemaining: 3,
        unlocksRoomId: 2,
        isVault: true,
        cells: [
          [4, 4],
          [4, 5],
          [5, 4],
          [5, 5],
        ],
      },
    ],
    blocks: [
      { id: 1, shapeId: '1x1', row: 2, col: 2, colorStack: [1] },
      { id: 2, shapeId: '1x1', row: 5, col: 0, colorStack: [2] },
    ],
    gates: [
      {
        edge: 'TOP',
        spanStart: 1,
        spanLength: 2,
        colorQueue: [1, 2, 3, 4],
        iceCount: 3,
        isStar: true,
        slidesOnClear: true,
      },
      {
        edge: 'BOTTOM',
        spanStart: 1,
        spanLength: 2,
        colorQueue: [2, 1],
        shutterLockColor: 3,
        shutterOpen: false,
      },
    ],
    parMoves: 5,
    timeLimitSec: 90,
  };
  const board = createBoardState(spec);
  board.hintMove = { blockId: 1, targetRow: 2, targetCol: 3, exitsGateIndex: -1 };
  return board;
}

describe('Z-Clearance, Rigid Block-Accessory Pose & Durable Atlas (Z-CLEARANCE-01, ATLAS-DURABLE-01)', () => {
  it('caches immutable CPU-backed RGBA pixels in createAtlasTextureData and uploads them safely', async () => {
    vi.resetModules();
    let capturedContextOpts: unknown;
    const mockRgba = new Uint8ClampedArray(512 * 512 * 4);
    mockRgba[0] = 255;
    mockRgba[3] = 255;
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      getImageData: vi.fn(() => ({ data: mockRgba })),
    };
    const origDoc = globalThis.document;
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: (_id: string, opts?: unknown) => {
          capturedContextOpts = opts;
          return mockCtx;
        },
      }),
    });

    try {
      const { createAtlasTextureData } = await import('../../src/render/atlas-3d');
      const atlas = createAtlasTextureData();
      expect(capturedContextOpts).toEqual({ willReadFrequently: true });
      expect(atlas.pixels).toBeInstanceOf(Uint8Array);
      expect(atlas.pixels?.byteLength).toBe(512 * 512 * 4);
      expect(atlas.pixels?.[0]).toBe(255);
      // Mutating source buffer cannot corrupt the cached immutable snapshot
      mockRgba[0] = 0;
      expect(atlas.pixels?.[0]).toBe(255);

      const texImageCalls: unknown[][] = [];
      const activeTextures: number[] = [];
      const mockGl = {
        TEXTURE0: 0x84c0,
        TEXTURE_2D: 0x0de1,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        LINEAR: 0x2601,
        CLAMP_TO_EDGE: 0x812f,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        createTexture: () => ({ id: 'atlasTex' }),
        activeTexture: (unit: number) => activeTextures.push(unit),
        bindTexture: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: (...args: unknown[]) => texImageCalls.push(args),
      } as unknown as WebGL2RenderingContext;

      uploadAtlasAndStaticMeshesImpl(
        mockGl,
        atlas.canvas,
        () => ({}) as ReturnType<typeof Object>,
        atlas.pixels,
        atlas.width
      );
      expect(activeTextures[0]).toBe(mockGl.TEXTURE0);
      expect(texImageCalls[0]?.[8]).toBe(atlas.pixels);

      uploadAtlasAndStaticMeshesImpl(mockGl, atlas.canvas, () => ({}) as ReturnType<typeof Object>);
      expect(texImageCalls[1]?.[5]).toBe(atlas.canvas);
    } finally {
      vi.stubGlobal('document', origDoc);
      vi.unstubAllGlobals();
    }
  });

  it('guarantees zero Z-clipping across Pass 1/2 pillars, generators, crates, elevators, gates, barriers & hints across 24 animation phases', () => {
    const board = makeObstacleShowcaseBoard();
    const palette = TRAY_PALETTES.industrial_slate;

    for (const colorblind of [false, true]) {
      for (let step = 0; step < 24; step++) {
        const timeSec = step * 0.4;
        const opts: RenderSceneOptions = {
          equippedSkin: 'classic_studs',
          equippedTray: 'industrial_slate',
          colorblindSymbols: colorblind,
          highContrast: step % 2 === 1,
          reducedMotion: false,
          blueprintMix: 0,
          timeSec,
        };
        const spy = createSpyRenderContext(opts);
        renderPass1Courtyard(
          spy.rctx,
          spy.gl,
          board,
          palette,
          Boolean(opts.highContrast),
          colorblind,
          timeSec
        );

        // Pillar (1, 1): finial bottom > 0.660 & DIAMOND strictly above finial top
        const pillarCap = spy.meshCalls.find(
          (m) => Math.abs(m.tx - 1.5) < 0.01 && Math.abs(m.ty - 1.5) < 0.01 && Math.abs(m.sx - 0.38) < 0.01
        );
        const pillarDiamond = spy.badgeCalls.find(
          (b) => b.key === 'DIAMOND' && Math.abs(b.cx - 1.5) < 0.01 && Math.abs(b.cy - 1.5) < 0.01
        );
        expect(pillarCap).toBeDefined();
        expect(pillarDiamond).toBeDefined();
        if (pillarCap && pillarDiamond) {
          expect(pillarCap.tz - pillarCap.sz * 0.5).toBeGreaterThan(0.66);
          expect(pillarDiamond.z).toBeGreaterThan(pillarCap.tz + pillarCap.sz * 0.5);
        }

        // Generator (0, 0): preview bottom > 0.720, non-overlapping cooldown medallion > 0.720
        const genPreview = spy.meshCalls.find(
          (m) => m.tx > 0.4 && m.tx < 0.6 && m.ty < 0.48 && Math.abs(m.sx - 0.62) < 0.01
        );
        const genMed = spy.medallionCalls.find((m) => m.cx < 1 && m.cy > 0.5 && m.cy < 1);
        expect(genPreview).toBeDefined();
        expect(genMed).toBeDefined();
        if (genPreview && genMed) {
          expect(genPreview.tz - genPreview.sz * 0.5).toBeGreaterThan(0.72);
          expect(genMed.zBase).toBeGreaterThan(0.72);
          expect(Math.abs(genPreview.ty - genMed.cy)).toBeGreaterThan(0.35);
          if (colorblind) {
            const genSigil = spy.badgeCalls.find(
              (b) =>
                b.key.startsWith('CB_') &&
                Math.abs(b.cx - 0.5) < 0.05 &&
                Math.abs(b.cy - genPreview.ty) < 0.05
            );
            expect(genSigil?.z ?? 0).toBeGreaterThan(genPreview.tz + genPreview.sz * 0.5 + 0.002);
          }
        }

        // Crate (0, 4) medallion > 0.600
        const crateMed = spy.medallionCalls.find(
          (m) => Math.abs(m.cx - 4.5) < 0.05 && Math.abs(m.cy - 0.5) < 0.05
        );
        expect(crateMed?.zBase ?? 0).toBeGreaterThan(0.6);

        // Elevator plaque clears 0.050 elevator deck
        const elevGlyph = spy.badgeCalls.find((b) => b.key === 'LOCK_H' && Math.abs(b.cy - 2.5) < 0.05);
        expect(elevGlyph?.z ?? 0).toBeGreaterThan(0.06);

        // Floor path CB sigil lip clears 0.01025 rails
        if (colorblind) {
          const fpSigil = spy.badgeCalls.find(
            (b) => b.key === 'CB_2' && Math.abs(b.cy - 4.5) < 0.05 && b.cx > 1 && b.cx < 3
          );
          expect((fpSigil?.z ?? 0) - 0.0012).toBeGreaterThan(0.01025);
        }

        // Pass 1 Gates: queued pip dark rim clears 0.682 wall rims, badges clear 0.730 frozen medallion
        spy.meshCalls.length = 0;
        spy.badgeCalls.length = 0;
        spy.medallionCalls.length = 0;
        renderPass1WallsAndGates(
          spy.rctx,
          spy.gl,
          board,
          palette,
          Boolean(opts.highContrast),
          colorblind,
          timeSec
        );
        const pipRims = spy.meshCalls.filter((m) => m.ty < -0.25 && Math.abs(m.sz - 0.052) < 0.005);
        expect(pipRims.length).toBeGreaterThan(0);
        for (const rim of pipRims) {
          expect(rim.tz - rim.sz * 0.5).toBeGreaterThan(0.682);
        }
        const starGateBadge = spy.badgeCalls.find((b) => b.key === 'BADGE_STAR');
        expect(starGateBadge?.z ?? 0).toBeGreaterThan(0.73);
        const gemGateBadge = spy.badgeCalls.find((b) => b.key === 'BADGE_GEM');
        expect(gemGateBadge?.z ?? 0).toBeGreaterThan(0.73);

        // Pass 1G / Pass 2 Barriers & Hint Chevrons
        spy.meshCalls.length = 0;
        spy.badgeCalls.length = 0;
        spy.medallionCalls.length = 0;
        renderPass1PortcullisBarriers(spy.rctx, spy.gl, board, palette, timeSec);
        const bar1Med = spy.medallionCalls.find(
          (m) => Math.abs(m.cx - 0.5) < 0.1 && Math.abs(m.cy - 3.5) < 0.1
        );
        const vaultMed = spy.medallionCalls.find((m) => Math.abs(m.cx - 5) < 0.1 && Math.abs(m.cy - 5) < 0.1);
        expect(bar1Med?.zBase ?? 0).toBeGreaterThan(0.68);
        expect(vaultMed?.zBase ?? 0).toBeGreaterThan(0.625);

        renderPass2ReticleAndPromptsImpl(spy.rctx, spy.gl, board, opts, Boolean(opts.highContrast), 0.5);
        const hintChevrons = spy.badgeCalls.filter((b) => b.key === 'LOCK_H' && Math.abs(b.cy - 2.5) < 0.1);
        expect(hintChevrons.length).toBe(3);
        for (const ch of hintChevrons) {
          expect(ch.z).toBeGreaterThan(0.064 + 0.032);
        }
      }
    }
  });

  it('keeps Pass 3 accessories, multi-layer studs, CB sigils & glued weld clamps locked above host block surfaces across all 5 skins', () => {
    const spec: LevelSpec = {
      id: 998,
      name: 'Block Pose & Stud Clearance',
      difficulty: 'HARD',
      rows: 7,
      cols: 6,
      blocks: [
        {
          id: 1,
          shapeId: '1x2',
          row: 0,
          col: 0,
          colorStack: [1, 2],
          chained: true,
          axisLock: 'H',
          hasKey: 1,
        },
        {
          id: 2,
          shapeId: '1x1',
          row: 1,
          col: 0,
          colorStack: [3, 4],
          iceCount: 2,
          bombCount: 5,
          ropeColor: 2,
        },
        { id: 3, shapeId: '1x2', row: 2, col: 0, colorStack: [2, 1], scissorColor: 3, ropeColor: 4 },
        { id: 4, shapeId: '1x1', row: 3, col: 0, colorStack: [0], shutterGemColor: 4 },
        { id: 5, shapeId: '1x1', row: 4, col: 1, colorStack: [1], groupId: 1 },
        { id: 6, shapeId: '1x1', row: 4, col: 2, colorStack: [2], groupId: 1 },
        { id: 7, shapeId: '1x1', row: 5, col: 1, colorStack: [3], groupId: 2 },
        { id: 8, shapeId: '1x1', row: 5, col: 2, colorStack: [4], groupId: 2, iceCount: 2 },
      ],
      gates: [{ edge: 'TOP', spanStart: 0, spanLength: 2, colorQueue: [1] }],
      parMoves: 4,
      timeLimitSec: 90,
    };

    const draggedSet = new Set<number>();
    const board = createBoardState(spec);

    for (const skin of ALL_SKINS) {
      for (const colorblind of [false, true]) {
        for (const isDraggingGlued of [false, true]) {
          for (const testTimeSec of [0.18, 1.2, 2.4, 3.38, 6.58]) {
            board.blocks[4].liftAlpha = isDraggingGlued ? 1.0 : 0.0;
            board.blocks[5].liftAlpha = isDraggingGlued ? 1.0 : 0.0;
            const bounceRctx = createSpyRenderContext();
            if (!isDraggingGlued && testTimeSec === 1.2) {
              bounceRctx.rctx.blockBounceMap.set(5, 0.17);
            }
            const poses = computeBoardAnimatedBlockPoses(
              bounceRctx.rctx,
              board,
              isDraggingGlued ? new Set([5, 6]) : draggedSet,
              isDraggingGlued,
              { equippedSkin: skin, colorblindSymbols: colorblind },
              testTimeSec,
              0
            );

            // Glued pair (5, 6) shares identical pose; immobilized glued pair (7, 8) stays at rest
            const p5 = poses.get(5);
            const p6 = poses.get(6);
            const p7 = poses.get(7);
            const p8 = poses.get(8);
            expect(p5?.zLift).toBe(p6?.zLift);
            expect(p5?.scaleXY).toBe(p6?.scaleXY);
            expect(p5?.scaleZ).toBe(p6?.scaleZ);
            expect(p7?.zLift).toBe(0);
            expect(p8?.zLift).toBe(0);

            if (testTimeSec === 0.18 || testTimeSec === 3.38) {
              for (const block of board.blocks) {
                const activeColor: ColorId = getActiveColor(block.colorStack, block.colorCursor);
                const layersLeft = getLayersRemaining(block.colorStack, block.colorCursor);
                const single = createBoardState({
                  ...spec,
                  blocks: [{ ...block, groupId: 0 }],
                });
                if (isDraggingGlued && block.groupId === 1) {
                  single.blocks[0].liftAlpha = 1.0;
                }
                const singleDragged =
                  isDraggingGlued && block.groupId === 1 ? new Set([block.id]) : draggedSet;
                const singlePose = computeBoardAnimatedBlockPoses(
                  createSpyRenderContext().rctx,
                  single,
                  singleDragged,
                  singleDragged.size > 0,
                  { equippedSkin: skin, colorblindSymbols: colorblind },
                  testTimeSec,
                  0
                ).get(block.id);
                expect(singlePose).toBeDefined();
                if (!singlePose) continue;
                const topSurfaceZ =
                  singlePose.zLift +
                  getBlockSurfaceTopLocalZ(skin, layersLeft, activeColor) * singlePose.scaleZ;
                const opts: RenderSceneOptions = {
                  equippedSkin: skin,
                  equippedTray: 'industrial_slate',
                  colorblindSymbols: colorblind,
                  blueprintMix: 0,
                  timeSec: testTimeSec,
                };
                const spy = createSpyRenderContext(opts);
                renderPass3BlocksImpl(
                  spy.rctx,
                  spy.gl,
                  single,
                  opts,
                  skin,
                  false,
                  colorblind,
                  0.5,
                  testTimeSec,
                  0
                );

                for (const med of spy.medallionCalls) {
                  expect(med.zBase + 0.082 * singlePose.scaleZ).toBeGreaterThan(topSurfaceZ);
                  expect(med.topZ).toBeGreaterThan(topSurfaceZ);
                }
                for (const b of spy.badgeCalls) {
                  expect(b.z).toBeGreaterThan(topSurfaceZ);
                }
                for (const n of spy.numberCalls) {
                  expect(n.z).toBeGreaterThan(topSurfaceZ);
                }
              }
            }

            // Full board Pass 3 draw check for glued weld clamp clearance during idle hop, bounce & drag
            const fullOpts: RenderSceneOptions = {
              equippedSkin: skin,
              equippedTray: 'industrial_slate',
              colorblindSymbols: colorblind,
              blueprintMix: 0,
              timeSec: testTimeSec,
            };
            const fullSpy = createSpyRenderContext(fullOpts);
            if (!isDraggingGlued && testTimeSec === 1.2) {
              fullSpy.rctx.blockBounceMap.set(5, 0.17);
            }
            renderPass3BlocksImpl(
              fullSpy.rctx,
              fullSpy.gl,
              board,
              fullOpts,
              skin,
              false,
              colorblind,
              0.5,
              testTimeSec,
              0
            );
            const clampCall = fullSpy.meshCalls.find(
              (m) => Math.abs(m.tx - 2.0) < 0.15 && Math.abs(m.ty - 4.5) < 0.05 && m.style === 0
            );
            expect(clampCall).toBeDefined();
            if (clampCall && p5) {
              expect(clampCall.tz).toBeCloseTo(p5.zLift, 5);
              expect(clampCall.tz + 0.62 * clampCall.sz).toBeGreaterThan(p5.zLift + 0.58 * p5.scaleZ);
            }
          }
        }
      }
    }
  });
});
