import { afterEach, describe, expect, it } from 'vitest';
import { createBoardState } from '../../src/core/board';
import { setFxRandomSeed } from '../../src/core/fx-random';
import { getLevelSpec } from '../../src/levels/catalog';
import { Camera3D } from '../../src/render/camera-3d';
import { resetTransientFxImpl, spawnRelicAwakeningBurstImpl } from '../../src/render/relic-awakening-fx';
import {
  MAX_PARTICLES,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  type RenderPassContext,
} from '../../src/render/render-types';
import { MAIN_FRAGMENT_SHADER } from '../../src/render/shaders-3d';
import { GLSL_STONE_LIB } from '../../src/render/shaders-glsl-lib';
import {
  RELIC_CLUSTER_TEX_SIZE,
  sampleMajorRegionMask,
  sampleVisibleCrackGlow,
} from '../../src/render/voronoi-cluster-math';
import { rotateRelicVec } from '../../src/render/voronoi-plate-renderer';
import {
  buildBoardVoronoiPlates,
  buildRelicPlateGeometryImpl,
  computePlateRotationMatrix,
  hashRelic22,
  prewarmRelicPlatesForBoard,
  renderRelicPlatesWebGL2Impl,
  spawnRelicVoronoiPlatesImpl,
  stepRelicPlatesImpl,
  warmUpRelicPlatePipelineImpl,
} from '../../src/render/voronoi-plates';

function polygonSignedArea(verts: Float32Array): number {
  const n = verts.length / 2;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += verts[i * 2] * verts[j * 2 + 1] - verts[j * 2] * verts[i * 2 + 1];
  }
  return area2 * 0.5;
}

function createPlateMockRctx(rows: number, cols: number, reducedMotion = false): RenderPassContext {
  return {
    camera: new Camera3D(rows, cols, 1),
    qualityGovernor: {
      getActiveTier: () => 'ULTRA_120',
      setActiveParticles: () => {},
    },
    particlePool: new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE),
    particleInstanceData: new Float32Array(MAX_PARTICLES * 8),
    smokeInstanceData: new Float32Array(MAX_SMOKE_PUFFS * 8),
    activeParticleCount: 0,
    activeSmokeCount: 0,
    particlePoolCount: 0,
    particleWriteCursor: 0,
    relicPlates: [],
    activeRelicPlateCount: 0,
    activeShockwaves: [],
    activeGateBursts: [],
    activePathTraces: [],
    activeVisualShreds: [],
    roomAwakenMap: new Map(),
    blockBounceMap: new Map(),
    boardShakeTimer: 0,
    boardShakeDirX: 0,
    boardShakeDirY: 0,
    lastOptions: {
      reducedMotion,
      equippedSkin: 'classic_studs',
      equippedTray: 'industrial_slate',
      blueprintMix: 0.995,
      timeSec: 2.0,
    },
    startTimeMs: 0,
    spawnShockwave: () => {},
  } as unknown as RenderPassContext;
}

