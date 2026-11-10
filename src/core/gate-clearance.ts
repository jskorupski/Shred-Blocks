import {
  canGroupOccupyOffset,
  getMovedGroupBlocks,
  isBlockInLockedRoom,
  isGateInLockedRoom,
  isRoomUnlocked,
  rebuildOccupancyGrid,
} from './physics';
import { getActiveColor, getShape } from './polyomino';
import {
  autoAdvanceColorQueues,
  detachBlockFromGluedGroup,
  getGateActiveColor,
  getGateOutwardNormal,
  stepDynamicGatesOnShred,
  stepMovingElevators,
  stepPortcullisBarriersOnShred,
  triggerCarrierItems,
  trySpawnReadyGenerators,
} from './shred-side-effects';
import type { BlockState, BoardState, EdgeDir, GateState } from './types';

export * from './shred-side-effects';

/**
 * Evaluates the 4-part Gate Clearance Law for `block` placed at integer `(candidateRow, candidateCol)`:
 * 1. Color, Star & Gate Lock compatibility
 * 2. Perpendicular Span Containment (`spanStart .. spanStart + spanLength - 1`)
 * 3. Edge Contact (`row === 0`, `row + shape.rows === board.rows`, etc.)
 * 4. Non-Convex Raycast Swept-Path Clearance (every constituent cell has an unobstructed path to the gate)
 */
