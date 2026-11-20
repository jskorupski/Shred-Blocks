import { fxRandom, isFxRandomSeeded } from '../core/fx-random';
import type { BoardState } from '../core/types';
import {
  RELIC_AWAKEN_DURATION_SEC,
  type RelicFracturePlate,
  type RelicSubCell,
  type RenderPassContext,
} from './render-types';
import {
  buildSubCellMeshVerts,
  clampRange,
  clipHalfPlaneTagged,
  hashRelic22,
  type MajorVoronoiCell,
  makeMinorWedges,
  polygonSignedAreaAndCentroid,
  RELIC_CLUSTER_TEX_OFFSET,
  RELIC_CLUSTER_TEX_SIZE,
  rotateUnitVec,
  sampleCrackPulseCpu,
  sampleCrustElevation,
  sampleMajorRegionMask,
  sampleVisibleCrackGlow,
  type TaggedVec2,
  VORONOI_CRACK_SCALE,
} from './voronoi-cluster-math';
import { prebakeRelicPlatesImpl, rotateRelicVec, setRelicClusterTexDataImpl } from './voronoi-plate-renderer';

export {
  hashRelic22,
  RELIC_CLUSTER_TEX_OFFSET,
  RELIC_CLUSTER_TEX_SIZE,
  VORONOI_CRACK_SCALE,
  VORONOI_MINOR_SCALE,
} from './voronoi-cluster-math';
export {
  bindRelicClusterTextureImpl,
  buildRelicPlateGeometryImpl,
  computePlateRotationMatrix,
  disposeRelicPlateResources,
  prebakeRelicPlatesImpl,
  renderRelicPlatesCanvas2DImpl,
  renderRelicPlatesWebGL2Impl,
  setRelicClusterTexDataImpl,
  warmUpRelicPlatePipelineImpl,
} from './voronoi-plate-renderer';

interface PrewarmedRelicPlates {
  plates: RelicFracturePlate[];
  seamPoints: Array<[number, number, number]>;
  clusterTexData: Uint8Array;
}

const majorCellsCacheByBoard = new WeakMap<BoardState, Map<string, MajorVoronoiCell>>();
const prewarmedPlatesByBoard = new WeakMap<BoardState, PrewarmedRelicPlates>();
let pendingPrewarmTimer: ReturnType<typeof setTimeout> | null = null;

/** Exact CPU mirror of baseline Voronoi detach timing formula. */
export function computePlateDetachT(
  seedWx: number,
  seedWy: number,
  boardCx: number,
  boardCy: number,
  maxHalfSpan: number,
  plateHash: number
): number {
  const plateDist = Math.hypot(seedWx - boardCx, seedWy - boardCy) / Math.max(maxHalfSpan * 1.22, 2.5);
  return 0.14 + Math.min(1.15, plateDist) * 0.42 + plateHash * 0.14;
}

function isNearSolidCell(board: BoardState, wx: number, wy: number): boolean {
  const minR = Math.max(0, Math.floor(wy - 0.55));
  const maxR = Math.min(board.rows - 1, Math.floor(wy + 0.55));
  const minC = Math.max(0, Math.floor(wx - 0.55));
  const maxC = Math.min(board.cols - 1, Math.floor(wx + 0.55));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (board.occupancy[r * board.cols + c] !== -1) {
        return true;
      }
    }
  }
  return false;
}