describe('Voronoi Stone-Crust Unwrapping Plates (RELIC-AWAKEN-01)', () => {
  afterEach(() => {
    setFxRandomSeed(null);
  });

  it('matches deterministic hashRelic22 distribution in [0, 1) across positive and negative Voronoi cells', () => {
    for (let y = -2; y <= 8; y++) {
      for (let x = -2; x <= 8; x++) {
        const [a, b] = hashRelic22(x, y);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(1);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(1);
        expect(hashRelic22(x, y)).toEqual([a, b]);
      }
    }
  });

  it('partitions Level 1, sculpted Level 25, and tall Level 74 into wildly uneven crack-matched CCW slabs', () => {
    for (const levelId of [1, 25, 74]) {
      setFxRandomSeed(1337);
      const board = createBoardState(getLevelSpec(levelId));
      const { plates, seamPoints, clusterTexData } = buildBoardVoronoiPlates(board, 2.0);

      expect(plates.length).toBeGreaterThanOrEqual(24);
      expect(seamPoints.length).toBeGreaterThan(0);
      expect(clusterTexData.length).toBe(RELIC_CLUSTER_TEX_SIZE * RELIC_CLUSTER_TEX_SIZE * 4);

      let minArea = Number.POSITIVE_INFINITY;
      let maxArea = 0;
      let multiCellMegaCount = 0;
      let highGlowDetachSum = 0;
      let highGlowCount = 0;
      let darkMegaDetachSum = 0;
      let darkMegaCount = 0;

      for (const p of plates) {
        expect(p.subCells.length).toBeGreaterThanOrEqual(1);
        if (p.subCells.length >= 2 && p.area >= 1.5) {
          multiCellMegaCount++;
        }
        minArea = Math.min(minArea, p.area);
        maxArea = Math.max(maxArea, p.area);
        expect(p.detachT).toBeGreaterThanOrEqual(0.06);
        expect(p.detachT).toBeLessThanOrEqual(0.85);

        if (p.glowAffinity >= 0.65) {
          highGlowDetachSum += p.detachT;
          highGlowCount++;
        } else if (p.glowAffinity <= 0.35 && p.subCells.length >= 2) {
          darkMegaDetachSum += p.detachT;
          darkMegaCount++;
        }

        for (const sc of p.subCells) {
          const vertCount = sc.verts.length / 2;
          expect(vertCount).toBeGreaterThanOrEqual(3);
          expect(sc.edgeFlags.length).toBe(vertCount);
          // Screen-CCW (+X right, +Y down) requires strictly negative area & star-convex fans
          expect(polygonSignedArea(sc.verts)).toBeLessThan(0);
          for (let i = 0; i < vertCount; i++) {
            const j = (i + 1) % vertCount;
            const ax = sc.verts[i * 2] - sc.centerX;
            const ay = sc.verts[i * 2 + 1] - sc.centerY;
            const bx = sc.verts[j * 2] - sc.centerX;
            const by = sc.verts[j * 2 + 1] - sc.centerY;
            expect(ax * by - bx * ay).toBeLessThan(-1e-7);

            // Merged multi-cell major seams must never swallow brightly glowing cracks
            if (sc.edgeFlags[i] === 0 && p.area >= 0.9 && p.subCells.length >= 2) {
              const mx = p.centroidX + (sc.verts[i * 2] + sc.verts[j * 2]) * 0.5;
              const my = p.centroidY + (sc.verts[i * 2 + 1] + sc.verts[j * 2 + 1]) * 0.5;
              const crossesBrightCrack =
                sampleMajorRegionMask(mx, my) >= 0.6 && sampleVisibleCrackGlow(mx, my, 2.0) >= 0.46;
              expect(crossesBrightCrack).toBe(false);
            }
          }
        }
      }

      // Dramatic size variation (giant multi-cell slabs vs small glowing-web wedges)
      expect(multiCellMegaCount).toBeGreaterThanOrEqual(3);
      expect(maxArea / minArea).toBeGreaterThanOrEqual(8.0);

      // Plates sitting on already-glowing cracks break off before dark intact mega-slabs
      expect(highGlowCount).toBeGreaterThan(0);
      expect(darkMegaCount).toBeGreaterThan(0);
      expect(highGlowDetachSum / highGlowCount).toBeLessThan(darkMegaDetachSum / darkMegaCount);

      // Cluster LUT contains both multi-cell clusters (B=0) and hot sub-fractured cells (B=255),
      // and all cells of a shared clusterId agree identically on detachT (G).
      const detachByCluster = new Map<number, number>();
      let subSplitTexels = 0;
      for (let i = 0; i < RELIC_CLUSTER_TEX_SIZE * RELIC_CLUSTER_TEX_SIZE; i++) {
        const cid = clusterTexData[i * 4];
        const dtByte = clusterTexData[i * 4 + 1];
        const subFlag = clusterTexData[i * 4 + 2];
        if (cid === 0) continue;
        if (subFlag === 255) subSplitTexels++;
        const existing = detachByCluster.get(cid);
        if (existing === undefined) detachByCluster.set(cid, dtByte);
        else expect(dtByte).toBe(existing);
      }
      expect(detachByCluster.size).toBeGreaterThanOrEqual(15);
      expect(subSplitTexels).toBeGreaterThanOrEqual(2);
    }
  });

  it('detaches crack-adjacent plates first, packs seamless 3D slabs, drains to 0, and honors reducedMotion', () => {
    setFxRandomSeed(1337);
    const board = createBoardState(getLevelSpec(25));
    const rctx = createPlateMockRctx(board.rows, board.cols, false);
    spawnRelicAwakeningBurstImpl(rctx, board);

    const initialPlates = rctx.activeRelicPlateCount;
    expect(initialPlates).toBeGreaterThanOrEqual(24);
    expect(rctx.particlePoolCount).toBeGreaterThanOrEqual(45);
    expect(rctx.particlePoolCount).toBeLessThanOrEqual(90);

    // At ~180ms into awakening (awaken ~ 0.26), glowing-crack plates have detached while dark mega-slabs still hold
    for (let f = 0; f < 11; f++) {
      stepRelicPlatesImpl(rctx, 1 / 60, Math.max(0, 0.995 - (f + 1) / (60 * 0.68)), 2.0 + f / 60, false);
    }
    const detachedMid = rctx.relicPlates.filter((p) => p.detached);
    expect(detachedMid.length).toBeGreaterThan(0);
    expect(detachedMid.length).toBeLessThan(initialPlates);

    const geom = buildRelicPlateGeometryImpl(rctx.relicPlates);
    expect(geom.vertexCount).toBeGreaterThan(0);
    expect(geom.solidIndexCount).toBeGreaterThan(0);

    // After ~1.6s, all heavy & light Voronoi slabs finish peeling away and drain cleanly to zero
    for (let f = 0; f < 98; f++) {
      stepRelicPlatesImpl(rctx, 1 / 60, 0, 2.2 + f / 60, false);
    }
    expect(rctx.activeRelicPlateCount).toBe(0);
    expect(rctx.relicPlates).toHaveLength(0);

    // Reset clears mid-flight plates immediately; reducedMotion spawns 0 plates
    spawnRelicAwakeningBurstImpl(rctx, board);
    expect(rctx.activeRelicPlateCount).toBeGreaterThan(0);
    resetTransientFxImpl(rctx);
    expect(rctx.activeRelicPlateCount).toBe(0);

    const reducedRctx = createPlateMockRctx(board.rows, board.cols, true);
    spawnRelicAwakeningBurstImpl(reducedRctx, board);
    expect(reducedRctx.activeRelicPlateCount).toBe(0);
  });

  it('PERF-TRANSITION-01: matches 3x3 plate rotation parity, prewarms idle plates, warms both style-11 PSOs, and issues 1 contiguous IBO upload', () => {
    // 1. Exact 3x3 composite rotation matrix parity against reference axis-angle + rotateRelicVec
    setFxRandomSeed(1337);
    const board = createBoardState(getLevelSpec(25));
    const built = buildBoardVoronoiPlates(board, 2.0);
    const samplePlate = built.plates[0];
    samplePlate.initTiltX = 0.043;
    samplePlate.initTiltY = -0.051;
    samplePlate.initTwistZ = 0.037;
    const peelAngle = 0.78;
    const spinAngle = -0.44;
    const mat = new Float32Array(9);
    computePlateRotationMatrix(samplePlate, peelAngle, spinAngle, mat);

    const refAxisAngle = (vx: number, vy: number, vz: number): [number, number, number] => {
      const c = Math.cos(peelAngle);
      const s = Math.sin(peelAngle);
      const kx = samplePlate.tanX;
      const ky = samplePlate.tanY;
      const kDotV = kx * vx + ky * vy;
      return [
        vx * c + -ky * vz * s + kx * kDotV * (1 - c),
        vy * c + kx * vz * s + ky * kDotV * (1 - c),
        vz * c + (kx * vy - ky * vx) * s,
      ];
    };
    for (const [lx, ly, lz] of [
      [0.42, -0.31, 0.06],
      [-0.58, 0.27, -0.06],
      [0, 0, 1],
      [-0.6, 0.8, 0.14],
    ] as const) {
      const [hx, hy, hz] = refAxisAngle(lx, ly, lz);
      const [rx, ry, rz] = rotateRelicVec(
        hx,
        hy,
        hz,
        samplePlate.initTiltX,
        samplePlate.initTiltY,
        samplePlate.initTwistZ + spinAngle
      );
      expect(mat[0] * lx + mat[1] * ly + mat[2] * lz).toBeCloseTo(rx, 5);
      expect(mat[3] * lx + mat[4] * ly + mat[5] * lz).toBeCloseTo(ry, 5);
      expect(mat[6] * lx + mat[7] * ly + mat[8] * lz).toBeCloseTo(rz, 5);
    }

    // 2. Idle prewarm skips while deterministic golden seed is active, caches & consumes once in live play
    expect(prewarmRelicPlatesForBoard(board, 2.0)).toBe(false);
    setFxRandomSeed(null);
    const liveBoard = createBoardState(getLevelSpec(1));
    expect(prewarmRelicPlatesForBoard(liveBoard, 2.0)).toBe(true);
    expect(prewarmRelicPlatesForBoard(liveBoard, 2.0)).toBe(false);
    const liveRctx = createPlateMockRctx(liveBoard.rows, liveBoard.cols, false);
    spawnRelicVoronoiPlatesImpl(liveRctx, liveBoard, 2.0);
    expect(liveRctx.activeRelicPlateCount).toBeGreaterThanOrEqual(24);
    const firstSpawnPlates = [...liveRctx.relicPlates];
    // Prewarmed entry was consumed once, so a second spawn builds fresh plates
    spawnRelicVoronoiPlatesImpl(liveRctx, liveBoard, 2.0);
    expect(liveRctx.relicPlates[0]).not.toBe(firstSpawnPlates[0]);

    // 3. Boot warmup pre-allocates PlateGlHandles & warms both solid/fade PSOs; mixed solid+fade frame uploads IBO once
    const ELEMENT_ARRAY_BUFFER = 0x8893;
    const BLEND = 0x0be2;
    let vaoCount = 0;
    let bufCount = 0;
    let blendState = true;
    let depthMaskState = true;
    let iboSubDataCalls = 0;
    const drawLog: Array<{ count: number; offset: number; blend: boolean; depthMask: boolean }> = [];
    const noop = () => {};
    const gl = {
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER,
      DYNAMIC_DRAW: 0x88e8,
      FLOAT: 0x1406,
      TRIANGLES: 4,
      UNSIGNED_SHORT: 0x1403,
      BLEND,
      createVertexArray: () => {
        vaoCount++;
        return { id: vaoCount } as unknown as WebGLVertexArrayObject;
      },
      createBuffer: () => {
        bufCount++;
        return { id: bufCount } as unknown as WebGLBuffer;
      },
      getUniformLocation: (_p: WebGLProgram, name: string) => ({ name }) as unknown as WebGLUniformLocation,
      enable: (cap: number) => {
        if (cap === BLEND) blendState = true;
      },
      disable: (cap: number) => {
        if (cap === BLEND) blendState = false;
      },
      depthMask: (flag: boolean) => {
        depthMaskState = flag;
      },
      bufferSubData: (target: number) => {
        if (target === ELEMENT_ARRAY_BUFFER) iboSubDataCalls++;
      },
      drawElements: (_mode: number, count: number, _type: number, offset: number) => {
        drawLog.push({ count, offset, blend: blendState, depthMask: depthMaskState });
      },
    } as unknown as Record<string, unknown>;
    for (const m of (
      'bindVertexArray bindBuffer bufferData enableVertexAttribArray vertexAttribPointer useProgram ' +
      'uniform1i uniform1f uniform3f uniform4f'
    ).split(' ')) {
      gl[m] = noop;
    }

    const prog = {} as WebGLProgram;
    warmUpRelicPlatePipelineImpl(gl as unknown as WebGL2RenderingContext, prog);
    expect(vaoCount).toBe(1);
    expect(bufCount).toBe(4);
    expect(drawLog).toEqual([
      { count: 3, offset: 0, blend: false, depthMask: true },
      { count: 3, offset: 0, blend: true, depthMask: false },
    ]);

    // Advance live plates to a mixed solid + fading frame and verify single contiguous IBO upload
    const mixedRctx = createPlateMockRctx(liveBoard.rows, liveBoard.cols, false);
    setFxRandomSeed(1337);
    spawnRelicVoronoiPlatesImpl(mixedRctx, liveBoard, 2.0);
    let foundMixedFrame = false;
    for (let f = 0; f < 90; f++) {
      stepRelicPlatesImpl(mixedRctx, 1 / 120, Math.max(0, 0.995 - f / (120 * 0.68)), 2.0 + f / 120, false);
      const preview = buildRelicPlateGeometryImpl(mixedRctx.relicPlates);
      if (preview.solidIndexCount > 0 && preview.fadeIndexCount > 0) {
        foundMixedFrame = true;
        iboSubDataCalls = 0;
        drawLog.length = 0;
        renderRelicPlatesWebGL2Impl(mixedRctx, gl as unknown as WebGL2RenderingContext, prog);
        expect(iboSubDataCalls).toBe(1);
        expect(drawLog).toEqual([
          { count: preview.solidIndexCount, offset: 0, blend: false, depthMask: true },
          {
            count: preview.fadeIndexCount,
            offset: preview.solidIndexCount * 2,
            blend: true,
            depthMask: false,
          },
        ]);
        expect(blendState).toBe(true);
        expect(depthMaskState).toBe(true);
        break;
      }
    }
    expect(foundMixedFrame).toBe(true);

    // 4. Shader dead-work & tile-GPU texelFetch guard contracts
    expect(GLSL_STONE_LIB).toContain('if (edgeD < mdCluster)');
    expect(MAIN_FRAGMENT_SHADER).toContain('float localPxW = fwidth(v_localPos.x);');
    expect(MAIN_FRAGMENT_SHADER).toContain('if (needGameplayLit)');
    expect(MAIN_FRAGMENT_SHADER).toContain('if (needRelicCrust)');
  });
});
