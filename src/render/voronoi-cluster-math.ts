import type { BoardState } from '../core/types';
import { RELIC_AWAKEN_DURATION_SEC, type RelicFracturePlate, type RelicSubCell } from './render-types';

export const VORONOI_CRACK_SCALE = 0.88;
export const VORONOI_MINOR_SCALE = 2.05;
export const RELIC_CLUSTER_TEX_SIZE = 16;
export const RELIC_CLUSTER_TEX_OFFSET = 2;

export interface TaggedVec2 {
  x: number;
  y: number;
  tag: string | null;
}

export interface SubCellMeshResult {
  centerX: number;
  centerY: number;
  verts: Float32Array;
  edgeFlags: Uint8Array;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Exact CPU mirror of GLSL `hashRelic22` in `shaders-glsl-lib.ts`. */
export function hashRelic22(px: number, py: number): [number, number] {
  let p3x = fract(px * 0.1031);
  let p3y = fract(py * 0.103);
  let p3z = fract(px * 0.0973);
  const dotVal = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += dotVal;
  p3y += dotVal;
  p3z += dotVal;
  return [fract((p3x + p3y) * p3z), fract((p3x + p3z) * p3y)];
}

/** Exact CPU mirror of GLSL `relicNoise` in `shaders-glsl-lib.ts`. */
export function relicNoiseCpu(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = px - ix;
  let fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hashRelic22(ix, iy)[0];
  const b = hashRelic22(ix + 1, iy)[0];
  const c = hashRelic22(ix, iy + 1)[0];
  const d = hashRelic22(ix + 1, iy + 1)[0];
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

/** Exact CPU mirror of `majorRegionMask` in `shaders-relic-crust.ts`. */
export function sampleMajorRegionMask(wx: number, wy: number): number {
  return smoothstep(
    -0.08,
    0.56,
    Math.sin(wx * 0.95 - wy * 0.82 + 0.8) * Math.cos(wy * 0.88 + wx * 0.64) + 0.24
  );
}

/** Exact CPU mirror of living Title crack pulse (`pulseField` / `crackPulse`) in `shaders-relic-crust.ts`. */
export function sampleCrackPulseCpu(wx: number, wy: number, timeSec: number): number {
  const isAnimated = timeSec >= 0 ? 1 : 0;
  const tA = Math.max(0, timeSec) * isAnimated;
  const pulseField =
    relicNoiseCpu(wx * 0.58 + tA * 0.19, wy * 0.58 - tA * 0.14) * 0.6 +
    relicNoiseCpu(wx * 1.42 - tA * 0.33 + 7.3, wy * 1.42 - tA * 0.27 + 7.3) * 0.4;
  const rawHb = 0.5 + 0.5 * Math.sin(tA * 1.9 + pulseField * 11.0);
  const heartbeat = 0.7 + (rawHb - 0.7) * isAnimated;
  return 0.1 + 0.9 * smoothstep(0.22, 0.86, pulseField) * (0.5 + 0.5 * heartbeat);
}

/** Visible glowing crack intensity `[0..1]` along the Title Screen Stone Relic at `(wx, wy)`. */
export function sampleVisibleCrackGlow(wx: number, wy: number, timeSec: number): number {
  return sampleMajorRegionMask(wx, wy) * (0.55 + 0.45 * sampleCrackPulseCpu(wx, wy, timeSec));
}

/** Exact CPU mirror of `rockJag` domain distortion in `shaders-relic-crust.ts`. */
export function sampleRockJag(wx: number, wy: number): { x: number; y: number } {
  return {
    x: Math.sin(wy * 8.5 + wx * 5.2) * 0.03 + Math.sin(wy * 22.0 - wx * 14.0) * 0.01,
    y: Math.cos(wx * 8.1 - wy * 5.8) * 0.03 + Math.cos(wx * 20.0 + wy * 16.0) * 0.01,
  };
}

/** Solves `wp * 0.88 + rockJag(wp) = (vx, vy)` into world coordinates via 2 fixed-point steps. */
export function invertMajorRockJag(vx: number, vy: number): { x: number; y: number } {
  let wx = vx / VORONOI_CRACK_SCALE;
  let wy = vy / VORONOI_CRACK_SCALE;
  for (let i = 0; i < 2; i++) {
    const jag = sampleRockJag(wx, wy);
    wx = (vx - jag.x) / VORONOI_CRACK_SCALE;
    wy = (vy - jag.y) / VORONOI_CRACK_SCALE;
  }
  return { x: wx, y: wy };
}

/** Solves `wp * 2.05 - rockJag(wp) * 1.35 + (5.7, 3.1) = (vx, vy)` into world coordinates via 2 steps. */
export function invertMinorRockJag(vx: number, vy: number): { x: number; y: number } {
  let wx = (vx - 5.7) / VORONOI_MINOR_SCALE;
  let wy = (vy - 3.1) / VORONOI_MINOR_SCALE;
  for (let i = 0; i < 2; i++) {
    const jag = sampleRockJag(wx, wy);
    wx = (vx - 5.7 + jag.x * 1.35) / VORONOI_MINOR_SCALE;
    wy = (vy - 3.1 + jag.y * 1.35) / VORONOI_MINOR_SCALE;
  }
  return { x: wx, y: wy };
}

/**
 * Clips a tagged convex polygon against `x * nx + y * ny <= rhs`.
 * Each vertex `v` carries the edge tag for segment `(v -> nextV)`.
 */
export function clipHalfPlaneTagged(
  poly: readonly TaggedVec2[],
  nx: number,
  ny: number,
  rhs: number,
  clipTag: string | null
): TaggedVec2[] {
  if (poly.length < 3) return [];
  const raw: TaggedVec2[] = [];
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % len];
    const da = a.x * nx + a.y * ny - rhs;
    const db = b.x * nx + b.y * ny - rhs;
    const inA = da <= 1e-6;
    const inB = db <= 1e-6;
    if (inA && inB) {
      raw.push(b);
    } else if (inA && !inB) {
      const t = da / (da - db);
      raw.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tag: clipTag });
    } else if (!inA && inB) {
      const t = da / (da - db);
      raw.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tag: a.tag });
      raw.push(b);
    }
  }
  if (raw.length < 3) return [];

  const deduped: TaggedVec2[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    const nxt = raw[(i + 1) % raw.length];
    if (Math.hypot(nxt.x - cur.x, nxt.y - cur.y) >= 1e-5) {
      deduped.push(cur);
    }
  }
  return deduped.length >= 3 ? deduped : [];
}