export function checkBlockGateClearance(
  board: BoardState,
  block: BlockState,
  gate: GateState,
  candidateRow = block.row,
  candidateCol = block.col
): boolean {
  if (block.status !== 'ACTIVE') return false;

  const activeColor = getActiveColor(block.colorStack, block.colorCursor);
  if (activeColor === 0) return false; // Stone blocks never exit gates
  if (block.iceCount > 0 || block.chained || block.ropeColor > 0) return false;
  if (isBlockInLockedRoom(board, block)) return false; // Blocks in sealed chambers are dormant
  if (isGateInLockedRoom(board, gate)) return false; // Gates inside sealed chambers are dormant

  // Axis-Lock Directional Exit Compatibility (`DRAG-01`):
  // Horizontal-locked blocks (`H`) can only exit through LEFT or RIGHT gates;
  // Vertical-locked blocks (`V`) can only exit through TOP or BOTTOM gates.
  const movedGroup = getMovedGroupBlocks(board, block.id);
  for (const member of movedGroup) {
    if (member.axisLock === 'H' && (gate.edge === 'TOP' || gate.edge === 'BOTTOM')) {
      return false;
    }
    if (member.axisLock === 'V' && (gate.edge === 'LEFT' || gate.edge === 'RIGHT')) {
      return false;
    }
  }

  // 1. Color, Star & Gate Lock compatibility
  const gateColor = getGateActiveColor(gate);
  if (gateColor !== activeColor) return false;
  if (block.isStar && !gate.isStar) return false;
  if (gate.iceCount > 0) return false;
  if (gate.shutterLockColor > 0) return false;
  if (!gate.shutterOpen) return false;

  const shape = getShape(block.shapeId);
  const edgeLine =
    gate.edgeLine ??
    (gate.edge === 'TOP' || gate.edge === 'LEFT'
      ? 0
      : gate.edge === 'BOTTOM'
        ? board.rows - 1
        : board.cols - 1);

  // 2. Perpendicular Span Containment & 3. Edge Contact (including Stepped-Edge `edgeLine`)
  if (gate.edge === 'TOP' || gate.edge === 'BOTTOM') {
    const minCol = candidateCol;
    const maxCol = candidateCol + shape.cols - 1;
    const gateMinCol = gate.spanStart;
    const gateMaxCol = gate.spanStart + gate.spanLength - 1;
    if (minCol < gateMinCol || maxCol > gateMaxCol) return false;

    if (gate.edge === 'TOP' && candidateRow !== edgeLine) return false;
    if (gate.edge === 'BOTTOM' && candidateRow + shape.rows - 1 !== edgeLine) return false;
  } else {
    const minRow = candidateRow;
    const maxRow = candidateRow + shape.rows - 1;
    const gateMinRow = gate.spanStart;
    const gateMaxRow = gate.spanStart + gate.spanLength - 1;
    if (minRow < gateMinRow || maxRow > gateMaxRow) return false;

    if (gate.edge === 'LEFT' && candidateCol !== edgeLine) return false;
    if (gate.edge === 'RIGHT' && candidateCol + shape.cols - 1 !== edgeLine) return false;
  }

  // 4. Non-Convex Swept-Path Raycast Clearance:
  // Every constituent cell of the polyomino must have a clear line of sight out the gate edgeLine
  // without colliding with another block, shifted glued sibling, obstacle, or mismatched floor path.
  const { rows, cols, occupancy, floorColor } = board;
  const dRow = candidateRow - block.row;
  const dCol = candidateCol - block.col;

  const candidateFootprint = new Set<number>();
  for (const [dr, dc] of shape.cells) {
    const cr = candidateRow + dr;
    const cc = candidateCol + dc;
    if (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
      candidateFootprint.add(cr * cols + cc);
    }
  }

  const groupIds = new Set<number>([block.id]);
  const shiftedSiblingCells = new Set<number>();
  if (block.groupId > 0) {
    for (const sib of board.blocks) {
      if (sib.status === 'ACTIVE' && sib.groupId === block.groupId) {
        groupIds.add(sib.id);
        if (sib.id !== block.id) {
          const sibShape = getShape(sib.shapeId);
          for (const [sdr, sdc] of sibShape.cells) {
            const sr = sib.row + dRow + sdr;
            const sc = sib.col + dCol + sdc;
            if (sr >= 0 && sr < rows && sc >= 0 && sc < cols) {
              shiftedSiblingCells.add(sr * cols + sc);
            }
          }
        }
      }
    }
  }

  const isRaycastCellBlocked = (r: number, c: number): boolean => {
    const idx = r * cols + c;
    if (shiftedSiblingCells.has(idx)) return true;
    const occ = occupancy[idx];
    if (occ !== 0 && !groupIds.has(occ)) return true;
    const fc = floorColor[idx];
    if (fc !== 0 && fc !== activeColor && !candidateFootprint.has(idx)) return true;
    return false;
  };

  for (const [dr, dc] of shape.cells) {
    const cellR = candidateRow + dr;
    const cellC = candidateCol + dc;

    if (gate.edge === 'TOP') {
      for (let r = cellR - 1; r >= edgeLine; r--) {
        if (isRaycastCellBlocked(r, cellC)) return false;
      }
    } else if (gate.edge === 'BOTTOM') {
      for (let r = cellR + 1; r <= edgeLine; r++) {
        if (isRaycastCellBlocked(r, cellC)) return false;
      }
    } else if (gate.edge === 'LEFT') {
      for (let c = cellC - 1; c >= edgeLine; c--) {
        if (isRaycastCellBlocked(cellR, c)) return false;
      }
    } else if (gate.edge === 'RIGHT') {
      for (let c = cellC + 1; c <= edgeLine; c++) {
        if (isRaycastCellBlocked(cellR, c)) return false;
      }
    }
  }

  return true;
}

function getGateResourcePriorityRank(gate: GateState): number {
  const isColorChanging = gate.colorCursor + 1 < gate.colorQueue.length;
  if (!isColorChanging && !gate.isStar) return 0; // Static Normal Gate
  if (!isColorChanging && gate.isStar) return 1; // Star Gate
  if (isColorChanging && !gate.isStar) return 2; // Color-Changing Gate
  return 3; // Color-Changing Star Gate
}

function getCanonicalEdgeOrder(edge: EdgeDir): number {
  switch (edge) {
    case 'TOP':
      return 0;
    case 'RIGHT':
      return 1;
    case 'BOTTOM':
      return 2;
    case 'LEFT':
      return 3;
  }
}

/**
 * Finds the best matching gate for `block` at `(candidateRow, candidateCol)`.
 * Applies F-07 Deterministic Corner Tie-Breaker:
 * - If a velocity vector `(velX, velY)` is supplied, prefers the gate whose outward normal
 *   has the larger positive dot product with `(velX, velY)`.
 * - Breaks ties by F-07 Resource Preservation Priority (`Static Normal > Star > Color-Changing`),
 *   then canonical edge order (`TOP < RIGHT < BOTTOM < LEFT`), then lowest `gate.index`.
 */
