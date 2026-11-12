// @ts-expect-error Node built-in module resolved at runtime by Vitest
import fs from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by Vitest
import path from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd: () => string };

import { applyBoosterHammer, cloneBoardState, commitBlockMove, createBoardState } from '../../src/core/board';
import { setFxRandomSeed } from '../../src/core/fx-random';
import {
  COLOR_PALETTE,
  type ColorId,
  type GateState,
  type LevelSpec,
  type ParticleStyleId,
} from '../../src/core/types';
import { buildCommittedMoveTrace } from '../../src/input/targeting-and-keyboard';
import { getLevelSpec } from '../../src/levels/catalog';
import { Camera3D, computeBoardBleedFraming, REFERENCE_PLANE_Z } from '../../src/render/camera-3d';
import {
  detectAutomaticShredEventsImpl,
  spawnAmbientCourtyardMotesImpl,
  spawnParticlesAtImpl,
  stepParticlesImpl,
} from '../../src/render/particle-fx';
import { spawnPathTraceImpl } from '../../src/render/pass2-drag-fx';
import {
  INSTANCE_STRIDE,
  MAX_PARTICLES,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  QualityGovernor,
  type RenderPassContext,
  type VisualShockwave,
} from '../../src/render/render-types';
import { MAIN_FRAGMENT_SHADER } from '../../src/render/shaders-3d';
import { PARTICLE_FRAGMENT_SHADER } from '../../src/render/shaders-particles';
import {
  getStyleTagForParticle,
  spawnStyledParticlesImpl,
  spawnStyledShredShockwavesAndGateFx,
  stepGateBurstsImpl,
  stepStyledParticleSlot,
  type VisualGateBurst,
} from '../../src/render/shred-style-fx';

function createMockParticleContext(reducedMotion = false): RenderPassContext {
  const qualityGovernor = new QualityGovernor();
  qualityGovernor.setPreference('ULTRA_120');
  const activeShockwaves: VisualShockwave[] = [];
  const activeGateBursts: VisualGateBurst[] = [];

  const rctx = {
    qualityGovernor,
    particlePool: new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE),
    particleInstanceData: new Float32Array(MAX_PARTICLES * INSTANCE_STRIDE),
    smokeInstanceData: new Float32Array(MAX_SMOKE_PUFFS * INSTANCE_STRIDE),
    activeParticleCount: 0,
    activeSmokeCount: 0,
    particlePoolCount: 0,
    particleWriteCursor: 0,
    activeShockwaves,
    activeGateBursts,
    activePathTraces: [],
    activeVisualShreds: [],
    blockBounceMap: new Map(),
    roomAwakenMap: new Map(),
    blockLayerSnapshots: new Map(),
    crateSnapshots: new Map(),
    gateSnapshots: new Map(),
    elevatorSnapshots: new Map(),
    barrierSnapshots: new Map(),
    lastBoardLevelId: -1,
    lastSessionShredded: 0,
    lastMovesCommitted: 0,
    lastSyncedBoardRef: null,
    ambientMoteAccumSec: 0,
    boardShakeTimer: 0,
    boardShakeDirX: 0,
    boardShakeDirY: 0,
    lastOptions: {
      reducedMotion,
      highContrast: false,
      colorblindSymbols: false,
    },
    getColorRgb: (
      colorId: ColorId,
      highContrast = false,
      colorblind = Boolean(rctx.lastOptions.colorblindSymbols)
    ) => {
      const e = COLOR_PALETTE[colorId] ?? COLOR_PALETTE[1];
      return colorblind ? (highContrast ? e.cbHcRgb : e.cbRgb) : highContrast ? e.hcRgb : e.rgb;
    },
    spawnParticlesAt: (
      wx: number,
      wy: number,
      wz: number,
      cId: ColorId,
      cnt?: number,
      dx = 0,
      dy = 0,
      st: ParticleStyleId = 'micro_cubes'
    ) => {
      spawnParticlesAtImpl(rctx as unknown as RenderPassContext, wx, wy, wz, cId, cnt, dx, dy, st);
    },
    spawnShockwave: (
      cx: number,
      cy: number,
      z: number,
      r: number,
      g: number,
      b: number,
      minRadius = 0.28,
      maxRadius = 1.65,
      maxAge = 0.42
    ) => {
      if (rctx.lastOptions.reducedMotion) return;
      activeShockwaves.push({ cx, cy, z, r, g, b, age: 0.001, maxAge, minRadius, maxRadius });
    },
  };

  return rctx as unknown as RenderPassContext;
}