export function polygonSignedAreaAndCentroid(poly: ReadonlyArray<{ x: number; y: number }>): {
  signedArea: number;
  cx: number;
  cy: number;
} {
  let doubleArea = 0;
  let sumX = 0;
  let sumY = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    doubleArea += cross;
    sumX += (a.x + b.x) * cross;
    sumY += (a.y + b.y) * cross;
  }
  if (Math.abs(doubleArea) < 1e-7) {
    return { signedArea: 0, cx: poly[0]?.x ?? 0, cy: poly[0]?.y ?? 0 };
  }
  return {
    signedArea: doubleArea * 0.5,
    cx: sumX / (3 * doubleArea),
    cy: sumY / (3 * doubleArea),
  };
}

function warpVertexFromVoronoi(
  wx: number,
  wy: number,
  useMinorWarp: boolean,
  useMajorWarp: boolean
): { x: number; y: number } {
  if (useMajorWarp) {
    return invertMajorRockJag(wx * VORONOI_CRACK_SCALE, wy * VORONOI_CRACK_SCALE);
  }
  if (useMinorWarp) {
    return invertMinorRockJag(wx * VORONOI_MINOR_SCALE + 5.7, wy * VORONOI_MINOR_SCALE + 3.1);
  }
  return { x: wx, y: wy };
}