export function findEligibleGateForBlockAt(
  board: BoardState,
  block: BlockState,
  candidateRow = block.row,
  candidateCol = block.col,
  velX = 0,
  velY = 0
): number {
  let bestGateIndex = -1;
  let bestDot = -Infinity;
  let bestResourceRank = Infinity;
  let bestEdgeOrder = Infinity;

  for (let i = 0; i < board.gates.length; i++) {
    const gate = board.gates[i];
    if (!checkBlockGateClearance(board, block, gate, candidateRow, candidateCol)) {
      continue;
    }

    const [nx, ny] = getGateOutwardNormal(gate.edge);
    const dot = velX * nx + velY * ny;
    const resRank = getGateResourcePriorityRank(gate);
    const edgeOrder = getCanonicalEdgeOrder(gate.edge);

    if (bestGateIndex === -1 || dot > bestDot + 1e-6) {
      bestGateIndex = i;
      bestDot = dot;
      bestResourceRank = resRank;
      bestEdgeOrder = edgeOrder;
    } else if (Math.abs(dot - bestDot) <= 1e-6) {
      if (resRank < bestResourceRank || (resRank === bestResourceRank && edgeOrder < bestEdgeOrder)) {
        bestGateIndex = i;
        bestDot = dot;
        bestResourceRank = resRank;
        bestEdgeOrder = edgeOrder;
      }
    }
  }

  return bestGateIndex;
}

/**
 * F-01 Intentional Mid-Drag Gate Capture:
 * Checks whether a dragged block (or any member of its glued group) has reached a gate lip
 * within `0.18` cells along the gate's normal axis AND lies anywhere within the gate's
 * continuous parallel span aperture (`[minSpan - 0.45, maxSpan + 0.45]`) with a positive
 * motion or pull component toward the gate's outward normal, preventing both mid-gate
 * deadzones on wide gates and accidental perpendicular walk-by suction.
 */
export function checkMidDragGateCapture(
  board: BoardState,
  blockId: number,
  stepVecX: number,
  stepVecY: number,
  rawPullX = stepVecX,
  rawPullY = stepVecY
): { capturedBlockId: number; gateIndex: number } | null {
  const group = getMovedGroupBlocks(board, blockId);
  if (group.length === 0) return null;

  for (const b of group) {
    const shape = getShape(b.shapeId);

    for (let i = 0; i < board.gates.length; i++) {
      const gate = board.gates[i];
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const dot = stepVecX * nx + stepVecY * ny;
      const pullDot = rawPullX * nx + rawPullY * ny;
      const tanStep = Math.abs(stepVecX * ny - stepVecY * nx);
      const tanPull = Math.abs(rawPullX * ny - rawPullY * nx);
      if (pullDot < -0.02) {
        continue;
      }
      const hasIntentionalStep = dot >= 0.015 && dot >= tanStep * 0.25;
      const hasIntentionalPull = pullDot >= 0.08 && pullDot >= tanPull * 0.25;
      if (!hasIntentionalStep && !hasIntentionalPull) {
        continue;
      }

      const edgeLine =
        gate.edgeLine ??
        (gate.edge === 'TOP' || gate.edge === 'LEFT'
          ? 0
          : gate.edge === 'BOTTOM'
            ? board.rows - 1
            : board.cols - 1);

      if (gate.edge === 'TOP' || gate.edge === 'BOTTOM') {
        const targetRow = gate.edge === 'TOP' ? edgeLine : edgeLine - (shape.rows - 1);
        if (Math.abs(b.y - targetRow) > 0.18) continue;

        const minCol = gate.spanStart;
        const maxCol = gate.spanStart + gate.spanLength - shape.cols;
        if (maxCol < minCol) continue;
        if (b.x < minCol - 0.45 || b.x > maxCol + 0.45) continue;

        // Outer jaw bevel zone requires deliberate inward motion or pull toward the gate
        if ((b.x < minCol - 0.25 || b.x > maxCol + 0.25) && dot < 0.03 && pullDot < 0.12) {
          continue;
        }

        const candCols = [
          Math.max(minCol, Math.min(maxCol, Math.round(b.x))),
          Math.max(minCol, Math.min(maxCol, Math.floor(b.x))),
          Math.max(minCol, Math.min(maxCol, Math.ceil(b.x))),
        ];
        for (const cCol of candCols) {
          if (
            canGroupOccupyOffset(board, group, targetRow - b.row, cCol - b.col) &&
            checkBlockGateClearance(board, b, gate, targetRow, cCol)
          ) {
            return { capturedBlockId: b.id, gateIndex: i };
          }
        }
      } else {
        const targetCol = gate.edge === 'LEFT' ? edgeLine : edgeLine - (shape.cols - 1);
        if (Math.abs(b.x - targetCol) > 0.18) continue;

        const minRow = gate.spanStart;
        const maxRow = gate.spanStart + gate.spanLength - shape.rows;
        if (maxRow < minRow) continue;
        if (b.y < minRow - 0.45 || b.y > maxRow + 0.45) continue;

        if ((b.y < minRow - 0.25 || b.y > maxRow + 0.25) && dot < 0.03 && pullDot < 0.12) {
          continue;
        }

        const candRows = [
          Math.max(minRow, Math.min(maxRow, Math.round(b.y))),
          Math.max(minRow, Math.min(maxRow, Math.floor(b.y))),
          Math.max(minRow, Math.min(maxRow, Math.ceil(b.y))),
        ];
        for (const cRow of candRows) {
          if (
            canGroupOccupyOffset(board, group, cRow - b.row, targetCol - b.col) &&
            checkBlockGateClearance(board, b, gate, cRow, targetCol)
          ) {
            return { capturedBlockId: b.id, gateIndex: i };
          }
        }
      }
    }
  }

  return null;
}