function getOrBuildMajorVoronoiCells(board: BoardState): Map<string, MajorVoronoiCell> {
  const cached = majorCellsCacheByBoard.get(board);
  if (cached) return cached;

  const minWx = -0.44;
  const maxWx = board.cols + 0.44;
  const minWy = -0.44;
  const maxWy = board.rows + 0.44;
  const minGx = Math.floor(minWx * VORONOI_CRACK_SCALE) - 1;
  const maxGx = Math.ceil(maxWx * VORONOI_CRACK_SCALE) + 1;
  const minGy = Math.floor(minWy * VORONOI_CRACK_SCALE) - 1;
  const maxGy = Math.ceil(maxWy * VORONOI_CRACK_SCALE) + 1;

  const cells = new Map<string, MajorVoronoiCell>();
  for (let gy = minGy; gy <= maxGy; gy++) {
    for (let gx = minGx; gx <= maxGx; gx++) {
      const [ox, oy] = hashRelic22(gx, gy);
      const sx = gx + 0.14 + 0.72 * ox;
      const sy = gy + 0.14 + 0.72 * oy;

      let poly: TaggedVec2[] = [
        { x: sx - 1.6, y: sy - 1.6, tag: null },
        { x: sx - 1.6, y: sy + 1.6, tag: null },
        { x: sx + 1.6, y: sy + 1.6, tag: null },
        { x: sx + 1.6, y: sy - 1.6, tag: null },
      ];

      for (let ny = -2; ny <= 2 && poly.length >= 3; ny++) {
        for (let nx = -2; nx <= 2 && poly.length >= 3; nx++) {
          if (nx === 0 && ny === 0) continue;
          const [nox, noy] = hashRelic22(gx + nx, gy + ny);
          const nsx = gx + nx + 0.14 + 0.72 * nox;
          const nsy = gy + ny + 0.14 + 0.72 * noy;
          const dx = nsx - sx;
          const dy = nsy - sy;
          const mx = (sx + nsx) * 0.5;
          const my = (sy + nsy) * 0.5;
          poly = clipHalfPlaneTagged(poly, dx, dy, mx * dx + my * dy, `${gx + nx},${gy + ny}`);
        }
      }
      if (poly.length < 3) continue;

      let worldPoly: TaggedVec2[] = poly.map((p) => ({
        x: p.x / VORONOI_CRACK_SCALE,
        y: p.y / VORONOI_CRACK_SCALE,
        tag: p.tag,
      }));
      worldPoly = clipHalfPlaneTagged(worldPoly, -1, 0, -minWx, null);
      worldPoly = clipHalfPlaneTagged(worldPoly, 1, 0, maxWx, null);
      worldPoly = clipHalfPlaneTagged(worldPoly, 0, -1, -minWy, null);
      worldPoly = clipHalfPlaneTagged(worldPoly, 0, 1, maxWy, null);
      if (worldPoly.length < 3) continue;

      const areaMeta = polygonSignedAreaAndCentroid(worldPoly);
      const area = Math.abs(areaMeta.signedArea);
      if (area < 0.065) continue;

      let touchesBoard = isNearSolidCell(board, areaMeta.cx, areaMeta.cy);
      if (!touchesBoard) {
        for (const v of worldPoly) {
          if (isNearSolidCell(board, v.x, v.y)) {
            touchesBoard = true;
            break;
          }
        }
      }
      if (!touchesBoard) continue;

      const key = `${gx},${gy}`;
      cells.set(key, {
        key,
        gx,
        gy,
        ox,
        oy,
        seedWx: sx / VORONOI_CRACK_SCALE,
        seedWy: sy / VORONOI_CRACK_SCALE,
        wp: worldPoly,
        area,
        cx: areaMeta.cx,
        cy: areaMeta.cy,
        mask: sampleMajorRegionMask(areaMeta.cx, areaMeta.cy),
        glow: 0,
      });
    }
  }

  majorCellsCacheByBoard.set(board, cells);
  return cells;
}

/**
 * Partitions the Title Screen crust along the exact `0.88` + `2.05` Voronoi crack lattice and
 * fuses dark, un-glowing cells into large uneven multi-cell slabs while breaking already-glowing
 * fissures first (including sharp `vorMinor` wedges in hot glowing core webs).
 */