function orientEdgesScreenCcw(
  poly: readonly TaggedVec2[]
): Array<{ ax: number; ay: number; bx: number; by: number; tag: string | null }> | null {
  if (poly.length < 3) return null;
  const meta = polygonSignedAreaAndCentroid(poly);
  if (Math.abs(meta.signedArea) < 1e-5) return null;

  const edges: Array<{ ax: number; ay: number; bx: number; by: number; tag: string | null }> = [];
  const n = poly.length;
  if (meta.signedArea < 0) {
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, tag: a.tag });
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      const prevIdx = (i + n - 1) % n;
      const a = poly[i];
      const b = poly[prevIdx];
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, tag: b.tag });
    }
  }
  return edges;
}

/**
 * Builds one screen-CCW, star-shaped `RelicSubCell` geometry relative to `(centroidX, centroidY)`.
 * - External boundaries (`edgeFlags & 1`) subdivide into jagged `rockJag`-warped segments matching
 *   the glowing fissures.
 * - Internal fused seams (`edgeFlags === 0`) keep exact shared endpoints without subdivision so multi-cell
 *   slabs weld with 0.000 gap.
 */
export function buildSubCellMeshVerts(
  polyWorld: readonly TaggedVec2[],
  centroidX: number,
  centroidY: number,
  resolveEdgeFlags: (tag: string | null) => number,
  isMinorSpace: boolean
): SubCellMeshResult | null {
  const edges = orientEdgesScreenCcw(polyWorld);
  if (!edges || edges.length < 3) return null;

  const n = edges.length;
  const edgeFlags = edges.map((e) => resolveEdgeFlags(e.tag));
  const subMeta = polygonSignedAreaAndCentroid(polyWorld);
  const subCx = subMeta.cx;
  const subCy = subMeta.cy;

  // Deterministic per-corner warped coordinates so shared vertices across fused sub-cells match identically.
  const cornerWarped: Array<{ x: number; y: number; seamLocked: boolean; crackCorner: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const prevEdge = edges[(i + n - 1) % n];
    const curEdge = edges[i];
    const prevFlag = edgeFlags[(i + n - 1) % n];
    const curFlag = edgeFlags[i];
    const seamLocked = prevFlag === 0 || curFlag === 0;
    const isFrameCorner = prevEdge.tag === null && curEdge.tag === null;
    const prevIsMinor = Boolean(prevEdge.tag?.startsWith('M:'));
    const curIsMinor = Boolean(curEdge.tag?.startsWith('M:'));
    const useMajorWarp = !isFrameCorner && (!isMinorSpace || !prevIsMinor || !curIsMinor);
    const useMinorWarp = !isFrameCorner && isMinorSpace && prevIsMinor && curIsMinor;

    const warped = warpVertexFromVoronoi(curEdge.ax, curEdge.ay, useMinorWarp, useMajorWarp);
    let px = warped.x;
    let py = warped.y;
    const crackCorner = !seamLocked && ((prevFlag | curFlag) & 2) !== 0;
    if (crackCorner) {
      const dx = subCx - px;
      const dy = subCy - py;
      const dist = Math.hypot(dx, dy) || 1;
      const pull = Math.min(0.014, dist * 0.09);
      px += (dx / dist) * pull;
      py += (dy / dist) * pull;
    }
    cornerWarped.push({ x: px, y: py, seamLocked, crackCorner });
  }

  interface RingPoint {
    x: number;
    y: number;
    ux: number;
    uy: number;
    flag: number;
    locked: boolean;
  }

  const ring: RingPoint[] = [];
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    const flag = edgeFlags[i];
    const cw = cornerWarped[i];
    ring.push({ x: cw.x, y: cw.y, ux: e.ax, uy: e.ay, flag, locked: cw.seamLocked });

    if ((flag & 1) === 0 || e.tag === null) continue;
    const edgeLen = Math.hypot(e.bx - e.ax, e.by - e.ay);
    const steps = Math.max(2, Math.min(5, Math.ceil(edgeLen / 0.24)));
    const edgeIsMinor = isMinorSpace && e.tag.startsWith('M:');
    const edgeIsMajor = !edgeIsMinor;
    const pullCrack = (flag & 2) !== 0;

    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const ux = e.ax + (e.bx - e.ax) * t;
      const uy = e.ay + (e.by - e.ay) * t;
      const w = warpVertexFromVoronoi(ux, uy, edgeIsMinor, edgeIsMajor);
      let wx = w.x;
      let wy = w.y;
      if (pullCrack) {
        const dx = subCx - wx;
        const dy = subCy - wy;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = Math.min(0.014, dist * 0.09);
        wx += (dx / dist) * pull;
        wy += (dy / dist) * pull;
      }
      ring.push({ x: wx, y: wy, ux, uy, flag, locked: false });
    }
  }

  // Enforce strict star-convexity around (subCx, subCy) so fan triangles never invert under jagging.
  const m = ring.length;
  if (m < 3) return null;
  for (let pass = 0; pass < 3; pass++) {
    let adjusted = false;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % m];
      const cross = (a.x - subCx) * (b.y - subCy) - (b.x - subCx) * (a.y - subCy);
      if (cross >= -1e-6) {
        if (!a.locked) {
          a.x = (a.x + a.ux) * 0.5;
          a.y = (a.y + a.uy) * 0.5;
          adjusted = true;
        }
        if (!b.locked) {
          b.x = (b.x + b.ux) * 0.5;
          b.y = (b.y + b.uy) * 0.5;
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }

  const finalMeta = polygonSignedAreaAndCentroid(ring);
  if (finalMeta.signedArea >= -1e-5) {
    return null;
  }

  const verts = new Float32Array(m * 2);
  const outFlags = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    verts[i * 2] = ring[i].x - centroidX;
    verts[i * 2 + 1] = ring[i].y - centroidY;
    outFlags[i] = ring[i].flag;
  }

  return {
    centerX: subCx - centroidX,
    centerY: subCy - centroidY,
    verts,
    edgeFlags: outFlags,
  };
}

