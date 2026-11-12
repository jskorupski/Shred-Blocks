import type { ColorId } from '../core/types';

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