export function buildBoardVoronoiPlates(
  board: BoardState,
  timeSec = 2.0
): {
  plates: RelicFracturePlate[];
  seamPoints: Array<[number, number, number]>;
  clusterTexData: Uint8Array;
} {
  const rand = fxRandom;
  const cxBoard = board.cols * 0.5;
  const cyBoard = board.rows * 0.5;
  const maxHalfSpan = Math.max(cxBoard, cyBoard);
  const cells = getOrBuildMajorVoronoiCells(board);

  // Collect shared candidate seams across neighboring board Voronoi cells, never fusing across glowing cracks.
  const candidateEdges: Array<{ a: string; b: string; score: number }> = [];
  const seenEdges = new Set<string>();
  for (const c of cells.values()) {
    for (let i = 0; i < c.wp.length; i++) {
      const a = c.wp[i];
      const b = c.wp[(i + 1) % c.wp.length];
      if (!a.tag || !cells.has(a.tag)) continue;
      const ek = c.key < a.tag ? `${c.key}|${a.tag}` : `${a.tag}|${c.key}`;
      if (seenEdges.has(ek)) continue;
      seenEdges.add(ek);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.16) continue;

      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const p25x = a.x * 0.75 + b.x * 0.25;
      const p25y = a.y * 0.75 + b.y * 0.25;
      const p75x = a.x * 0.25 + b.x * 0.75;
      const p75y = a.y * 0.25 + b.y * 0.75;

      const sMask = Math.max(
        sampleMajorRegionMask(mx, my),
        sampleMajorRegionMask(p25x, p25y),
        sampleMajorRegionMask(p75x, p75y)
      );
      const eGlow = Math.max(
        sampleVisibleCrackGlow(mx, my, timeSec),
        sampleVisibleCrackGlow(p25x, p25y, timeSec),
        sampleVisibleCrackGlow(p75x, p75y, timeSec)
      );
      const [edgeHash] = hashRelic22(mx * 3.1 + 5.2, my * 2.7 + 8.9);

      if (sMask < 0.44 && eGlow < 0.36) {
        candidateEdges.push({ a: c.key, b: a.tag, score: eGlow + edgeHash * 0.16 });
      } else if (sMask < 0.6 && eGlow < 0.46 && edgeHash < 0.26) {
        candidateEdges.push({ a: c.key, b: a.tag, score: eGlow + 0.25 + edgeHash * 0.15 });
      }
    }
  }
  candidateEdges.sort((x, y) => x.score - y.score);

  const ufParent = new Map<string, string>();
  const ufSize = new Map<string, number>();
  const ufCap = new Map<string, number>();
  const ufBbox = new Map<string, [number, number, number, number]>();
  for (const c of cells.values()) {
    ufParent.set(c.key, c.key);
    ufSize.set(c.key, 1);
    const [ch] = hashRelic22(c.gx + 13.7, c.gy + 29.3);
    ufCap.set(c.key, ch < 0.28 ? 5 : ch < 0.58 ? 3 : ch < 0.8 ? 2 : 1);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const v of c.wp) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    ufBbox.set(c.key, [minX, maxX, minY, maxY]);
  }
  const ufFind = (k: string): string => {
    let cur = k;
    while (ufParent.get(cur) !== cur) {
      const p = ufParent.get(cur) ?? cur;
      const gp = ufParent.get(p) ?? p;
      ufParent.set(cur, gp);
      cur = p;
    }
    return cur;
  };
  const maxSpan = Math.min(3.8, Math.max(board.cols, board.rows) * 0.54);
  for (const e of candidateEdges) {
    const ra = ufFind(e.a);
    const rb = ufFind(e.b);
    if (ra === rb) continue;
    const targetCap = Math.max(ufCap.get(ra) ?? 1, ufCap.get(rb) ?? 1);
    const newSize = (ufSize.get(ra) ?? 1) + (ufSize.get(rb) ?? 1);
    if (newSize > targetCap) continue;
    const ba = ufBbox.get(ra);
    const bb = ufBbox.get(rb);
    if (!ba || !bb) continue;
    const nx0 = Math.min(ba[0], bb[0]);
    const nx1 = Math.max(ba[1], bb[1]);
    const ny0 = Math.min(ba[2], bb[2]);
    const ny1 = Math.max(ba[3], bb[3]);
    if (nx1 - nx0 > maxSpan || ny1 - ny0 > maxSpan) continue;
    ufParent.set(rb, ra);
    ufSize.set(ra, newSize);
    ufCap.set(ra, targetCap);
    ufBbox.set(ra, [nx0, nx1, ny0, ny1]);
  }

  const groups = new Map<string, MajorVoronoiCell[]>();
  for (const c of cells.values()) {
    const root = ufFind(c.key);
    const grp = groups.get(root);
    if (grp) grp.push(c);
    else groups.set(root, [c]);
  }

  const clusterTexData = new Uint8Array(RELIC_CLUSTER_TEX_SIZE * RELIC_CLUSTER_TEX_SIZE * 4);
  for (let i = 0; i < RELIC_CLUSTER_TEX_SIZE * RELIC_CLUSTER_TEX_SIZE; i++) {
    clusterTexData[i * 4] = 0;
    clusterTexData[i * 4 + 1] = 128;
    clusterTexData[i * 4 + 2] = 0;
    clusterTexData[i * 4 + 3] = 0;
  }
  const writeClusterTexel = (
    gx: number,
    gy: number,
    clusterId: number,
    detachT: number,
    isSubSplit: boolean,
    glowAffinity: number
  ): void => {
    const tx = gx + RELIC_CLUSTER_TEX_OFFSET;
    const ty = gy + RELIC_CLUSTER_TEX_OFFSET;
    if (tx < 0 || tx >= RELIC_CLUSTER_TEX_SIZE || ty < 0 || ty >= RELIC_CLUSTER_TEX_SIZE) return;
    const idx = (ty * RELIC_CLUSTER_TEX_SIZE + tx) * 4;
    clusterTexData[idx] = clusterId;
    clusterTexData[idx + 1] = clampRange(Math.round(detachT * 255), 0, 255);
    clusterTexData[idx + 2] = isSubSplit ? 255 : 0;
    clusterTexData[idx + 3] = clampRange(Math.round(glowAffinity * 255), 0, 255);
  };

  const plates: RelicFracturePlate[] = [];
  const seamPoints: Array<[number, number, number]> = [];
  const seenSeams = new Set<string>();
  let nextId = 1;
  const nextPlateId = (): number => nextId++;
  let clusterCounter = 0;

  for (const grp of groups.values()) {
    const clusterId = 1 + (clusterCounter++ % 254);
    const groupCellSet = new Set<string>(grp.map((c) => c.key));

    let groupArea = 0;
    let sumCxArea = 0;
    let sumCyArea = 0;
    let sumCellGlowArea = 0;
    for (const c of grp) {
      groupArea += c.area;
      sumCxArea += c.cx * c.area;
      sumCyArea += c.cy * c.area;
      const cellCrackScore = c.mask * (0.68 + 0.32 * sampleCrackPulseCpu(c.cx, c.cy, timeSec));
      sumCellGlowArea += cellCrackScore * c.area;
    }
    const groupCx = groupArea > 1e-6 ? sumCxArea / groupArea : grp[0].cx;
    const groupCy = groupArea > 1e-6 ? sumCyArea / groupArea : grp[0].cy;
    const avgCellScore = groupArea > 1e-6 ? sumCellGlowArea / groupArea : 0;

    let sumEdgeGlowLen = 0;
    let sumExtLen = 0;
    let sumCrackX = 0;
    let sumCrackY = 0;
    let sumCrackW = 0;

    for (const c of grp) {
      for (let i = 0; i < c.wp.length; i++) {
        const a = c.wp[i];
        const b = c.wp[(i + 1) % c.wp.length];
        if (a.tag === null || groupCellSet.has(a.tag)) continue;
        const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (edgeLen < 1e-4) continue;
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const eGlow = sampleVisibleCrackGlow(mx, my, timeSec);
        sumEdgeGlowLen += eGlow * edgeLen;
        sumExtLen += edgeLen;
        const cw = eGlow * edgeLen;
        sumCrackX += mx * cw;
        sumCrackY += my * cw;
        sumCrackW += cw;
      }
    }

    const avgEdgeScore = sumExtLen > 1e-4 ? sumEdgeGlowLen / sumExtLen : 0;
    const glowAffinity = clampRange(avgCellScore * 0.68 + avgEdgeScore * 0.32, 0, 1);

    const [clusterHashX, clusterHashY] = hashRelic22(grp[0].gx, grp[0].gy);
    const rLenBoard = Math.hypot(groupCx - cxBoard, groupCy - cyBoard);
    const radialFrac = Math.min(1.15, rLenBoard / Math.max(maxHalfSpan * 1.22, 2.5));
    const megaInertia = grp.length >= 2 ? 0.08 : 0;
    const detachT = clampRange(
      0.07 + (1 - glowAffinity) * 0.28 + megaInertia + clusterHashX * 0.11 + radialFrac * 0.04,
      0.07,
      0.58
    );

    let rxOut: number;
    let ryOut: number;
    if (rLenBoard < 0.05) {
      const ang = clusterHashX * Math.PI * 2;
      rxOut = Math.cos(ang);
      ryOut = Math.sin(ang);
    } else {
      rxOut = (groupCx - cxBoard) / rLenBoard;
      ryOut = (groupCy - cyBoard) / rLenBoard;
    }

    let kxOut = rxOut;
    let kyOut = ryOut;
    if (sumCrackW > 0.01) {
      const seamCx = sumCrackX / sumCrackW;
      const seamCy = sumCrackY / sumCrackW;
      const kLen = Math.hypot(groupCx - seamCx, groupCy - seamCy);
      if (kLen > 0.05) {
        kxOut = (groupCx - seamCx) / kLen;
        kyOut = (groupCy - seamCy) / kLen;
      }
    }
    let radX = kxOut * 0.6 + rxOut * 0.4;
    let radY = kyOut * 0.6 + ryOut * 0.4;
    const combLen = Math.hypot(radX, radY);
    if (combLen < 0.05) {
      radX = rxOut;
      radY = ryOut;
    } else {
      radX /= combLen;
      radY /= combLen;
    }
    [radX, radY] = rotateUnitVec(radX, radY, (clusterHashY - 0.5) * (Math.PI / 5));

    const single = grp.length === 1 ? grp[0] : null;
    if (
      single &&
      single.mask >= 0.72 &&
      single.area >= 0.55 &&
      hashRelic22(single.gx + 3.7, single.gy + 11.9)[0] < 0.48
    ) {
      const wedges = makeMinorWedges(
        single,
        rand,
        groupCx,
        groupCy,
        detachT,
        glowAffinity,
        radX,
        radY,
        board,
        seenSeams,
        seamPoints,
        nextPlateId
      );
      if (wedges.length > 0) {
        writeClusterTexel(single.gx, single.gy, clusterId, detachT, true, glowAffinity);
        for (const w of wedges) plates.push(w);
        continue;
      }
    }

    for (const c of grp) {
      writeClusterTexel(c.gx, c.gy, clusterId, detachT, false, glowAffinity);
    }

    const subCells: RelicSubCell[] = [];
    for (const c of grp) {
      const built = buildSubCellMeshVerts(
        c.wp,
        groupCx,
        groupCy,
        (tag) => {
          if (tag === null) return 1;
          if (groupCellSet.has(tag)) return 0;
          return 3;
        },
        false
      );
      if (built) {
        subCells.push(built);
      }
      for (let i = 0; i < c.wp.length; i++) {
        const a = c.wp[i];
        const b = c.wp[(i + 1) % c.wp.length];
        if (a.tag === null || groupCellSet.has(a.tag)) continue;
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        const seamKey = `${Math.round(midX * 8)},${Math.round(midY * 8)}`;
        if (!seenSeams.has(seamKey)) {
          seenSeams.add(seamKey);
          seamPoints.push([midX, midY, sampleCrustElevation(board, midX, midY)]);
        }
      }
    }
    if (subCells.length === 0) continue;

    const isMega = groupArea >= 1.8;
    const isMed = groupArea >= 0.55;
    const thickness = isMega
      ? 0.13 + clusterHashX * 0.04
      : isMed
        ? 0.1 + clusterHashX * 0.035
        : 0.075 + clusterHashX * 0.028;
    const outSpeed = isMega
      ? 1.85 + radialFrac * 0.65 + rand() * 0.35
      : isMed
        ? 2.15 + radialFrac * 0.75 + rand() * 0.4
        : 2.5 + radialFrac * 0.8 + rand() * 0.45;
    const vz0 = isMega ? 1.85 + rand() * 0.65 : isMed ? 2.15 + rand() * 0.75 : 2.4 + rand() * 0.85;
    const peelAngVel = isMega ? 2.6 + rand() * 1.2 : isMed ? 3.5 + rand() * 1.6 : 4.4 + rand() * 2.0;
    const spinVel =
      (rand() < 0.5 ? -1 : 1) *
      (isMega ? 0.6 + rand() * 0.9 : isMed ? 1.3 + rand() * 1.3 : 2.0 + rand() * 2.0);
    const flightDurationSec = isMega
      ? 0.44 + clusterHashY * 0.14
      : isMed
        ? 0.42 + clusterHashY * 0.14
        : 0.38 + clusterHashY * 0.12;

    const baseZ = sampleCrustElevation(board, groupCx, groupCy);
    plates.push({
      id: nextPlateId(),
      seedWx: grp[0].seedWx,
      seedWy: grp[0].seedWy,
      centroidX: groupCx,
      centroidY: groupCy,
      baseZ,
      thickness,
      area: groupArea,
      glowAffinity,
      subCells,
      detachT,
      detachDelaySec: detachT * RELIC_AWAKEN_DURATION_SEC,
      flightDurationSec,
      elapsedSec: 0,
      detached: false,
      spawnOriginX: groupCx,
      spawnOriginY: groupCy,
      spawnOriginZ: baseZ,
      initTiltX: 0,
      initTiltY: 0,
      initTwistZ: 0,
      posX: groupCx,
      posY: groupCy,
      posZ: baseZ,
      radX,
      radY,
      tanX: -radY,
      tanY: radX,
      outSpeed,
      vz0,
      peelAngVel,
      spinVel,
      scale: 1,
      lifeRatio: 1,
    });
  }

  return { plates, seamPoints, clusterTexData };
}