export interface MajorVoronoiCell {
  key: string;
  gx: number;
  gy: number;
  ox: number;
  oy: number;
  seedWx: number;
  seedWy: number;
  wp: TaggedVec2[];
  area: number;
  cx: number;
  cy: number;
  mask: number;
  glow: number;
}

export interface MinorVoronoiPiece {
  key: string;
  ox: number;
  oy: number;
  wp: TaggedVec2[];
  area: number;
  cx: number;
  cy: number;
}

export function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function sampleCrustElevation(board: BoardState, wx: number, wy: number): number {
  const c = Math.floor(wx);
  const r = Math.floor(wy);
  if (c < 0 || c >= board.cols || r < 0 || r >= board.rows) {
    return 0.48;
  }
  const occ = board.occupancy[r * board.cols + c];
  if (occ === -1) return 0.44;
  if (occ > 0) return 0.61;
  if (occ <= -2) return 0.5;
  return 0.09;
}

export function rotateUnitVec(vx: number, vy: number, angleRad: number): [number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [vx * c - vy * s, vx * s + vy * c];
}

/**
 * Splits a hot glowing core Voronoi cell along the finer `vorMinor` (`2.05`) fracture lattice,
 * welding corner slivers under `0.18` world area into adjacent wedges for jagged non-uniform shards.
 */