describe('SHRED-STYLE-01: 5 Distinct Shred Animations, Physics & Reduced-Motion Gate Seals', () => {
  it('floats abundant multi-size soap_bubbles on meandering air currents with pop swell while micro_cubes fall and bounce once', () => {
    setFxRandomSeed(1337);
    const bubbleCtx = createMockParticleContext(false);
    spawnStyledParticlesImpl(bubbleCtx, 2.5, 2.5, 0.42, 2, 24, 0, -1, 'soap_bubbles');
    // 1.48x bubble abundance (>34 bubbles for baseCount = 24) across 3 distinct radius tiers
    expect(bubbleCtx.particlePoolCount).toBeGreaterThanOrEqual(35);
    expect(bubbleCtx.particlePool[14]).toBe(getStyleTagForParticle('soap_bubbles'));
    const distinctTierRadii = new Set<string>();
    for (let i = 0; i < bubbleCtx.particlePoolCount; i++) {
      const rScale = bubbleCtx.particlePool[i * PARTICLE_STRIDE + 9];
      distinctTierRadii.add(rScale < 0.1 ? 'micro' : rScale < 0.15 ? 'med' : 'jumbo');
    }
    expect(distinctTierRadii.size).toBe(3);

    const initialZ = bubbleCtx.particlePool[2];
    const maxAge = bubbleCtx.particlePool[11];
    expect(maxAge).toBeGreaterThanOrEqual(1.48);
    // Zero initial horizontal velocity so any horizontal travel proves swirling air-current eddies
    bubbleCtx.particlePool[3] = 0;
    const startX = bubbleCtx.particlePool[0];
    let maxLateralMeander = 0;
    let earlyScaleMul = 1;
    let popScaleMul = 1;
    const steps = 28;
    const dt = (maxAge * 0.92) / steps;
    let age = 0.001;
    for (let s = 0; s < steps; s++) {
      age += dt;
      const mul = stepStyledParticleSlot(bubbleCtx.particlePool, 0, dt, age, maxAge);
      maxLateralMeander = Math.max(maxLateralMeander, Math.abs(bubbleCtx.particlePool[0] - startX));
      if (s === 4) earlyScaleMul = mul;
      if (age / maxAge > 0.86) popScaleMul = Math.max(popScaleMul, mul);
    }
    expect(maxLateralMeander).toBeGreaterThan(0.18);
    expect(bubbleCtx.particlePool[2]).toBeGreaterThan(initialZ + 0.65);
    expect(popScaleMul).toBeGreaterThan(earlyScaleMul);
    expect(popScaleMul).toBeGreaterThan(1.1);

    // Compare against micro_cubes falling under gravity and bouncing once at z = 0.045
    const cubeCtx = createMockParticleContext(false);
    spawnStyledParticlesImpl(cubeCtx, 2.5, 2.5, 0.22, 1, 12, 0, -1, 'micro_cubes');
    cubeCtx.particlePool[2] = 0.12;
    cubeCtx.particlePool[5] = -1.6;
    expect(cubeCtx.particlePool[14]).toBe(0);

    for (let s = 0; s < 10; s++) {
      stepStyledParticleSlot(cubeCtx.particlePool, 0, 1 / 60, (s + 1) / 60, 0.8);
    }
    expect(cubeCtx.particlePool[14]).toBe(10); // bounced once -> styleTag promoted 0 -> 10
    expect(cubeCtx.particlePool[5]).toBeGreaterThan(0); // upward rebound velocity
    setFxRandomSeed(null);
  });

  it('aligns pixel_sparks to velocity vector with floor ricochet and mixes foil gold into star_confetti', () => {
    setFxRandomSeed(2026);
    const sparkCtx = createMockParticleContext(false);
    spawnStyledParticlesImpl(sparkCtx, 3, 3, 0.1, 3, 18, 1, 0, 'pixel_sparks');
    sparkCtx.particlePool[2] = 0.08;
    sparkCtx.particlePool[5] = -1.5;

    for (let s = 0; s < 8; s++) {
      stepStyledParticleSlot(sparkCtx.particlePool, 0, 1 / 60, (s + 1) / 60, 0.5);
    }
    const expectedAngle = Math.atan2(sparkCtx.particlePool[4], sparkCtx.particlePool[3]);
    expect(sparkCtx.particlePool[12]).toBeCloseTo(expectedAngle, 5);
    expect(sparkCtx.particlePool[14]).toBe(12); // ricocheted 2 -> 12

    const confettiCtx = createMockParticleContext(false);
    spawnStyledParticlesImpl(confettiCtx, 3, 3, 0.42, 1, 24, 0, 1, 'star_confetti');
    let goldCount = 0;
    for (let i = 0; i < confettiCtx.particlePoolCount; i++) {
      const idx = i * PARTICLE_STRIDE;
      if (
        confettiCtx.particlePool[idx + 6] === 1.0 &&
        Math.abs(confettiCtx.particlePool[idx + 7] - 0.86) < 0.01
      ) {
        goldCount++;
      }
    }
    expect(goldCount).toBeGreaterThan(4);
    expect(goldCount).toBeLessThan(confettiCtx.particlePoolCount);
    setFxRandomSeed(null);
  });

  it('spawns outward-branching Pass 3 Gate Plasma Arcs + velocity-aligned stepped-leader sparks for lightning_bolts and enforces stationary Gate Seals in Reduced Motion', () => {
    setFxRandomSeed(99);
    const sampleGate: GateState = {
      index: 0,
      edge: 'TOP',
      edgeLine: 0,
      spanStart: 1,
      spanLength: 2,
      colorQueue: [2],
      colorCursor: 0,
      isStar: false,
      iceCount: 0,
      shutterLockColor: 0,
      togglesOnClear: false,
      shutterOpen: true,
      slidesOnClear: false,
      slideMin: 1,
      slideMax: 1,
      slideDir: 1,
      sizeChangesOnClear: false,
      minLength: 2,
      maxLength: 2,
      sizeDir: 1,
      rollerPhase: 0,
    };

    const boltCtx = createMockParticleContext(false);
    spawnStyledShredShockwavesAndGateFx(boltCtx, 2, 0.5, 2, sampleGate, 'lightning_bolts');
    expect(boltCtx.activeShockwaves.length).toBe(2);
    expect(boltCtx.activeGateBursts).toHaveLength(1);
    expect(boltCtx.activeGateBursts[0].mode).toBe('PLASMA_ARCS');
    expect(boltCtx.activeGateBursts[0].z).toBeGreaterThanOrEqual(0.7);
    expect(boltCtx.activeGateBursts[0].ny).toBe(-1);

    spawnStyledParticlesImpl(boltCtx, 2, -0.08, 0.42, 2, 20, 0, -1, 'lightning_bolts');
    expect(boltCtx.particlePool[14]).toBe(4);
    const maxBoltAge = boltCtx.particlePool[11];
    for (let s = 1; s <= 12; s++) {
      stepStyledParticleSlot(boltCtx.particlePool, 0, maxBoltAge / 20, (s * maxBoltAge) / 20, maxBoltAge);
      expect(boltCtx.particlePool[12]).toBeCloseTo(
        Math.atan2(boltCtx.particlePool[4], boltCtx.particlePool[3]),
        5
      );
    }
    expect(boltCtx.particlePool[14]).toBe(14); // stepped-leader jolt deflection triggered once

    const styles: ParticleStyleId[] = [
      'micro_cubes',
      'star_confetti',
      'pixel_sparks',
      'soap_bubbles',
      'lightning_bolts',
    ];
    const rmCtx = createMockParticleContext(true);
    for (const st of styles) {
      spawnStyledShredShockwavesAndGateFx(rmCtx, 2, 0.5, 2, sampleGate, st);
      spawnStyledParticlesImpl(rmCtx, 2, 0.5, 0.42, 2, 32, 0, -1, st);
    }
    expect(rmCtx.particlePoolCount).toBe(0);
    expect(rmCtx.activeShockwaves).toHaveLength(0);
    expect(rmCtx.activeGateBursts).toHaveLength(5);
    expect(rmCtx.activeGateBursts.map((b) => b.mode)).toEqual(Array(5).fill('REDUCED_MOTION_SEAL'));
    expect(rmCtx.activeGateBursts.map((b) => b.style)).toEqual(styles);

    stepGateBurstsImpl(rmCtx, 0.45);
    expect(rmCtx.activeGateBursts).toHaveLength(0);
    setFxRandomSeed(null);
  });

  it('keeps PARTICLE_FRAGMENT_SHADER free of fragment discard for mobile tile-GPU LRZ Early-Z', () => {
    const uncommentedGlsl = PARTICLE_FRAGMENT_SHADER.replace(/\/\/.*$/gm, '');
    expect(uncommentedGlsl).not.toMatch(/\bdiscard\b/);
  });

  it('preserves 0.00px board projection & exact ray-plane inverse across particle-bleed viewports while dispersing & fading outward', () => {
    const cases = [
      { name: 'mobile-portrait-6x6', rows: 6, cols: 6, stageW: 378, stageH: 668, canvasW: 390, canvasH: 537 },
      { name: 'desktop-6x6', rows: 6, cols: 6, stageW: 708, stageH: 612, canvasW: 720, canvasH: 624 },
      { name: 'desktop-l28-8x6', rows: 8, cols: 6, stageW: 708, stageH: 612, canvasW: 587, canvasH: 624 },
      { name: 'landscape-6x6', rows: 6, cols: 6, stageW: 720, stageH: 236, canvasW: 286, canvasH: 248 },
    ];

    for (const tc of cases) {
      const f = computeBoardBleedFraming(tc.rows, tc.cols, tc.canvasW, tc.canvasH, tc.stageW, tc.stageH);
      const boxW = tc.canvasW * f.scaleX;
      const boxH = tc.canvasH * f.scaleY;

      // Unpadded legacy board rect centered at the identical screen midpoint (500, 500)
      const tightRect = {
        left: 500 - boxW * 0.5,
        top: 500 - boxH * 0.5,
        width: boxW,
        height: boxH,
      } as DOMRect;
      const bleedRect = {
        left: 500 - tc.canvasW * 0.5,
        top: 500 - tc.canvasH * 0.5,
        width: tc.canvasW,
        height: tc.canvasH,
      } as DOMRect;

      const tightCam = new Camera3D(tc.rows, tc.cols, f.boardAspect);
      const bleedCam = new Camera3D(tc.rows, tc.cols, f.boardAspect);

      for (const [bx, by] of [
        [0, 0],
        [tc.cols * 0.5, tc.rows * 0.5],
        [tc.cols, tc.rows],
        [1.5, 4.5],
      ]) {
        const pTight = tightCam.boardToScreen(bx, by, REFERENCE_PLANE_Z, tightRect, tc.rows, tc.cols);
        const pBleed = bleedCam.boardToScreen(
          bx,
          by,
          REFERENCE_PLANE_Z,
          bleedRect,
          tc.rows,
          tc.cols,
          f.scaleX,
          f.scaleY,
          f.boardAspect
        );
        expect(Math.abs(pBleed.x - pTight.x), `${tc.name} x`).toBeLessThan(1e-4);
        expect(Math.abs(pBleed.y - pTight.y), `${tc.name} y`).toBeLessThan(1e-4);

        const unproj = bleedCam.screenToBoardRayPlane(
          pBleed.x,
          pBleed.y,
          bleedRect,
          tc.rows,
          tc.cols,
          f.scaleX,
          f.scaleY,
          f.boardAspect
        );
        expect(unproj.boardX).toBeCloseTo(bx, 4);
        expect(unproj.boardY).toBeCloseTo(by, 4);
      }
    }

    // Verify outward shred burst sails > 1.2 cells beyond the gate and packs decaying 10-bit lifeRatio
    setFxRandomSeed(4242);
    const rctx = createMockParticleContext(false);
    spawnStyledParticlesImpl(rctx, 3.0, 0.0, 0.42, 2, 24, 0, -1, 'star_confetti');
    stepParticlesImpl(rctx, 1 / 60);
    const earlyLife = Math.floor(rctx.particleInstanceData[3]) / 1023;
    expect(earlyLife).toBeGreaterThan(0.92);

    for (let k = 0; k < 42; k++) {
      stepParticlesImpl(rctx, 1 / 60);
    }
    let minY = 0;
    let lateLife = 1;
    for (let i = 0; i < rctx.activeParticleCount; i++) {
      const base = i * INSTANCE_STRIDE;
      minY = Math.min(minY, rctx.particleInstanceData[base + 1]);
      lateLife = Math.min(lateLife, Math.floor(rctx.particleInstanceData[base + 3]) / 1023);
    }
    expect(minY).toBeLessThan(-1.2);
    expect(lateLife).toBeLessThan(0.35);
    setFxRandomSeed(null);
  });

  it('FX-STATE-01..03: emits 0 pre-collision block/gate particles, spawns shreds strictly at gate jaws outward, and clears transient FX on Undo/Restart/ReducedMotion', () => {
    setFxRandomSeed(2027);
    const rctx = createMockParticleContext(false);
    const board = createBoardState(getLevelSpec(1));
    const opts = { equippedParticle: 'lightning_bolts' as ParticleStyleId, reducedMotion: false };
    rctx.lastOptions = opts;

    // 1. Initial sync + 180 idle frames (3 full seconds) + non-shredding block slides -> ZERO particles or bursts
    detectAutomaticShredEventsImpl(rctx, board, opts);
    for (let f = 0; f < 180; f++) {
      spawnAmbientCourtyardMotesImpl(rctx, board, opts, 1 / 60, f / 60);
      detectAutomaticShredEventsImpl(rctx, board, opts);
      stepParticlesImpl(rctx, 1 / 60);
    }
    expect(rctx.particlePoolCount).toBe(0);
    expect(rctx.activeParticleCount).toBe(0);
    expect(rctx.activeShockwaves).toHaveLength(0);
    expect(rctx.activeGateBursts).toHaveLength(0);

    // Slide a block to another interior cell (no shredder collision) -> still ZERO particles
    const preSlideSnapshot = cloneBoardState(board);
    const movable = board.blocks.find((b) => b.col === 3 && b.row === 2);
    expect(movable).toBeDefined();
    if (movable) {
      commitBlockMove(board, movable.id, 1, 3, 'CHALLENGE');
    }
    detectAutomaticShredEventsImpl(rctx, board, opts);
    stepParticlesImpl(rctx, 1 / 60);
    expect(rctx.activeParticleCount).toBe(0);
    expect(rctx.activeGateBursts).toHaveLength(0);

    // 2. Shred into TOP gate (edgeLine = 0): particles originate strictly at the gate jaw (y <= 0.02) and spray outward (vy < -0.5)
    const shredTarget = board.blocks[0];
    commitBlockMove(board, shredTarget.id, 0, shredTarget.col, 'CHALLENGE');
    detectAutomaticShredEventsImpl(rctx, board, opts);
    expect(rctx.particlePoolCount).toBeGreaterThan(12);
    expect(rctx.activeVisualShreds.length).toBeGreaterThan(0);
    for (let i = 0; i < rctx.particlePoolCount; i++) {
      const idx = i * PARTICLE_STRIDE;
      expect(rctx.particlePool[idx + 1]).toBeLessThanOrEqual(0.02);
      expect(rctx.particlePool[idx + 4]).toBeLessThan(-0.5);
    }
    stepParticlesImpl(rctx, 1 / 60);
    expect(rctx.activeParticleCount).toBeGreaterThan(12);

    // 3. Undo (restoring preSlideSnapshot BoardState reference) immediately purges all in-flight particles, shreds, shockwaves & gate bursts
    detectAutomaticShredEventsImpl(rctx, preSlideSnapshot, opts);
    expect(rctx.activeParticleCount).toBe(0);
    expect(rctx.particlePoolCount).toBe(0);
    expect(rctx.activeVisualShreds).toHaveLength(0);
    expect(rctx.activeShockwaves).toHaveLength(0);
    expect(rctx.activeGateBursts).toHaveLength(0);

    // 4. Move-0 2-layer peel (movesCommitted === 0, sessionBlocksShredded === 0) & Move-0 Hammer strike + Same-Level Restart
    const multiSpec = getLevelSpec(11);
    const multiBoard = createBoardState(multiSpec);
    if (multiBoard.blocks[0].colorStack.length < 2) {
      multiBoard.blocks[0].colorStack = [1, 2];
    }
    detectAutomaticShredEventsImpl(rctx, multiBoard, opts);
    const layered = multiBoard.blocks.find((b) => b.colorStack.length > 1);
    expect(layered).toBeDefined();
    if (layered) {
      layered.colorCursor = 1;
      layered.shredGateIndex = 0;
      expect(multiBoard.movesCommitted).toBe(0);
      expect(multiBoard.sessionBlocksShredded).toBe(0);
      detectAutomaticShredEventsImpl(rctx, multiBoard, opts);
      stepParticlesImpl(rctx, 1 / 60);
      expect(rctx.activeParticleCount).toBeGreaterThan(10);

      // Fresh BoardState for the same levelId at Move 0 resets cleanly with 0 ghost particles or bogus diff bursts
      const restartedSameLevel = createBoardState(multiSpec);
      detectAutomaticShredEventsImpl(rctx, restartedSameLevel, opts);
      expect(rctx.activeParticleCount).toBe(0);
      expect(rctx.particlePoolCount).toBe(0);
      expect(rctx.activeShockwaves).toHaveLength(0);

      // Move-0 Hammer strike (movesCommitted === 0, sessionBlocksShredded === 1) + Same-Level Restart also purges all FX
      applyBoosterHammer(
        restartedSameLevel,
        restartedSameLevel.blocks[0].row,
        restartedSameLevel.blocks[0].col
      );
      expect(restartedSameLevel.movesCommitted).toBe(0);
      expect(restartedSameLevel.sessionBlocksShredded).toBe(1);
      detectAutomaticShredEventsImpl(rctx, restartedSameLevel, opts);
      stepParticlesImpl(rctx, 1 / 60);
      expect(rctx.activeParticleCount).toBeGreaterThan(10);

      const restartedAfterHammer = createBoardState(multiSpec);
      detectAutomaticShredEventsImpl(rctx, restartedAfterHammer, opts);
      expect(rctx.activeParticleCount).toBe(0);
      expect(rctx.particlePoolCount).toBe(0);
    }

    // 5. Toggling Reduced Motion mid-burst immediately drains all flying particles
    spawnStyledParticlesImpl(rctx, 2, 0, 0.42, 1, 20, 0, -1, 'star_confetti');
    stepParticlesImpl(rctx, 1 / 60);
    expect(rctx.activeParticleCount).toBeGreaterThan(10);
    rctx.lastOptions = { ...opts, reducedMotion: true };
    stepParticlesImpl(rctx, 1 / 60);
    expect(rctx.activeParticleCount).toBe(0);
    expect(rctx.particlePoolCount).toBe(0);
    setFxRandomSeed(null);
  });

  it('MYSTIC-TRACE-01: keeps motion-blur traces smoothly rounded on diagonals & bends with zero mid-board flat cuts or leading-edge leak', () => {
    expect(MAIN_FRAGMENT_SHADER).toContain('alongHalf');
    expect(MAIN_FRAGMENT_SHADER).toContain('bestShadowD');
    expect(MAIN_FRAGMENT_SHADER).not.toContain('min(hw, 0.16)');
    const rctx = createMockParticleContext(false);
    const board = createBoardState(getLevelSpec(1));

    // 1. 1x1 block moving 1 cell right (col 1 -> col 2; landed cell [2, 3] x [2, 3])
    rctx.activePathTraces.length = 0;
    spawnPathTraceImpl(
      rctx,
      [
        { x: 1.5, y: 2.5 },
        { x: 2.5, y: 2.5 },
      ],
      1,
      0,
      1,
      1,
      false
    );
    expect(rctx.activePathTraces).toHaveLength(1);
    const monoTr = rctx.activePathTraces[0];
    const monoSeg = monoTr.segments[monoTr.segments.length - 1];
    expect(monoSeg.x0).toBeLessThan(2.045);
    expect(monoSeg.x1).toBeCloseTo(2.5, 4);
    expect(monoTr.headOriginX).toBeCloseTo(2, 4);
    expect(monoTr.headCellMask).toBe(1);

    // 2. Wide 1x3 horizontal bar (cols=3, rows=1) nudged 1 cell UP (row 3 -> row 2; landed [1, 4] x [2, 3])
    rctx.activePathTraces.length = 0;
    spawnPathTraceImpl(
      rctx,
      [
        { x: 2.5, y: 3.5 },
        { x: 2.5, y: 2.5 },
      ],
      2,
      0,
      3,
      1,
      false
    );
    expect(rctx.activePathTraces).toHaveLength(1);
    const wideTr = rctx.activePathTraces[0];
    const wideSeg = wideTr.segments[wideTr.segments.length - 1];
    expect(wideSeg.y0).toBeGreaterThan(3.0);
    expect(wideSeg.y1).toBeCloseTo(2.5, 4);
    expect(wideTr.headOriginY).toBeCloseTo(2, 4);
    expect(wideTr.headCellMask).toBe(0b111);

    // 3. Long 1x3 horizontal bar (cols=3, rows=1) nudged 1 cell RIGHT (col 1 -> col 2; vacated [1, 2])
    rctx.activePathTraces.length = 0;
    spawnPathTraceImpl(
      rctx,
      [
        { x: 2.5, y: 2.5 },
        { x: 3.5, y: 2.5 },
      ],
      3,
      0,
      3,
      1,
      false
    );
    expect(rctx.activePathTraces).toHaveLength(1);
    const longSeg = rctx.activePathTraces[0].segments[rctx.activePathTraces[0].segments.length - 1];
    expect(longSeg.x0).toBeLessThan(1.35);
    expect(longSeg.x0 - 0.18).toBeGreaterThanOrEqual(0.99);
    expect(longSeg.x1).toBeCloseTo(3.5, 4);

    // 4. Diagonal 2x2 glide from (col=0, row=4) to (col=4, row=0) ([4, 6] x [0, 2]):
    //    Reaches (5.0, 1.0) immediately from Frame 0 with both lateral wings tucked strictly inside [4, 6] x [0, 2]
    //    and near-circular longitudinal cap ratio (~1:1, never squared-off)!
    rctx.activePathTraces.length = 0;
    spawnPathTraceImpl(
      rctx,
      [
        { x: 1.0, y: 5.0 },
        { x: 5.0, y: 1.0 },
      ],
      4,
      0,
      2,
      2,
      false
    );
    expect(rctx.activePathTraces).toHaveLength(1);
    const diagTr = rctx.activePathTraces[0];
    const diagSeg = diagTr.segments[0];
    expect(diagSeg.x1).toBeCloseTo(5.0, 4);
    expect(diagSeg.y1).toBeCloseTo(1.0, 4);
    const diagHw = (diagSeg.width ?? 1) * 0.5;
    const leftWingX = diagSeg.x1 - Math.SQRT1_2 * diagHw;
    const rightWingY = diagSeg.y1 + Math.SQRT1_2 * diagHw;
    expect(leftWingX).toBeGreaterThan(4.05);
    expect(rightWingY).toBeLessThan(1.95);
    const diagAlongHalf = 0.5 * (Math.SQRT1_2 * 2 + Math.SQRT1_2 * 2);
    expect(Math.min(diagHw, diagAlongHalf * 0.84) / diagHw).toBeGreaterThan(0.94);

    // 5. Multi-segment L-bend: 1x3 vertical bar (cols=1, rows=3) sliding 2 cells RIGHT (col 1 -> 3) then 1 cell DOWN (row 1 -> 2)
    rctx.activePathTraces.length = 0;
    spawnPathTraceImpl(
      rctx,
      [
        { x: 1.5, y: 2.5 },
        { x: 3.5, y: 2.5 },
        { x: 3.5, y: 3.5 },
      ],
      4,
      0,
      1,
      3,
      false
    );
    expect(rctx.activePathTraces).toHaveLength(1);
    const lBendSegs = rctx.activePathTraces[0].segments;
    expect(lBendSegs.length).toBeGreaterThanOrEqual(4);
    for (let sIdx = 0; sIdx < lBendSegs.length; sIdx++) {
      const seg = lBendSegs[sIdx];
      const ux = Math.abs(Math.cos(seg.rotZ));
      const uy = Math.abs(Math.sin(seg.rotZ));
      const endCap = Math.max(0.32, 0.5 * (ux * 1 + uy * 3) * 0.84);
      const jointCap = Math.min(1, 3) * 0.44;
      const posCap = sIdx === lBendSegs.length - 1 ? endCap : jointCap;
      expect(seg.x1 + ux * posCap).toBeLessThan(3.96);
    }

    // 6. Non-convex L3_BL excludes its empty top-right notch cell (bit 1 === 0) & gate shreds set headCellMask = 0
    const lShapeTrace = buildCommittedMoveTrace(board, 'L3_BL', 2, 1, 1, 2, 3, -1);
    expect(lShapeTrace?.cellMask).toBe((1 << 0) | (1 << 4) | (1 << 5));
    expect((lShapeTrace?.cellMask ?? 0) & (1 << 1)).toBe(0);

    const shredTrace = buildCommittedMoveTrace(board, '1x1', 1, 2, 0, 2, 1, 0);
    expect(shredTrace?.intoGate).toBe(true);

    // 6. 2-layer peel -> interior slide -> Hammer strike resets shredGateIndex (-1) so neither trace nor booster explosion teleports to old gate
    const peelSpec: LevelSpec = {
      id: 991,
      name: 'Two Layer Peel Reset Check',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      blocks: [{ id: 1, shapeId: '1x1', row: 1, col: 2, colorStack: [1, 2] }],
      gates: [
        { edge: 'TOP', spanStart: 2, spanLength: 1, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 2, spanLength: 1, colorQueue: [2] },
      ],
    };
    const peelBoard = createBoardState(peelSpec);
    detectAutomaticShredEventsImpl(rctx, peelBoard, rctx.lastOptions);
    const peelOut = commitBlockMove(peelBoard, 1, 0, 2, 'ZEN');
    expect(peelOut.peeledBlockIds).toEqual([1]);
    expect(peelBoard.blocks[0].shredGateIndex).toBe(0);
    detectAutomaticShredEventsImpl(rctx, peelBoard, rctx.lastOptions);

    const slideOut = commitBlockMove(peelBoard, 1, 3, 2, 'ZEN');
    expect(slideOut.moved).toBe(true);
    expect(peelBoard.blocks[0].shredGateIndex).toBe(-1);
    const postPeelTrace = buildCommittedMoveTrace(
      peelBoard,
      '1x1',
      0,
      2,
      3,
      2,
      2,
      peelBoard.blocks[0].shredGateIndex
    );
    expect(postPeelTrace?.intoGate).toBe(false);
    detectAutomaticShredEventsImpl(rctx, peelBoard, rctx.lastOptions);

    rctx.particlePoolCount = 0;
    rctx.activeVisualShreds.length = 0;
    expect(applyBoosterHammer(peelBoard, 3, 2)).toBe(true);
    expect(peelBoard.blocks[0].shredGateIndex).toBe(-1);
    detectAutomaticShredEventsImpl(rctx, peelBoard, rctx.lastOptions);
    expect(rctx.activeVisualShreds).toHaveLength(0);
    expect(rctx.particlePoolCount).toBeGreaterThan(10);
    // Particles spawn around interior cell (col=2 -> x~2.5, row=3 -> y~3.5), never teleported back to TOP Gate 0 (y <= 0.1)
    expect(rctx.particlePool[1]).toBeGreaterThan(2.5);

    // 7. Colorblind + Reduced Motion Gate Seal uses CVD palette & Retina DPR stays unpenalized under 1.36x bleed
    const cvdCtx = createMockParticleContext(true);
    cvdCtx.lastOptions.colorblindSymbols = true;
    spawnStyledShredShockwavesAndGateFx(cvdCtx, 2.5, 0, 1, peelBoard.gates[0], 'star_confetti');
    expect(cvdCtx.activeGateBursts).toHaveLength(1);
    expect([
      cvdCtx.activeGateBursts[0].r,
      cvdCtx.activeGateBursts[0].g,
      cvdCtx.activeGateBursts[0].b,
    ]).toEqual(COLOR_PALETTE[1].cbRgb);

    const bleedDesktop = computeBoardBleedFraming(6, 6, 682, 624, 960, 624);
    const boardMaxCss = Math.max(682 * bleedDesktop.scaleX, 624 * bleedDesktop.scaleY);
    const effectiveRetinaDpr = Math.min(2, Math.max(1, 900 / boardMaxCss));
    expect(boardMaxCss * effectiveRetinaDpr).toBeGreaterThanOrEqual(899);
  });

  it('LAN-DEVTOOLS-01: strips LAN debug unlock UI from production builds while enabling compile-time LAN unlocks', () => {
    const repoRoot = path.resolve(process.cwd());
    const prodConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
    const lanConfig = fs.readFileSync(path.join(repoRoot, 'vite.lan.config.ts'), 'utf8');
    expect(prodConfig).toContain("__SHREDBLOCKS_LAN_DEVTOOLS__: 'false'");
    expect(lanConfig).toContain("__SHREDBLOCKS_LAN_DEVTOOLS__: 'true'");

    const distAssetsDir = path.join(repoRoot, 'dist', 'assets');
    if (fs.existsSync(distAssetsDir)) {
      const jsFiles = (fs.readdirSync(distAssetsDir) as string[]).filter((f) => f.endsWith('.js'));
      expect(jsFiles.length).toBeGreaterThan(0);
      for (const file of jsFiles) {
        const bundleText = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
        expect(bundleText).not.toContain('LAN DevTools');
        expect(bundleText).not.toContain('btn-lan-unlock');
        expect(bundleText).not.toContain('shredblocks.lan_debug_backup');
      }
    }
  });
});