/**
 * Pre-computes Voronoi slab partitions and baked local 3D slab geometry during Title Screen idle
 * (`PERF-TRANSITION-01`) so tapping Play consumes the ready-to-fly slabs in `< 0.1ms` instead of
 * running cold polygon clipping on the click frame. Skipped while deterministic golden seeds are active.
 */
export function prewarmRelicPlatesForBoard(board: BoardState, timeSec = 2.0): boolean {
  if (isFxRandomSeeded() || prewarmedPlatesByBoard.has(board)) return false;
  const built = buildBoardVoronoiPlates(board, timeSec);
  prebakeRelicPlatesImpl(built.plates);
  prewarmedPlatesByBoard.set(board, built);
  return true;
}

/** Schedules non-blocking idle pre-computation of the active Title board's Voronoi plates. */
export function scheduleRelicPlatePrewarm(getBoard: () => BoardState, isActive: () => boolean): void {
  if (typeof window === 'undefined' || isFxRandomSeeded()) return;
  if (pendingPrewarmTimer !== null) clearTimeout(pendingPrewarmTimer);
  pendingPrewarmTimer = setTimeout(() => {
    pendingPrewarmTimer = null;
    const run = () => {
      if ((typeof document !== 'undefined' && document.hidden) || !isActive()) return;
      prewarmRelicPlatesForBoard(getBoard());
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 500 });
    } else {
      run();
    }
  }, 160);
}

