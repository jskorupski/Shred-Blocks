import type { BoardState, ColorId, GateState } from '../core/types';
import { MESH_INSTANCE_STRIDE } from './gl-program-state';

export interface CachedPlinthSpan {
  roomId: number;
  lowerX: number;
  lowerY: number;
  lowerW: number;
  lowerH: number;
  upperX: number;
  upperY: number;
  upperW: number;
  upperH: number;
}

export interface CachedFloorTile {
  r: number;
  c: number;
  roomId: number;
  isCheckerA: boolean;
}

export interface CachedFloorPathTile {
  r: number;
  c: number;
  roomId: number;
  colorId: ColorId;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  padW: number;
  padH: number;
  padCx: number;
  padCy: number;
  sameTop: boolean;
  sameBot: boolean;
  sameLeft: boolean;
  sameRight: boolean;
}

export interface CachedPillarTile {
  r: number;
  c: number;
  roomId: number;
}

export interface CachedWallBox {
  x: number;
  y: number;
  w: number;
  h: number;
  roomId: number;
}

export interface StaticPass1Topology {
  plinthSpans: readonly CachedPlinthSpan[];
  playableTiles: readonly CachedFloorTile[];
  floorPathTiles: readonly CachedFloorPathTile[];
  pillarTiles: readonly CachedPillarTile[];
  wallSegments: readonly CachedWallBox[];
  wallRims: readonly CachedWallBox[];
}

const topologyCache = new WeakMap<BoardState, StaticPass1Topology>();
let instanceScratch = new Float32Array(256 * MESH_INSTANCE_STRIDE);

/** Returns a reusable zero-allocation `Float32Array` staging buffer large enough for `count` instances. */
export function acquirePass1InstanceScratch(count: number): Float32Array {
  const needed = count * MESH_INSTANCE_STRIDE;
  if (instanceScratch.length < needed) {
    let next = instanceScratch.length;
    while (next < needed) next *= 2;
    instanceScratch = new Float32Array(next);
  }
  return instanceScratch;
}

/**
 * Computes and caches static Pass 1 courtyard & perimeter geometry once per immutable `BoardState`
 * (`PERF-GPU-01`), eliminating per-frame plinth-span merging, `isUnitEdgeCoveredByGate()` O(N×G)
 * loops, and full-grid scans for sparse `FLOOR_PATHS` / pillars.
 */
