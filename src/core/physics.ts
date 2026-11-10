import { getActiveColor, getShape } from './polyomino';
import {
  getGroupAxisLock,
  getMovedGroupBlocks,
  isBlockMovable,
  rebuildOccupancyGrid,
} from './room-and-occupancy';
import type { BlockState, BoardState } from './types';

export * from './room-and-occupancy';

export const MAX_SWEEP_SUBSTEP = 0.18;
export const CORNER_BEVEL_THRESHOLD = 0.35;
const EPS = 1e-4;

/**
 * Checks whether a single block (or rigid group) can occupy the integer offset
 * `(leadTargetRow - lead.row, leadTargetCol - lead.col)`.
 * Enforces F-04 Floor-Path Exemption for Current Footprint so a multi-layer block
 * whose outer layer just peeled on a colorful floor tile is never trapped inside that tile.
 */
export function canGroupOccupyOffset(
  board: BoardState,
  group: BlockState[],
  dRow: number,
  dCol: number
): boolean {
  const { rows, cols, occupancy, floorColor } = board;
  const groupIds = new Set<number>();
  for (const b of group) groupIds.add(b.id);

  for (const b of group) {
    const shape = getShape(b.shapeId);
    const activeColor = getActiveColor(b.colorStack, b.colorCursor);

    // Build set of b's own current integer footprint for F-04 Floor-Path Exemption
    const initialCells = new Set<number>();
    for (const [dr, dc] of shape.cells) {
      initialCells.add((b.row + dr) * cols + (b.col + dc));
    }

    for (const [dr, dc] of shape.cells) {
      const nr = b.row + dRow + dr;
      const nc = b.col + dCol + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
        return false;
      }
      const cellIdx = nr * cols + nc;
      const occ = occupancy[cellIdx];
      if (occ !== 0 && !groupIds.has(occ)) {
        return false;
      }
      const fc = floorColor[cellIdx];
      if (fc !== 0 && fc !== activeColor && !initialCells.has(cellIdx)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Checks whether a continuous floating-point offset `(dx, dy)` relative to the group's
 * integer anchor `(b.col, b.row)` overlaps any blocked cell.
 * `exemptDx` and `exemptDy` specify the group's current substep offset for `F-04` Floor-Path
 * Exemption so that once a block slides completely off a mismatched floor tile during a drag,
 * it cannot re-enter that mismatched tile.
 */
export function isContinuousOffsetValid(
  board: BoardState,
  group: BlockState[],
  dx: number,
  dy: number,
  exemptDx = 0,
  exemptDy = 0
): boolean {
  const { rows, cols, occupancy, floorColor } = board;
  const groupIds = new Set<number>();
  for (const b of group) groupIds.add(b.id);

  for (const b of group) {
    const shape = getShape(b.shapeId);
    const activeColor = getActiveColor(b.colorStack, b.colorCursor);
    const bx = b.col + dx;
    const by = b.row + dy;

    const exBx = b.col + exemptDx;
    const exBy = b.row + exemptDy;
    const exemptCells = new Set<number>();
    for (const [dr, dc] of shape.cells) {
      const exMinC = Math.floor(exBx + dc + EPS);
      const exMaxC = Math.floor(exBx + dc + 1 - EPS);
      const exMinR = Math.floor(exBy + dr + EPS);
      const exMaxR = Math.floor(exBy + dr + 1 - EPS);
      for (let r = exMinR; r <= exMaxR; r++) {
        for (let c = exMinC; c <= exMaxC; c++) {
          if (r >= 0 && r < rows && c >= 0 && c < cols) {
            exemptCells.add(r * cols + c);
          }
        }
      }
    }

    for (const [dr, dc] of shape.cells) {
      const cellMinX = bx + dc + EPS;
      const cellMaxX = bx + dc + 1 - EPS;
      const cellMinY = by + dr + EPS;
      const cellMaxY = by + dr + 1 - EPS;

      const minC = Math.floor(cellMinX);
      const maxC = Math.floor(cellMaxX);
      const minR = Math.floor(cellMinY);
      const maxR = Math.floor(cellMaxY);

      if (minC < 0 || maxC >= cols || minR < 0 || maxR >= rows) {
        return false;
      }

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const idx = r * cols + c;
          const occ = occupancy[idx];
          if (occ !== 0 && !groupIds.has(occ)) {
            return false;
          }
          const fc = floorColor[idx];
          if (fc !== 0 && fc !== activeColor && !exemptCells.has(idx)) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

/**
 * Sweeps a single axis (`'X'` or `'Y'`) from `(curDx, curDy)` by `delta` and clamps
 * to the exact integer obstacle boundary (`F-04` Exact Obstacle-Edge Clamping) if blocked.
 */
function sweepSingleAxisWithClamp(
  board: BoardState,
  group: BlockState[],
  curDx: number,
  curDy: number,
  axis: 'X' | 'Y',
  delta: number
): { dx: number; dy: number; blocked: boolean } {
  if (Math.abs(delta) < 1e-7) {
    return { dx: curDx, dy: curDy, blocked: false };
  }

  const nextDx = axis === 'X' ? curDx + delta : curDx;
  const nextDy = axis === 'Y' ? curDy + delta : curDy;

  if (isContinuousOffsetValid(board, group, nextDx, nextDy, curDx, curDy)) {
    return { dx: nextDx, dy: nextDy, blocked: false };
  }

  // Exact Obstacle-Edge Clamping (F-04):
  // Since all grid cells and obstacles align to integer coordinates, the exact contact
  // boundary along the swept axis is either the nearest integer coordinate in the direction
  // of travel or found via a tight 8-iteration binary search between cur and next.
  const nearestInt =
    delta > 0
      ? Math.floor((axis === 'X' ? curDx : curDy) + EPS) + 1 - (axis === 'X' ? 0 : 0)
      : Math.ceil((axis === 'X' ? curDx : curDy) - EPS) - 1;

  // Test snapping directly to the integer grid line between current and target if it lies in range
  const curVal = axis === 'X' ? curDx : curDy;
  const targetVal = curVal + delta;
  const snapCandidate = delta > 0 ? Math.floor(targetVal + EPS) : Math.ceil(targetVal - EPS);

  if (
    ((delta > 0 && snapCandidate >= curVal - EPS && snapCandidate <= targetVal + EPS) ||
      (delta < 0 && snapCandidate <= curVal + EPS && snapCandidate >= targetVal - EPS)) &&
    isContinuousOffsetValid(
      board,
      group,
      axis === 'X' ? snapCandidate : curDx,
      axis === 'Y' ? snapCandidate : curDy,
      curDx,
      curDy
    )
  ) {
    return {
      dx: axis === 'X' ? snapCandidate : curDx,
      dy: axis === 'Y' ? snapCandidate : curDy,
      blocked: true,
    };
  }

  // Binary refine for sub-pixel precision if still needed, then round to integer if within 1e-3
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) * 0.5;
    const testDx = axis === 'X' ? curDx + delta * mid : curDx;
    const testDy = axis === 'Y' ? curDy + delta * mid : curDy;
    if (isContinuousOffsetValid(board, group, testDx, testDy, curDx, curDy)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  let clampedDx = axis === 'X' ? curDx + delta * lo : curDx;
  let clampedDy = axis === 'Y' ? curDy + delta * lo : curDy;

  if (Math.abs(clampedDx - Math.round(clampedDx)) < 0.02) {
    const rx = Math.round(clampedDx);
    if (isContinuousOffsetValid(board, group, rx, clampedDy, curDx, curDy)) clampedDx = rx;
  }
  if (Math.abs(clampedDy - Math.round(clampedDy)) < 0.02) {
    const ry = Math.round(clampedDy);
    if (isContinuousOffsetValid(board, group, clampedDx, ry, curDx, curDy)) clampedDy = ry;
  }

  void nearestInt;
  return { dx: clampedDx, dy: clampedDy, blocked: true };
}

export interface SweepStepCallbackResult {
  capturedGateIndex: number;
}

/**
 * Performs continuous sub-stepped (`<= 0.18` cell) swept multi-cell collision for a dragged
 * block (and its glued group), featuring:
 * 1. Axis Lock projection (`H` -> `dy = 0`, `V` -> `dx = 0`)
 * 2. Exact Obstacle-Edge Clamping (`F-04`)
 * 3. Dominant-Axis-First 2D Open-Space Glide + Same-Substep Corner Bevel Retry (`0.35` cell threshold)
 * 4. Optional `onSubstep` hook for Intentional Mid-Drag Gate Capture (`F-01`)
 */
export function sweepBlockToTarget(
  board: BoardState,
  blockId: number,
  targetX: number,
  targetY: number,
  onSubstep?: (leadX: number, leadY: number, stepVecX: number, stepVecY: number) => number
): { leadX: number; leadY: number; capturedGateIndex: number } {
  const group = getMovedGroupBlocks(board, blockId);
  if (group.length === 0 || !isBlockMovable(board, blockId)) {
    const b = board.blocks.find((blk) => blk.id === blockId);
    return { leadX: b ? b.x : 0, leadY: b ? b.y : 0, capturedGateIndex: -1 };
  }

  const lead = group.find((b) => b.id === blockId) ?? group[0];
  const lock = getGroupAxisLock(group);

  let curDx = lead.x - lead.col;
  let curDy = lead.y - lead.row;

  let desiredDx = targetX - lead.col;
  let desiredDy = targetY - lead.row;

  if (lock === 'H') desiredDy = 0;
  if (lock === 'V') desiredDx = 0;

  const manhattanDist = Math.abs(desiredDx - curDx) + Math.abs(desiredDy - curDy);
  const steps = Math.max(2, Math.min(48, Math.ceil(manhattanDist / MAX_SWEEP_SUBSTEP) + 4));

  let capturedGateIndex = -1;
  let channelSwitchedInSweep = false;
  let beveledXInStep = false;
  let beveledYInStep = false;
  const BEVEL_SWITCH_HYSTERESIS = 0.08;

  const computeSubstepDelta = (curVal: number, remVal: number, perpRemVal: number): number => {
    if (Math.abs(remVal) <= 1e-7) return 0;
    let d = Math.sign(remVal) * Math.min(Math.abs(remVal), MAX_SWEEP_SUBSTEP);
    // If there is significant perpendicular pull, land cleanly on any crossed integer grid line
    // so the very next substep can turn 90 degrees into a narrow perpendicular corridor (`DRAG-02`).
    if (Math.abs(perpRemVal) > 0.12) {
      const nextInt = d > 0 ? Math.floor(curVal) + 1 : Math.ceil(curVal) - 1;
      const toInt = nextInt - curVal;
      if (toInt * d > 0 && Math.abs(toInt) > 1e-6 && Math.abs(toInt) < Math.abs(d)) {
        d = toInt;
      }
    }
    return d;
  };

  const tryCornerBevelAssist = (blockedAxis: 'X' | 'Y'): boolean => {
    if (channelSwitchedInSweep) return false;
    if (blockedAxis === 'X') {
      if (lock === 'V') return false;
      const remX = desiredDx - curDx;
      const snapDy = Math.round(curDy);
      const curOffY = Math.abs(curDy - snapDy);
      const pullYFromSnap = Math.abs(desiredDy - snapDy);
      if (
        curOffY > 1e-4 &&
        curOffY <= CORNER_BEVEL_THRESHOLD &&
        Math.abs(remX) > Math.max(curOffY, pullYFromSnap) + BEVEL_SWITCH_HYSTERESIS &&
        isContinuousOffsetValid(board, group, curDx, snapDy, curDx, curDy)
      ) {
        const dX = computeSubstepDelta(curDx, remX, 0);
        const retryX = sweepSingleAxisWithClamp(board, group, curDx, snapDy, 'X', dX);
        if (Math.abs(retryX.dx - curDx) > 1e-4) {
          curDx = retryX.dx;
          curDy = retryX.dy;
          desiredDy = snapDy;
          channelSwitchedInSweep = true;
          beveledYInStep = true;
          return true;
        }
      }
    } else {
      if (lock === 'H') return false;
      const remY = desiredDy - curDy;
      const snapDx = Math.round(curDx);
      const curOffX = Math.abs(curDx - snapDx);
      const pullXFromSnap = Math.abs(desiredDx - snapDx);
      if (
        curOffX > 1e-4 &&
        curOffX <= CORNER_BEVEL_THRESHOLD &&
        Math.abs(remY) > Math.max(curOffX, pullXFromSnap) + BEVEL_SWITCH_HYSTERESIS &&
        isContinuousOffsetValid(board, group, snapDx, curDy, curDx, curDy)
      ) {
        const dY = computeSubstepDelta(curDy, remY, 0);
        const retryY = sweepSingleAxisWithClamp(board, group, snapDx, curDy, 'Y', dY);
        if (Math.abs(retryY.dy - curDy) > 1e-4) {
          curDx = retryY.dx;
          curDy = retryY.dy;
          desiredDx = snapDx;
          channelSwitchedInSweep = true;
          beveledXInStep = true;
          return true;
        }
      }
    }
    return false;
  };

  for (let s = 0; s < steps; s++) {
    const prevDx = curDx;
    const prevDy = curDy;
    beveledXInStep = false;
    beveledYInStep = false;

    const remX = desiredDx - curDx;
    const remY = desiredDy - curDy;
    if (Math.abs(remX) < 1e-6 && Math.abs(remY) < 1e-6) {
      break;
    }

    if (Math.abs(curDx - Math.round(curDx)) <= 1e-4 && Math.abs(remX) <= 1e-5) {
      curDx = Math.round(curDx);
    }
    if (Math.abs(curDy - Math.round(curDy)) <= 1e-4 && Math.abs(remY) <= 1e-5) {
      curDy = Math.round(curDy);
    }

    // Sweep dominant remaining axis first, then secondary axis, allowing smooth 2D glide in
    // unobstructed space while clamping cleanly against walls/blocks and beveling around corners.
    const domX = Math.abs(remX) >= Math.abs(remY);
    const firstAxis: 'X' | 'Y' = domX ? 'X' : 'Y';
    const secondAxis: 'X' | 'Y' = domX ? 'Y' : 'X';

    const firstRem = domX ? desiredDx - curDx : desiredDy - curDy;
    const secondRemBefore = domX ? desiredDy - curDy : desiredDx - curDx;
    const firstDelta = domX
      ? computeSubstepDelta(curDx, firstRem, secondRemBefore)
      : computeSubstepDelta(curDy, firstRem, secondRemBefore);

    if (Math.abs(firstDelta) > 1e-6) {
      const res1 = sweepSingleAxisWithClamp(board, group, curDx, curDy, firstAxis, firstDelta);
      const progressed1 = Math.abs(res1.dx - curDx) > 1e-5 || Math.abs(res1.dy - curDy) > 1e-5;
      curDx = res1.dx;
      curDy = res1.dy;

      if (!progressed1) {
        tryCornerBevelAssist(firstAxis);
      }
    }

    if (!channelSwitchedInSweep) {
      const secondRem = domX ? desiredDy - curDy : desiredDx - curDx;
      const firstRemAfter = domX ? desiredDx - curDx : desiredDy - curDy;
      const secondDelta = domX
        ? computeSubstepDelta(curDy, secondRem, firstRemAfter)
        : computeSubstepDelta(curDx, secondRem, firstRemAfter);

      if (Math.abs(secondDelta) > 1e-6) {
        const res2 = sweepSingleAxisWithClamp(board, group, curDx, curDy, secondAxis, secondDelta);
        const progressed2 = Math.abs(res2.dx - curDx) > 1e-5 || Math.abs(res2.dy - curDy) > 1e-5;
        curDx = res2.dx;
        curDy = res2.dy;

        if (!progressed2) {
          tryCornerBevelAssist(secondAxis);
        }
      }
    }

    // Apply continuous positions to all blocks in the rigid group
    for (const b of group) {
      b.x = b.col + curDx;
      b.y = b.row + curDy;
    }

    if (onSubstep) {
      const stepVecX = beveledXInStep ? 0 : curDx - prevDx;
      const stepVecY = beveledYInStep ? 0 : curDy - prevDy;
      const gateIdx = onSubstep(lead.x, lead.y, stepVecX, stepVecY);
      if (gateIdx >= 0) {
        capturedGateIndex = gateIdx;
        break;
      }
    }
  }

  return {
    leadX: lead.x,
    leadY: lead.y,
    capturedGateIndex,
  };
}

/**
 * Snaps a dragged block (and its rigid group) to the nearest valid integer grid cell.
 * Returns `true` if the block's integer `(row, col)` changed from its starting cell.
 */
export function snapGroupToNearestGrid(board: BoardState, blockId: number): boolean {
  const group = getMovedGroupBlocks(board, blockId);
  if (group.length === 0) return false;
  const lead = group.find((b) => b.id === blockId) ?? group[0];

  const rawDCol = Math.round(lead.x - lead.col);
  const rawDRow = Math.round(lead.y - lead.row);

  let chosenDRow = 0;
  let chosenDCol = 0;

  if (canGroupOccupyOffset(board, group, rawDRow, rawDCol)) {
    chosenDRow = rawDRow;
    chosenDCol = rawDCol;
  } else {
    // Search nearby integer offsets sorted by Euclidean distance to current continuous offset
    const contDCol = lead.x - lead.col;
    const contDRow = lead.y - lead.row;
    let bestDist = Infinity;

    for (let dr = rawDRow - 1; dr <= rawDRow + 1; dr++) {
      for (let dc = rawDCol - 1; dc <= rawDCol + 1; dc++) {
        if (canGroupOccupyOffset(board, group, dr, dc)) {
          const d = Math.hypot(contDCol - dc, contDRow - dr);
          if (d < bestDist) {
            bestDist = d;
            chosenDRow = dr;
            chosenDCol = dc;
          }
        }
      }
    }
  }

  const moved = chosenDRow !== 0 || chosenDCol !== 0;
  for (const b of group) {
    b.row += chosenDRow;
    b.col += chosenDCol;
    b.x = b.col;
    b.y = b.row;
  }

  rebuildOccupancyGrid(board);
  return moved;
}

/**
 * Flood-fills all reachable integer `(row, col)` anchor positions for `blockId` (and its group)
 * in a single continuous drag gesture. Used by the BFS/IDA* solver, hint system, and tests.
 */
export function getReachableAnchors(
  board: BoardState,
  blockId: number
): Array<{ row: number; col: number; dist: number }> {
  const group = getMovedGroupBlocks(board, blockId);
  if (group.length === 0 || !isBlockMovable(board, blockId)) return [];

  const lead = group.find((b) => b.id === blockId) ?? group[0];
  const lock = getGroupAxisLock(group);
  if (lock === 'LOCKED_BOTH') return [];

  const dirs: Array<[number, number]> =
    lock === 'H'
      ? [
          [0, -1],
          [0, 1],
        ]
      : lock === 'V'
        ? [
            [-1, 0],
            [1, 0],
          ]
        : [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ];

  const visited = new Set<number>();
  const encode = (dRow: number, dCol: number) => (dRow + 16) * 64 + (dCol + 16);
  visited.add(encode(0, 0));

  const queue: Array<{ dRow: number; dCol: number; dist: number }> = [{ dRow: 0, dCol: 0, dist: 0 }];
  const results: Array<{ row: number; col: number; dist: number }> = [
    { row: lead.row, col: lead.col, dist: 0 },
  ];

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dr, dc] of dirs) {
      const ndRow = cur.dRow + dr;
      const ndCol = cur.dCol + dc;
      const key = encode(ndRow, ndCol);
      if (visited.has(key)) continue;
      if (canGroupOccupyOffset(board, group, ndRow, ndCol)) {
        visited.add(key);
        const nextDist = cur.dist + 1;
        queue.push({ dRow: ndRow, dCol: ndCol, dist: nextDist });
        results.push({
          row: lead.row + ndRow,
          col: lead.col + ndCol,
          dist: nextDist,
        });
      }
    }
  }

  return results;
}