/** Spawns crack-matched uneven Voronoi crust plates + stores cluster LUT for GPU upload. */
export function spawnRelicVoronoiPlatesImpl(
  rctx: RenderPassContext,
  board: BoardState,
  timeSec = 2.0
): Array<[number, number, number]> {
  rctx.relicPlates.length = 0;
  rctx.activeRelicPlateCount = 0;
  if (rctx.lastOptions.reducedMotion) return [];
  let built: PrewarmedRelicPlates | undefined;
  if (!isFxRandomSeeded()) {
    built = prewarmedPlatesByBoard.get(board);
    if (built) {
      prewarmedPlatesByBoard.delete(board);
    }
  }
  if (!built) {
    built = buildBoardVoronoiPlates(board, timeSec);
    prebakeRelicPlatesImpl(built.plates);
  }
  const { plates, seamPoints, clusterTexData } = built;
  setRelicClusterTexDataImpl(rctx, clusterTexData);
  for (const plate of plates) {
    rctx.relicPlates.push(plate);
  }
  rctx.activeRelicPlateCount = rctx.relicPlates.length;
  return seamPoints;
}

/**
 * Advances timed detachment and 3D hinge-peel trajectories for `rctx.relicPlates`,
 * syncing spawn world-space coordinates to the exact board levitation matrix when `detachDelaySec` arrives.
 */