export function getOrBuildStaticPass1Topology(board: BoardState): StaticPass1Topology {
  const cached = topologyCache.get(board);
  if (cached) return cached;

  const { rows, cols, occupancy, floorColor } = board;
  const isCellPlayable = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && occupancy[r * cols + c] !== -1;

  // 1A. Contoured Stepped Sanctuary Pedestal Plinth spans
  const rawSpans: Array<{ r0: number; r1: number; c0: number; c1: number; roomId: number }> = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!isCellPlayable(r, c)) {
        c++;
        continue;
      }
      const roomId = board.roomMap[r * cols + c] ?? 0;
      const c0 = c;
      while (
        c + 1 < cols &&
        isCellPlayable(r, c + 1) &&
        (board.roomMap[r * cols + (c + 1)] ?? 0) === roomId
      ) {
        c++;
      }
      const c1 = c;
      const prev = rawSpans.find((s) => s.r1 === r - 1 && s.c0 === c0 && s.c1 === c1 && s.roomId === roomId);
      if (prev) {
        prev.r1 = r;
      } else {
        rawSpans.push({ r0: r, r1: r, c0, c1, roomId });
      }
      c++;
    }
  }

  const plinthSpans: CachedPlinthSpan[] = [];
  for (const span of rawSpans) {
    let bordersDiffRoomTop = false;
    let bordersDiffRoomBot = false;
    for (let c = span.c0; c <= span.c1; c++) {
      if (
        span.r0 > 0 &&
        isCellPlayable(span.r0 - 1, c) &&
        (board.roomMap[(span.r0 - 1) * cols + c] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomTop = true;
      }
      if (
        span.r1 < rows - 1 &&
        isCellPlayable(span.r1 + 1, c) &&
        (board.roomMap[(span.r1 + 1) * cols + c] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomBot = true;
      }
    }
    let bordersDiffRoomLeft = false;
    let bordersDiffRoomRight = false;
    for (let r = span.r0; r <= span.r1; r++) {
      if (
        span.c0 > 0 &&
        isCellPlayable(r, span.c0 - 1) &&
        (board.roomMap[r * cols + (span.c0 - 1)] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomLeft = true;
      }
      if (
        span.c1 < cols - 1 &&
        isCellPlayable(r, span.c1 + 1) &&
        (board.roomMap[r * cols + (span.c1 + 1)] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomRight = true;
      }
    }
    const stepL = bordersDiffRoomLeft ? 0.02 : 0.55;
    const stepR = bordersDiffRoomRight ? 0.02 : 0.55;
    const stepT = bordersDiffRoomTop ? 0.02 : 0.55;
    const stepB = bordersDiffRoomBot ? 0.02 : 0.55;
    const padL = bordersDiffRoomLeft ? 0.02 : 0.38;
    const padR = bordersDiffRoomRight ? 0.02 : 0.38;
    const padT = bordersDiffRoomTop ? 0.02 : 0.38;
    const padB = bordersDiffRoomBot ? 0.02 : 0.38;
    const spanW = span.c1 - span.c0 + 1;
    const spanH = span.r1 - span.r0 + 1;

    plinthSpans.push({
      roomId: span.roomId,
      lowerX: span.c0 - stepL,
      lowerY: span.r0 - stepT,
      lowerW: spanW + stepL + stepR,
      lowerH: spanH + stepT + stepB,
      upperX: span.c0 - padL,
      upperY: span.r0 - padT,
      upperW: spanW + padL + padR,
      upperH: spanH + padT + padB,
    });
  }

  // 1B. Playable floor tiles, sparse color-filter floor paths, and interior pillars
  const playableTiles: CachedFloorTile[] = [];
  const floorPathTiles: CachedFloorPathTile[] = [];
  const pillarTiles: CachedPillarTile[] = [];
  const pathMargin = 0.085;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const occ = occupancy[idx];
      if (occ === -1) continue;
      const roomId = board.roomMap[idx] ?? 0;
      playableTiles.push({ r, c, roomId, isCheckerA: (r + c) % 2 === 0 });

      const pathColorId = (floorColor[idx] ?? 0) as ColorId;
      if (pathColorId > 0) {
        const sameColorAt = (nr: number, nc: number): boolean =>
          isCellPlayable(nr, nc) &&
          (board.roomMap[nr * cols + nc] ?? 0) === roomId &&
          floorColor[nr * cols + nc] === pathColorId;
        const sameTop = sameColorAt(r - 1, c);
        const sameBot = sameColorAt(r + 1, c);
        const sameLeft = sameColorAt(r, c - 1);
        const sameRight = sameColorAt(r, c + 1);
        const x0 = c + (sameLeft ? 0 : pathMargin);
        const x1 = c + 1 - (sameRight ? 0 : pathMargin);
        const y0 = r + (sameTop ? 0 : pathMargin);
        const y1 = r + 1 - (sameBot ? 0 : pathMargin);
        floorPathTiles.push({
          r,
          c,
          roomId,
          colorId: pathColorId,
          x0,
          x1,
          y0,
          y1,
          padW: x1 - x0,
          padH: y1 - y0,
          padCx: (x0 + x1) * 0.5,
          padCy: (y0 + y1) * 0.5,
          sameTop,
          sameBot,
          sameLeft,
          sameRight,
        });
      }

      if (occ === -2) {
        pillarTiles.push({ r, c, roomId });
      }
    }
  }

  // 1F. Contoured Perimeter Parapet Walls, Corner Posts & Rim Strips (`COURTYARD-01`, `GATE-STEP-01`)
  const wallThick = 0.42;
  const gateThick = wallThick - 0.03;
  const wallSegments: CachedWallBox[] = [];
  const wallRims: CachedWallBox[] = [];

  const isUnitEdgeCoveredByGate = (edge: GateState['edge'], edgeLine: number, spanCell: number): boolean => {
    for (const gate of board.gates) {
      if (
        gate.edge === edge &&
        gate.edgeLine === edgeLine &&
        spanCell >= gate.spanStart &&
        spanCell < gate.spanStart + gate.spanLength
      ) {
        return true;
      }
    }
    return false;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isCellPlayable(r, c)) continue;
      const roomId = board.roomMap[r * cols + c] ?? 0;
      const topOpen = !isCellPlayable(r - 1, c);
      const botOpen = !isCellPlayable(r + 1, c);
      const leftOpen = !isCellPlayable(r, c - 1);
      const rightOpen = !isCellPlayable(r, c + 1);

      if (topOpen && !isUnitEdgeCoveredByGate('TOP', r, c)) {
        const trimLeft =
          isCellPlayable(r - 1, c - 1) && isUnitEdgeCoveredByGate('RIGHT', c - 1, r - 1) ? gateThick : 0;
        const trimRight =
          isCellPlayable(r - 1, c + 1) && isUnitEdgeCoveredByGate('LEFT', c + 1, r - 1) ? gateThick : 0;
        const segW = 1 - trimLeft - trimRight;
        if (segW > 0.02) {
          wallSegments.push({ x: c + trimLeft, y: r - wallThick, w: segW, h: wallThick, roomId });
          wallRims.push({ x: c + trimLeft, y: r - 0.09, w: segW, h: 0.08, roomId });
        }
      }
      if (botOpen && !isUnitEdgeCoveredByGate('BOTTOM', r, c)) {
        const trimLeft =
          isCellPlayable(r + 1, c - 1) && isUnitEdgeCoveredByGate('RIGHT', c - 1, r + 1) ? gateThick : 0;
        const trimRight =
          isCellPlayable(r + 1, c + 1) && isUnitEdgeCoveredByGate('LEFT', c + 1, r + 1) ? gateThick : 0;
        const segW = 1 - trimLeft - trimRight;
        if (segW > 0.02) {
          wallSegments.push({ x: c + trimLeft, y: r + 1, w: segW, h: wallThick, roomId });
          wallRims.push({ x: c + trimLeft, y: r + 1.01, w: segW, h: 0.08, roomId });
        }
      }
      if (leftOpen && !isUnitEdgeCoveredByGate('LEFT', c, r)) {
        const trimTop = isCellPlayable(r - 1, c - 1)
          ? isUnitEdgeCoveredByGate('BOTTOM', r - 1, c - 1)
            ? gateThick
            : wallThick
          : 0;
        const trimBot = isCellPlayable(r + 1, c - 1)
          ? isUnitEdgeCoveredByGate('TOP', r + 1, c - 1)
            ? gateThick
            : wallThick
          : 0;
        const segH = 1 - trimTop - trimBot;
        if (segH > 0.02) {
          wallSegments.push({ x: c - wallThick, y: r + trimTop, w: wallThick, h: segH, roomId });
          wallRims.push({ x: c - 0.09, y: r + trimTop, w: 0.08, h: segH, roomId });
        }
      }
      if (rightOpen && !isUnitEdgeCoveredByGate('RIGHT', c, r)) {
        const trimTop = isCellPlayable(r - 1, c + 1)
          ? isUnitEdgeCoveredByGate('BOTTOM', r - 1, c + 1)
            ? gateThick
            : wallThick
          : 0;
        const trimBot = isCellPlayable(r + 1, c + 1)
          ? isUnitEdgeCoveredByGate('TOP', r + 1, c + 1)
            ? gateThick
            : wallThick
          : 0;
        const segH = 1 - trimTop - trimBot;
        if (segH > 0.02) {
          wallSegments.push({ x: c + 1, y: r + trimTop, w: wallThick, h: segH, roomId });
          wallRims.push({ x: c + 1.01, y: r + trimTop, w: 0.08, h: segH, roomId });
        }
      }

      const pushCornerPost = (px: number, py: number): void => {
        wallSegments.push({ x: px, y: py, w: wallThick, h: wallThick, roomId });
      };
      if (topOpen && leftOpen) pushCornerPost(c - wallThick, r - wallThick);
      if (topOpen && rightOpen) pushCornerPost(c + 1, r - wallThick);
      if (botOpen && leftOpen) pushCornerPost(c - wallThick, r + 1);
      if (botOpen && rightOpen) pushCornerPost(c + 1, r + 1);
      if (
        !topOpen &&
        !leftOpen &&
        !isCellPlayable(r - 1, c - 1) &&
        isUnitEdgeCoveredByGate('LEFT', c, r - 1) &&
        isUnitEdgeCoveredByGate('TOP', r, c - 1)
      ) {
        pushCornerPost(c - wallThick, r - wallThick);
      }
      if (
        !topOpen &&
        !rightOpen &&
        !isCellPlayable(r - 1, c + 1) &&
        isUnitEdgeCoveredByGate('RIGHT', c, r - 1) &&
        isUnitEdgeCoveredByGate('TOP', r, c + 1)
      ) {
        pushCornerPost(c + 1, r - wallThick);
      }
      if (
        !botOpen &&
        !leftOpen &&
        !isCellPlayable(r + 1, c - 1) &&
        isUnitEdgeCoveredByGate('LEFT', c, r + 1) &&
        isUnitEdgeCoveredByGate('BOTTOM', r, c - 1)
      ) {
        pushCornerPost(c - wallThick, r + 1);
      }
      if (
        !botOpen &&
        !rightOpen &&
        !isCellPlayable(r + 1, c + 1) &&
        isUnitEdgeCoveredByGate('RIGHT', c, r + 1) &&
        isUnitEdgeCoveredByGate('BOTTOM', r, c + 1)
      ) {
        pushCornerPost(c + 1, r + 1);
      }
    }
  }

  const topology: StaticPass1Topology = {
    plinthSpans,
    playableTiles,
    floorPathTiles,
    pillarTiles,
    wallSegments,
    wallRims,
  };
  topologyCache.set(board, topology);
  return topology;
}