export interface ClearCascadeResult {
  clearedBlockIds: number[];
  peeledBlockIds: number[];
  spawnedBlockIds: number[];
  destroyedCrateIds: number[];
  unlockedBarrierIds: number[];
}

/**
 * Executes the deterministic 3-step Synchronous Fixed-Point Clear Cascade (`resolveClearCascade`)
 * when `initialBlock` exits through `initialGateIndex`.
 */
export function resolveClearCascade(
  board: BoardState,
  initialBlock: BlockState,
  initialGateIndex: number,
  movedGroupIds?: ReadonlySet<number>
): ClearCascadeResult {
  const result: ClearCascadeResult = {
    clearedBlockIds: [],
    peeledBlockIds: [],
    spawnedBlockIds: [],
    destroyedCrateIds: [],
    unlockedBarrierIds: [],
  };

  const closedBarrierIdsBefore = new Set<number>();
  for (const bar of board.barriers ?? []) {
    if (!bar.open) closedBarrierIdsBefore.add(bar.id);
  }

  const pendingQueue: Array<{ block: BlockState; gateIndex: number }> = [
    { block: initialBlock, gateIndex: initialGateIndex },
  ];

  let safetyCounter = 0;
  while (pendingQueue.length > 0 && safetyCounter < 64) {
    safetyCounter++;
    const { block, gateIndex } = pendingQueue.shift()!;
    if (block.status !== 'ACTIVE') continue;

    const gate = gateIndex >= 0 ? board.gates[gateIndex] : undefined;
    const shape = getShape(block.shapeId);
    const clearedFootprint: Array<[number, number]> = shape.cells.map(([dr, dc]) => [
      block.row + dr,
      block.col + dc,
    ]);

    // Step 1A: Trigger any carrier items (Key, Scissors, Shutter Gem)
    triggerCarrierItems(board, block);

    // Step 1B: Multi-layer peel vs. Full block shred
    board.sessionBlocksShredded++;
    if (block.colorCursor + 1 < block.colorStack.length) {
      block.colorCursor++;
      block.shredGateIndex = gateIndex;
      block.reboundTimerMs = 200;
      if (block.bombMax > 0 && block.bombCount > 0) {
        block.bombCount += 2;
      }
      detachBlockFromGluedGroup(board, block);
      result.peeledBlockIds.push(block.id);
    } else {
      block.status = 'CLEARED';
      block.shredGateIndex = gateIndex;
      block.shredProgress = 1;
      detachBlockFromGluedGroup(board, block);
      result.clearedBlockIds.push(block.id);
    }

    // Step 1C: Global Ice thaw (blocks & gates in unlocked rooms)
    for (const b of board.blocks) {
      if (b.status === 'ACTIVE' && b.id !== block.id && b.iceCount > 0 && !isBlockInLockedRoom(board, b)) {
        b.iceCount = Math.max(0, b.iceCount - 1);
      }
    }
    for (const g of board.gates) {
      if (g.iceCount > 0 && !isGateInLockedRoom(board, g)) {
        g.iceCount = Math.max(0, g.iceCount - 1);
      }
    }

    // Step 1D: Damage orthogonally adjacent Wooden Crates
    for (const crate of board.crates) {
      if (crate.destroyed || crate.hp <= 0) continue;
      let adjacent = false;
      for (const [cr, cc] of clearedFootprint) {
        if (Math.abs(crate.row - cr) + Math.abs(crate.col - cc) === 1) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) {
        crate.hp--;
        if (crate.hp <= 0) {
          crate.destroyed = true;
          result.destroyedCrateIds.push(crate.id);
        }
      }
    }

    // Step 1E: Gate state transitions
    stepDynamicGatesOnShred(board, gate);

    rebuildOccupancyGrid(board);

    // Step 2A: Moving Elevators (in already-unlocked rooms)
    stepMovingElevators(board);

    // Step 2B: Block Generators countdown (in already-unlocked rooms)
    for (const gen of board.generators) {
      const genRoom =
        board.roomMap && gen.row >= 0 && gen.row < board.rows && gen.col >= 0 && gen.col < board.cols
          ? board.roomMap[gen.row * board.cols + gen.col]
          : 0;
      if (!isRoomUnlocked(board, genRoom)) continue;
      if (gen.state === 'COUNTING') {
        gen.cooldown = Math.max(0, gen.cooldown - 1);
        if (gen.cooldown === 0) {
          gen.state = 'READY_TO_SPAWN';
        }
      }
    }

    // Step 2C: Multi-Room Portcullis countdown/unlock & Ready Generator Spawning
    stepPortcullisBarriersOnShred(board);
    for (const bar of board.barriers ?? []) {
      if (bar.open && closedBarrierIdsBefore.has(bar.id)) {
        closedBarrierIdsBefore.delete(bar.id);
        result.unlockedBarrierIds.push(bar.id);
      }
    }
    rebuildOccupancyGrid(board);

    const newlySpawned = trySpawnReadyGenerators(board);
    for (const sb of newlySpawned) {
      result.spawnedBlockIds.push(sb.id);
    }

    // Step 3: Fixed-Point Auto-Advance & Secondary Clear Check
    let fixedPointChanged = true;
    let innerIter = 0;
    while (fixedPointChanged && innerIter < 16) {
      innerIter++;
      fixedPointChanged = false;

      if (autoAdvanceColorQueues(board)) {
        fixedPointChanged = true;
      }

      const moreSpawned = trySpawnReadyGenerators(board);
      if (moreSpawned.length > 0) {
        for (const sb of moreSpawned) result.spawnedBlockIds.push(sb.id);
        fixedPointChanged = true;
      }

      // Check if an actively involved block (the peeled block itself, a glued partner moved in this
      // exact drag gesture, or a newly spawned generator block on a gate lip) is now eligible to clear (`F-02`, `MECH-11`).
      // Unmoved stationary blocks elsewhere on the board must NEVER auto-shred without being dragged.
      const allowedCascadeIds = new Set<number>([
        initialBlock.id,
        ...(movedGroupIds ?? []),
        ...result.spawnedBlockIds,
      ]);
      for (const candidate of board.blocks) {
        if (candidate.status !== 'ACTIVE') continue;
        if (!allowedCascadeIds.has(candidate.id)) continue;
        const gIdx = findEligibleGateForBlockAt(board, candidate, candidate.row, candidate.col);
        if (gIdx >= 0 && !pendingQueue.some((p) => p.block.id === candidate.id)) {
          pendingQueue.push({ block: candidate, gateIndex: gIdx });
          break;
        }
      }
    }
  }

  return result;
}
