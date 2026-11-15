import type { ColorId, TrayId } from '../core/types';

export interface PathWaypoint {
  x: number;
  y: number;
}

export interface PathTraceSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  len: number;
  startDist: number;
  endDist: number;
  rotZ: number;
  width?: number;
  alphaScale?: number;
}

export interface VisualPathTrace {
  segments: PathTraceSegment[];
  totalLength: number;
  colorId: ColorId;
  z: number;
  age: number;
  maxAge: number;
  alphaScale?: number;
  headOriginX?: number;
  headOriginY?: number;
  spanCols?: number;
  spanRows?: number;
  headCellMask?: number;
}

export const DEFAULT_TRACE_MAX_AGE_SEC = 0.5;
export const MAX_TRACE_UNIFORM_PTS = 16;

function simplifyCollinearWaypoints(waypoints: ReadonlyArray<PathWaypoint>): PathWaypoint[] {
  if (waypoints.length === 0) return [];
  const cleaned: PathWaypoint[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const pt = waypoints[i];
    const prev = cleaned[cleaned.length - 1];
    const d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
    if (d < 0.08) continue;
    if (cleaned.length >= 2) {
      const prev2 = cleaned[cleaned.length - 2];
      const v1x = prev.x - prev2.x;
      const v1y = prev.y - prev2.y;
      const l1 = Math.hypot(v1x, v1y);
      if (l1 > 1e-4 && (v1x * (pt.x - prev.x) + v1y * (pt.y - prev.y)) / (l1 * d) > 0.975) {
        cleaned[cleaned.length - 1] = pt;
        continue;
      }
    }
    cleaned.push(pt);
  }
  return cleaned;
}

/**
 * Simplifies waypoints into collinear legs and rounds interior bends with a smooth 4-chord
 * Quadratic Bezier fillet (`<= 15` segments / `<= 16` points for single-quad analytic capsule evaluation).
 */
export function buildTraceSegments(waypoints: ReadonlyArray<PathWaypoint>): {
  segments: PathTraceSegment[];
  totalLength: number;
} {
  const cleaned = simplifyCollinearWaypoints(waypoints);
  if (cleaned.length < 2) return { segments: [], totalLength: 0 };

  let curved = cleaned;
  if (cleaned.length >= 3) {
    const chordsPerCorner = cleaned.length <= 4 ? 4 : 3;
    curved = [cleaned[0]];
    for (let i = 1; i < cleaned.length - 1; i++) {
      const a = cleaned[i - 1];
      const b = cleaned[i];
      const c = cleaned[i + 1];
      const v1x = b.x - a.x;
      const v1y = b.y - a.y;
      const v2x = c.x - b.x;
      const v2y = c.y - b.y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      const r = Math.min(0.55, l1 * 0.45, l2 * 0.45);
      if (r >= 0.1) {
        const t0x = b.x - (v1x / l1) * r;
        const t0y = b.y - (v1y / l1) * r;
        const t1x = b.x + (v2x / l2) * r;
        const t1y = b.y + (v2y / l2) * r;
        for (let s = 0; s <= chordsPerCorner; s++) {
          const t = s / chordsPerCorner;
          const omt = 1 - t;
          curved.push({
            x: omt * omt * t0x + 2 * omt * t * b.x + t * t * t1x,
            y: omt * omt * t0y + 2 * omt * t * b.y + t * t * t1y,
          });
        }
      } else {
        curved.push(b);
      }
    }
    curved.push(cleaned[cleaned.length - 1]);
  }

  const segments: PathTraceSegment[] = [];
  let totalLength = 0;
  const maxSegs = MAX_TRACE_UNIFORM_PTS - 1;
  const step = curved.length - 1 > maxSegs ? (curved.length - 1) / maxSegs : 1;
  let prevPt = curved[0];
  for (let s = 1; s <= Math.min(maxSegs, curved.length - 1); s++) {
    const idx = s === Math.min(maxSegs, curved.length - 1) ? curved.length - 1 : Math.round(s * step);
    const nextPt = curved[idx];
    const dx = nextPt.x - prevPt.x;
    const dy = nextPt.y - prevPt.y;
    const len = Math.hypot(dx, dy);
    if (len >= 0.04) {
      segments.push({
        x0: prevPt.x,
        y0: prevPt.y,
        x1: nextPt.x,
        y1: nextPt.y,
        len,
        startDist: totalLength,
        endDist: totalLength + len,
        rotZ: Math.atan2(dy, dx),
      });
      totalLength += len;
      prevPt = nextPt;
    }
  }

  return { segments, totalLength };
}