export function stepRelicPlatesImpl(
  rctx: RenderPassContext,
  dtSec: number,
  blueprintMix: number,
  timeSec: number,
  reducedMotion: boolean
): void {
  if (reducedMotion) {
    if (rctx.relicPlates) rctx.relicPlates.length = 0;
    rctx.activeRelicPlateCount = 0;
    return;
  }
  const plates = rctx.relicPlates;
  if (!plates || plates.length === 0) {
    rctx.activeRelicPlateCount = 0;
    return;
  }

  const dt = Math.max(0, Math.min(0.05, dtSec));
  const mixClamp = Math.max(0, Math.min(1, blueprintMix));
  const relicEnv = mixClamp * mixClamp * (3 - 2 * mixClamp);
  const zRelief = 1 - 0.24 * mixClamp;
  const pivotX = rctx.camera.getCols() * 0.5;
  const pivotY = rctx.camera.getRows() * 0.5;
  const hoverZ = (0.14 + 0.11 * Math.sin(timeSec * 1.18) + 0.032 * Math.sin(timeSec * 2.36 + 0.7)) * relicEnv;
  const driftX = Math.sin(timeSec * 0.76) * 0.072 * relicEnv;
  const driftY = Math.cos(timeSec * 0.62 + 0.5) * 0.056 * relicEnv;
  const tiltX = Math.sin(timeSec * 0.94 + 0.3) * 0.054 * relicEnv;
  const tiltY = Math.cos(timeSec * 0.78 + 1.1) * 0.06 * relicEnv;
  const twistZ = (Math.sin(timeSec * 0.58) * 0.045 + Math.sin(timeSec * 1.22 + 1.7) * 0.014) * relicEnv;

  let writeIdx = 0;
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i];
    p.elapsedSec += dt;
    if (p.elapsedSec < p.detachDelaySec) {
      plates[writeIdx++] = p;
      continue;
    }

    if (!p.detached) {
      p.detached = true;
      const [rx, ry, rz] = rotateRelicVec(
        p.centroidX - pivotX,
        p.centroidY - pivotY,
        p.baseZ * zRelief - 0.08,
        tiltX,
        tiltY,
        twistZ
      );
      p.spawnOriginX = pivotX + rx + driftX;
      p.spawnOriginY = pivotY + ry + driftY;
      p.spawnOriginZ = 0.08 + rz + hoverZ + 0.04;
      p.initTiltX = tiltX;
      p.initTiltY = tiltY;
      p.initTwistZ = twistZ;
    }

    const localT = p.elapsedSec - p.detachDelaySec;
    const lifeRatio = 1 - localT / p.flightDurationSec;
    if (lifeRatio <= 0) continue;

    p.lifeRatio = lifeRatio;
    p.posX = p.spawnOriginX + p.radX * p.outSpeed * localT;
    p.posY = p.spawnOriginY + p.radY * p.outSpeed * localT;
    p.posZ = p.spawnOriginZ + p.vz0 * localT - 0.5 * 6.8 * localT * localT;
    p.scale = lifeRatio >= 0.35 ? 1 : 0.62 + 0.38 * (lifeRatio / 0.35);
    plates[writeIdx++] = p;
  }

  plates.length = writeIdx;
  rctx.activeRelicPlateCount = writeIdx;
}
