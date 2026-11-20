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
import {
  RELIC_CLUSTER_TEX_SIZE,
  sampleMajorRegionMask,
  sampleVisibleCrackGlow,
} from '../../src/render/voronoi-cluster-math';
import {
  buildBoardVoronoiPlates,
  buildRelicPlateGeometryImpl,
  hashRelic22,
  stepRelicPlatesImpl,
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
});