export function makeMinorWedges(
  cell: MajorVoronoiCell,
  rand: () => number,
  groupCx: number,
  groupCy: number,
  baseDetachT: number,
  glowAffinity: number,
  baseRadX: number,
  baseRadY: number,
  board: BoardState,
  seenSeams: Set<string>,
  seamPoints: Array<[number, number, number]>,
  nextPlateId: () => number
): RelicFracturePlate[] {
  let mnX = Number.POSITIVE_INFINITY;
  let mxX = Number.NEGATIVE_INFINITY;
  let mnY = Number.POSITIVE_INFINITY;
  let mxY = Number.NEGATIVE_INFINITY;
  const minorBasePoly: TaggedVec2[] = [];
  for (const v of cell.wp) {
    const mx = v.x * VORONOI_MINOR_SCALE + 5.7;
    const my = v.y * VORONOI_MINOR_SCALE + 3.1;
    minorBasePoly.push({ x: mx, y: my, tag: v.tag });
    if (mx < mnX) mnX = mx;
    if (mx > mxX) mxX = mx;
    if (my < mnY) mnY = my;
    if (my > mxY) mxY = my;
  }

  const mMinGx = Math.floor(mnX) - 1;
  const mMaxGx = Math.ceil(mxX) + 1;
  const mMinGy = Math.floor(mnY) - 1;
  const mMaxGy = Math.ceil(mxY) + 1;

  const pieces = new Map<string, MinorVoronoiPiece>();
  for (let mgy = mMinGy; mgy <= mMaxGy; mgy++) {
    for (let mgx = mMinGx; mgx <= mMaxGx; mgx++) {
      const [mox, moy] = hashRelic22(mgx, mgy);
      const msx = mgx + 0.14 + 0.72 * mox;
      const msy = mgy + 0.14 + 0.72 * moy;
      let sp: TaggedVec2[] = minorBasePoly;
      for (let ny = -2; ny <= 2 && sp.length >= 3; ny++) {
        for (let nx = -2; nx <= 2 && sp.length >= 3; nx++) {
          if (nx === 0 && ny === 0) continue;
          const [nox, noy] = hashRelic22(mgx + nx, mgy + ny);
          const nsx = mgx + nx + 0.14 + 0.72 * nox;
          const nsy = mgy + ny + 0.14 + 0.72 * noy;
          const dx = nsx - msx;
          const dy = nsy - msy;
          const midX = (msx + nsx) * 0.5;
          const midY = (msy + nsy) * 0.5;
          sp = clipHalfPlaneTagged(sp, dx, dy, midX * dx + midY * dy, `M:${mgx + nx},${mgy + ny}`);
        }
      }
      if (sp.length < 3) continue;
      const worldSp: TaggedVec2[] = sp.map((p) => ({
        x: (p.x - 5.7) / VORONOI_MINOR_SCALE,
        y: (p.y - 3.1) / VORONOI_MINOR_SCALE,
        tag: p.tag,
      }));
      const meta = polygonSignedAreaAndCentroid(worldSp);
      const area = Math.abs(meta.signedArea);
      if (area < 0.04) continue;
      const key = `M:${mgx},${mgy}`;
      pieces.set(key, { key, ox: mox, oy: moy, wp: worldSp, area, cx: meta.cx, cy: meta.cy });
    }
  }
  if (pieces.size === 0) return [];

  const mEdges: Array<{ a: string; b: string; len: number }> = [];
  const seenMinorEdge = new Set<string>();
  for (const mp of pieces.values()) {
    for (let i = 0; i < mp.wp.length; i++) {
      const a = mp.wp[i];
      const b = mp.wp[(i + 1) % mp.wp.length];
      if (!a.tag || !pieces.has(a.tag)) continue;
      const ek = mp.key < a.tag ? `${mp.key}|${a.tag}` : `${a.tag}|${mp.key}`;
      if (seenMinorEdge.has(ek)) continue;
      seenMinorEdge.add(ek);
      mEdges.push({ a: mp.key, b: a.tag, len: Math.hypot(b.x - a.x, b.y - a.y) });
    }
  }
  mEdges.sort((x, y) => y.len - x.len);

  const mParent = new Map<string, string>();
  const mArea = new Map<string, number>();
  for (const mp of pieces.values()) {
    mParent.set(mp.key, mp.key);
    mArea.set(mp.key, mp.area);
  }
  const mFind = (k: string): string => {
    let cur = k;
    while (mParent.get(cur) !== cur) {
      const p = mParent.get(cur) ?? cur;
      const gp = mParent.get(p) ?? p;
      mParent.set(cur, gp);
      cur = p;
    }
    return cur;
  };
  for (const me of mEdges) {
    const ra = mFind(me.a);
    const rb = mFind(me.b);
    if (ra === rb) continue;
    const areaA = mArea.get(ra) ?? 0;
    const areaB = mArea.get(rb) ?? 0;
    if (areaA < 0.18 || areaB < 0.18) {
      mParent.set(rb, ra);
      mArea.set(ra, areaA + areaB);
    }
  }

  const wedges = new Map<string, MinorVoronoiPiece[]>();
  for (const mp of pieces.values()) {
    const root = mFind(mp.key);
    const arr = wedges.get(root);
    if (arr) arr.push(mp);
    else wedges.set(root, [mp]);
  }

  const out: RelicFracturePlate[] = [];
  for (const wedgePieces of wedges.values()) {
    let totalArea = 0;
    let sumX = 0;
    let sumY = 0;
    let dominant = wedgePieces[0];
    const wedgeKeys = new Set<string>();
    for (const wp of wedgePieces) {
      wedgeKeys.add(wp.key);
      totalArea += wp.area;
      sumX += wp.cx * wp.area;
      sumY += wp.cy * wp.area;
      if (wp.area > dominant.area) dominant = wp;
    }
    const wCx = totalArea > 1e-6 ? sumX / totalArea : groupCx;
    const wCy = totalArea > 1e-6 ? sumY / totalArea : groupCy;
    const subCells: RelicSubCell[] = [];
    for (const wp of wedgePieces) {
      const built = buildSubCellMeshVerts(
        wp.wp,
        wCx,
        wCy,
        (tag) => {
          if (tag === null) return 1;
          if (tag.startsWith('M:')) return wedgeKeys.has(tag) ? 0 : 3;
          return 3;
        },
        true
      );
      if (built) {
        subCells.push(built);
      }
      for (let i = 0; i < wp.wp.length; i++) {
        const a = wp.wp[i];
        const b = wp.wp[(i + 1) % wp.wp.length];
        if (!a.tag || wedgeKeys.has(a.tag)) continue;
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

    const subDetachT = clampRange(baseDetachT + (dominant.ox - 0.5) * 0.09, 0.06, 0.64);
    const dxCenter = wCx - groupCx;
    const dyCenter = wCy - groupCy;
    const dLen = Math.hypot(dxCenter, dyCenter);
    let prx = dLen > 0.04 ? (dxCenter / dLen) * 0.55 + baseRadX * 0.45 : baseRadX;
    let pry = dLen > 0.04 ? (dyCenter / dLen) * 0.55 + baseRadY * 0.45 : baseRadY;
    const pLen = Math.hypot(prx, pry) || 1;
    prx /= pLen;
    pry /= pLen;
    [prx, pry] = rotateUnitVec(prx, pry, (dominant.oy - 0.5) * 0.42);

    out.push({
      id: nextPlateId(),
      seedWx: wCx,
      seedWy: wCy,
      centroidX: wCx,
      centroidY: wCy,
      baseZ: sampleCrustElevation(board, wCx, wCy),
      thickness: 0.07 + dominant.ox * 0.025,
      area: totalArea,
      glowAffinity,
      subCells,
      detachT: subDetachT,
      detachDelaySec: subDetachT * RELIC_AWAKEN_DURATION_SEC,
      flightDurationSec: 0.38 + dominant.oy * 0.12,
      elapsedSec: 0,
      detached: false,
      spawnOriginX: wCx,
      spawnOriginY: wCy,
      spawnOriginZ: sampleCrustElevation(board, wCx, wCy),
      initTiltX: 0,
      initTiltY: 0,
      initTwistZ: 0,
      posX: wCx,
      posY: wCy,
      posZ: sampleCrustElevation(board, wCx, wCy),
      radX: prx,
      radY: pry,
      tanX: -pry,
      tanY: prx,
      outSpeed: 2.1 + rand() * 1.2,
      vz0: 2.3 + rand() * 1.0,
      peelAngVel: 4.4 + rand() * 2.2,
      spinVel: (rand() < 0.5 ? -1 : 1) * (2.2 + rand() * 2.4),
      scale: 1,
      lifeRatio: 1,
    });
  }
  return out;
}