export interface TraceUniformWindow {
  pointCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Slices `[tailDist, headDist]` along `tr.segments` into `outBuf` (`vec4(x, y, arcDistFromTail, halfWidth)`
 * up to 16 points, where `outBuf[(pointCount - 1) * 4 + 2] === headDist - tailDist`) and computes the
 * tight axis-aligned bounding box for single-quad rendering.
 */
export function fillTraceUniformWindow(
  tr: VisualPathTrace,
  tailDist: number,
  headDist: number,
  outBuf: Float32Array
): TraceUniformWindow {
  const span = headDist - tailDist;
  if (span <= 0.03 || tr.segments.length === 0) {
    return { pointCount: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxHw = 0.45;

  const pushPt = (x: number, y: number, dist: number, hw: number) => {
    if (count >= MAX_TRACE_UNIFORM_PTS) return;
    const s = Math.min(span, Math.max(0, dist - tailDist));
    const o = count * 4;
    outBuf[o] = x;
    outBuf[o + 1] = y;
    outBuf[o + 2] = s;
    outBuf[o + 3] = hw;
    count++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (hw > maxHw) maxHw = hw;
  };

  for (const seg of tr.segments) {
    if (seg.endDist <= tailDist || seg.startDist >= headDist) continue;
    const vis0 = Math.max(seg.startDist, tailDist);
    const vis1 = Math.min(seg.endDist, headDist);
    const t0 = (vis0 - seg.startDist) / seg.len;
    const t1 = (vis1 - seg.startDist) / seg.len;
    const hw = (seg.width ?? 0.9) * 0.5;
    if (count === 0) {
      pushPt(seg.x0 + (seg.x1 - seg.x0) * t0, seg.y0 + (seg.y1 - seg.y0) * t0, vis0, hw);
    } else {
      const prevO = (count - 1) * 4;
      outBuf[prevO + 3] = (outBuf[prevO + 3] + hw) * 0.5;
    }
    pushPt(seg.x0 + (seg.x1 - seg.x0) * t1, seg.y0 + (seg.y1 - seg.y0) * t1, vis1, hw);
  }

  const pad = maxHw + 0.16;
  return {
    pointCount: count,
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

export interface TrayFloorSample {
  readonly floorTileA: readonly [number, number, number];
  readonly floorTileB: readonly [number, number, number];
}

export interface OriginGhostStyle {
  isLightTray: boolean;
  padRgb: [number, number, number];
  padAlpha: number;
  haloRgb: [number, number, number];
  haloAlpha: number;
  bracketRgb: [number, number, number];
  bracketAlpha: number;
  bracketInset: number;
  badgeRgb: [number, number, number];
  badgeAlpha: number;
}

export interface ReturnHomeStyle {
  isLightTray: boolean;
  padRgb: [number, number, number];
  padAlpha: number;
  haloRgb: [number, number, number];
  haloAlpha: number;
  bracketRgb: [number, number, number];
  bracketAlpha: number;
  bracketInset: number;
}

/**
 * Computes tray-luminance-adaptive styling for the mid-drag Origin Ghost Footprint (`ORIGIN-GHOST-01`)
 * so the starting cell anchor stays subtle on default `industrial_slate` yet crisp across light trays
 * (`warm_birch`, `frosted_quartz`, `mint_studio`), `midnight_arcade`, `FLOOR_PATHS`, and `highContrast`.
 */
export function resolveOriginGhostStyle(
  trayId: TrayId,
  palette: TrayFloorSample,
  blockRgb: readonly [number, number, number],
  highContrast: boolean,
  effPulse: number
): OriginGhostStyle {
  const floorLum =
    0.2126 * palette.floorTileA[0] + 0.7152 * palette.floorTileA[1] + 0.0722 * palette.floorTileA[2];
  const [cr, cg, cb] = blockRgb;

  if (!highContrast && floorLum >= 0.42) {
    const padRgb: [number, number, number] = [cr * 0.16 + 0.05, cg * 0.16 + 0.06, cb * 0.16 + 0.1];
    const lightBoost = Math.min(1, (floorLum - 0.42) / 0.42);
    return {
      isLightTray: true,
      padRgb,
      padAlpha: 0.19 + 0.07 * lightBoost,
      haloRgb: [0.99, 0.98, 0.95],
      haloAlpha: 0.56,
      bracketRgb: [padRgb[0], padRgb[1], padRgb[2]],
      bracketAlpha: 0.8 + 0.12 * effPulse,
      bracketInset: 0.072,
      badgeRgb: [0.98, 0.97, 0.93],
      badgeAlpha: 0.88 + 0.1 * effPulse,
    };
  }

  if (!highContrast && (trayId === 'midnight_arcade' || floorLum < 0.12)) {
    const padRgb: [number, number, number] = [
      Math.min(1, cr * 0.25 + 0.76),
      Math.min(1, cg * 0.25 + 0.76),
      Math.min(1, cb * 0.25 + 0.74),
    ];
    const bracketRgb: [number, number, number] = [
      Math.min(1, cr * 0.24 + 0.8),
      Math.min(1, cg * 0.24 + 0.78),
      Math.min(1, cb * 0.24 + 0.7),
    ];
    return {
      isLightTray: false,
      padRgb,
      padAlpha: 0.17,
      haloRgb: [0.02, 0.03, 0.08],
      haloAlpha: 0.68,
      bracketRgb,
      bracketAlpha: 0.74 + 0.14 * effPulse,
      bracketInset: 0.082,
      badgeRgb: [bracketRgb[0], bracketRgb[1], bracketRgb[2]],
      badgeAlpha: 0.84 + 0.12 * effPulse,
    };
  }

  const padRgb: [number, number, number] = highContrast
    ? [Math.min(1, cr * 0.22 + 0.78), Math.min(1, cg * 0.22 + 0.76), Math.min(1, cb * 0.22 + 0.7)]
    : [Math.min(1, cr * 0.28 + 0.7), Math.min(1, cg * 0.28 + 0.66), Math.min(1, cb * 0.28 + 0.58)];
  return {
    isLightTray: false,
    padRgb,
    padAlpha: highContrast ? 0.18 : 0.1,
    haloRgb: [0.03, 0.05, 0.1],
    haloAlpha: highContrast ? 0.58 : 0.34,
    bracketRgb: [padRgb[0], padRgb[1], padRgb[2]],
    bracketAlpha: (highContrast ? 0.82 : 0.58) + 0.16 * effPulse,
    bracketInset: 0.07,
    badgeRgb: [padRgb[0], padRgb[1], padRgb[2]],
    badgeAlpha: (highContrast ? 0.9 : 0.7) + 0.14 * effPulse,
  };
}

/**
 * Tray-luminance-adaptive cancel-confirmation styling when a dragged block returns onto its origin footprint.
 */
export function resolveReturnHomeStyle(
  trayId: TrayId,
  palette: TrayFloorSample,
  highContrast: boolean,
  effPulse: number
): ReturnHomeStyle {
  const floorLum =
    0.2126 * palette.floorTileA[0] + 0.7152 * palette.floorTileA[1] + 0.0722 * palette.floorTileA[2];

  if (!highContrast && floorLum >= 0.42) {
    return {
      isLightTray: true,
      padRgb: [0.18, 0.15, 0.12],
      padAlpha: 0.22 + 0.08 * effPulse,
      haloRgb: [0.99, 0.98, 0.94],
      haloAlpha: 0.56,
      bracketRgb: [0.16, 0.14, 0.12],
      bracketAlpha: 0.8 + 0.12 * effPulse,
      bracketInset: 0.072,
    };
  }

  if (!highContrast && (trayId === 'midnight_arcade' || floorLum < 0.12)) {
    return {
      isLightTray: false,
      padRgb: [0.98, 0.95, 0.86],
      padAlpha: 0.26 + 0.1 * effPulse,
      haloRgb: [0.02, 0.03, 0.08],
      haloAlpha: 0.66,
      bracketRgb: [0.98, 0.95, 0.86],
      bracketAlpha: 0.8 + 0.14 * effPulse,
      bracketInset: 0.082,
    };
  }

  return {
    isLightTray: false,
    padRgb: [0.98, 0.95, 0.86],
    padAlpha: 0.22 + 0.1 * effPulse,
    haloRgb: [0.03, 0.05, 0.1],
    haloAlpha: highContrast ? 0.58 : 0.36,
    bracketRgb: [0.98, 0.95, 0.86],
    bracketAlpha: (highContrast ? 0.86 : 0.76) + 0.16 * effPulse,
    bracketInset: 0.07,
  };
}

export interface PathTraceHost {
  readonly lastOptions: { readonly reducedMotion?: boolean };
  readonly qualityGovernor: { getActiveTier(): string };
  readonly activePathTraces: VisualPathTrace[];
}

function buildDefaultRectCellMask(cols: number, rows: number): number {
  const w = Math.min(4, Math.max(1, Math.round(cols)));
  const h = Math.min(4, Math.max(1, Math.round(rows)));
  let mask = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      mask |= 1 << (r * 4 + c);
    }
  }
  return mask;
}

export function spawnPathTraceImpl(
  rctx: PathTraceHost,
  waypoints: ReadonlyArray<PathWaypoint>,
  colorId: ColorId,
  z = 0.0,
  spanCols = 1,
  spanRows = 1,
  intoGate = false,
  cellMask?: number
): void {
  if (rctx.lastOptions.reducedMotion || waypoints.length < 2) return;
  const cols = Math.max(1, spanCols);
  const rows = Math.max(1, spanRows);
  const adjusted = waypoints.slice();
  const endPt = waypoints[waypoints.length - 1];
  const dx0 = waypoints[1].x - waypoints[0].x;
  const dy0 = waypoints[1].y - waypoints[0].y;
  const len0 = Math.hypot(dx0, dy0);
  if (len0 > 0.12) {
    const ux = dx0 / len0;
    const uy = dy0 / len0;
    const tMaxX = Math.abs(ux) > 1e-4 ? (cols * 0.5) / Math.abs(ux) : 99;
    const tMaxY = Math.abs(uy) > 1e-4 ? (rows * 0.5) / Math.abs(uy) : 99;
    const perpSpan0 = Math.abs(uy) * cols + Math.abs(ux) * rows;
    const estTailHw = Math.max(0.41, perpSpan0 * 0.44) * 0.28;
    const rearMargin = intoGate ? 0.36 : Math.max(0.22, estTailHw * 0.85);
    const maxFirstLegPull = waypoints.length > 2 ? len0 * 0.85 : 99;
    const pullBack = Math.min(maxFirstLegPull, Math.max(0, Math.min(tMaxX, tMaxY) - rearMargin));
    adjusted[0] = {
      x: adjusted[0].x - ux * pullBack,
      y: adjusted[0].y - uy * pullBack,
    };
  }
  const { segments, totalLength } = buildTraceSegments(adjusted);
  if (segments.length === 0 || totalLength < 0.24) return;

  let weightedPerp = 0;
  for (const seg of segments) {
    const perpSpan = Math.abs(Math.sin(seg.rotZ)) * cols + Math.abs(Math.cos(seg.rotZ)) * rows;
    seg.width = Math.max(0.82, perpSpan * 0.88);
    seg.alphaScale = 1 / Math.max(1, perpSpan) ** 0.1;
    weightedPerp += perpSpan * seg.len;
  }
  const avgPerpSpan = weightedPerp / Math.max(1e-4, totalLength);
  const alphaScale = 1 / Math.max(1, avgPerpSpan) ** 0.1;
  const resolvedMask = intoGate
    ? 0
    : cellMask && cellMask > 0
      ? cellMask
      : buildDefaultRectCellMask(cols, rows);

  const maxTraces = rctx.qualityGovernor.getActiveTier() === 'ULTRA_120' ? 5 : 3;
  while (rctx.activePathTraces.length >= maxTraces) {
    rctx.activePathTraces.shift();
  }
  rctx.activePathTraces.push({
    segments,
    totalLength,
    colorId,
    z,
    age: 0.001,
    maxAge: DEFAULT_TRACE_MAX_AGE_SEC,
    alphaScale,
    headOriginX: endPt.x - cols * 0.5,
    headOriginY: endPt.y - rows * 0.5,
    spanCols: cols,
    spanRows: rows,
    headCellMask: resolvedMask,
  });
}

export function stepPathTracesImpl(rctx: PathTraceHost, dtSec: number): void {
  if (rctx.lastOptions.reducedMotion) {
    if (rctx.activePathTraces.length > 0) {
      rctx.activePathTraces.length = 0;
    }
    return;
  }
  for (let i = rctx.activePathTraces.length - 1; i >= 0; i--) {
    const tr = rctx.activePathTraces[i];
    tr.age += dtSec;
    if (tr.age >= tr.maxAge) {
      rctx.activePathTraces.splice(i, 1);
    }
  }
}
