import {
  getMovedGroupBlocks,
  getPlayableEdgeSpanBounds,
  isBlockInLockedRoom,
  isGateInLockedRoom,
  isRoomUnlocked,
  rebuildOccupancyGrid,
} from './physics';
import { getActiveColor, getLayersRemaining, getShape } from './polyomino';
import type { BlockState, BoardState, ColorId, EdgeDir, GateState } from './types';

export function getGateActiveColor(gate: GateState): ColorId {
  const idx = Math.min(gate.colorCursor, gate.colorQueue.length - 1);
  return gate.colorQueue[idx] ?? 1;
}

export function getGateOutwardNormal(edge: EdgeDir): readonly [number, number] {
  switch (edge) {
    case 'TOP':
      return [0, -1];
    case 'BOTTOM':
      return [0, 1];
    case 'LEFT':
      return [-1, 0];
    case 'RIGHT':
      return [1, 0];
  }
}

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
      if (
        resRank < bestResourceRank ||
        (resRank === bestResourceRank && edgeOrder < bestEdgeOrder)
      ) {
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
 * within `0.15` cells of an integer alignment AND has a positive motion component toward
 * the gate's outward normal (or is axis-locked moving tangentially into an aligned gate),
 * preventing accidental perpendicular walk-by suction.
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
    const nearCol = Math.round(b.x);
    const nearRow = Math.round(b.y);
    if (Math.abs(b.x - nearCol) > 0.15 || Math.abs(b.y - nearRow) > 0.15) {
      continue;
    }

    for (let i = 0; i < board.gates.length; i++) {
      const gate = board.gates[i];
      if (!checkBlockGateClearance(board, b, gate, nearRow, nearCol)) {
        continue;
      }
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const dot = stepVecX * nx + stepVecY * ny;
      const pullDot = rawPullX * nx + rawPullY * ny;
      if (dot > 1e-4 || pullDot >= 0.12) {
        return { capturedBlockId: b.id, gateIndex: i };
      }
    }
  }

  return null;
}

/**
 * Triggers carrier items (`hasKey`, `scissorColor`, `shutterGemColor`) on a block when it
 * clears or is destroyed by a booster (Zero-Softlock Law).
 */
export function triggerCarrierItems(board: BoardState, block: BlockState): void {
  // 1. Key -> unlocks matching Chained blocks AND/OR Key-Sealed Portcullis Barriers (`lockId`)
  // Prioritizes Chained blocks in currently unlocked rooms (`MECH-18`).
  if (block.hasKey > 0) {
    const keyId = block.hasKey;
    block.hasKey = 0;
    let unlockedAny = false;

    if (board.barriers) {
      for (const bar of board.barriers) {
        if (!bar.open && bar.lockId === keyId) {
          bar.lockId = 0;
          bar.shredsRemaining = 0;
          bar.open = true;
          unlockedAny = true;
        }
      }
    }

    // First pass: unlocked rooms with matching lockId
    for (const other of board.blocks) {
      if (
        other.status === 'ACTIVE' &&
        other.chained &&
        !isBlockInLockedRoom(board, other) &&
        (other.lockId === keyId || other.lockId === 0)
      ) {
        other.chained = false;
        unlockedAny = true;
        break;
      }
    }
    // Second pass: locked rooms with matching lockId (if no unlocked room block matched)
    if (!unlockedAny) {
      for (const other of board.blocks) {
        if (
          other.status === 'ACTIVE' &&
          other.chained &&
          (other.lockId === keyId || other.lockId === 0)
        ) {
          other.chained = false;
          unlockedAny = true;
          break;
        }
      }
    }
    if (!unlockedAny) {
      if (board.barriers) {
        for (const bar of board.barriers) {
          if (!bar.open && bar.lockId > 0) {
            bar.lockId = 0;
            bar.shredsRemaining = 0;
            bar.open = true;
            unlockedAny = true;
            break;
          }
        }
      }
      if (!unlockedAny) {
        for (const other of board.blocks) {
          if (other.status === 'ACTIVE' && other.chained && !isBlockInLockedRoom(board, other)) {
            other.chained = false;
            unlockedAny = true;
            break;
          }
        }
      }
      if (!unlockedAny) {
        for (const other of board.blocks) {
          if (other.status === 'ACTIVE' && other.chained) {
            other.chained = false;
            break;
          }
        }
      }
    }
  }

  // 2. Colored Scissors -> cuts all Colored Ropes of matching color in unlocked rooms (with fallback)
  if (block.scissorColor > 0) {
    const cutColor = block.scissorColor;
    block.scissorColor = 0;
    let cutUnlocked = false;
    for (const other of board.blocks) {
      if (
        other.status === 'ACTIVE' &&
        other.ropeColor === cutColor &&
        !isBlockInLockedRoom(board, other)
      ) {
        other.ropeColor = 0;
        cutUnlocked = true;
      }
    }
    if (!cutUnlocked) {
      for (const other of board.blocks) {
        if (other.status === 'ACTIVE' && other.ropeColor === cutColor) {
          other.ropeColor = 0;
        }
      }
    }
  }

  // 3. Shutter Gem -> unlocks all Locked Shutter Gates of matching gem color in unlocked rooms (with fallback)
  if (block.shutterGemColor > 0) {
    const gemColor = block.shutterGemColor;
    block.shutterGemColor = 0;
    let openedUnlocked = false;
    for (const gate of board.gates) {
      if (gate.shutterLockColor === gemColor && !isGateInLockedRoom(board, gate)) {
        gate.shutterLockColor = 0;
        gate.shutterOpen = true;
        openedUnlocked = true;
      }
    }
    if (!openedUnlocked) {
      for (const gate of board.gates) {
        if (gate.shutterLockColor === gemColor) {
          gate.shutterLockColor = 0;
          gate.shutterOpen = true;
        }
      }
    }
  }
}

/**
 * Universal Supply-vs-Queue Color-Changing Gate Auto-Advance (F-08):
 * Computes the remaining supply S(c) of each ColorId across all active blocks and generator queues.
 * If any Color-Changing Gate's current front color has S(c) === 0 (or if more multi-queue gates
 * currently demand c than remaining supply S(c)), advances `gate.colorCursor` so no gate ever
 * deadlocks waiting for an exhausted color.
 */
export function autoAdvanceColorQueues(board: BoardState): boolean {
  let advancedAny = false;

  for (let pass = 0; pass < 8; pass++) {
    const supply = new Int32Array(10);

    for (const b of board.blocks) {
      if (b.status !== 'ACTIVE') continue;
      for (let i = b.colorCursor; i < b.colorStack.length; i++) {
        const c = b.colorStack[i];
        if (c > 0 && c <= 9) supply[c]++;
      }
    }

    for (const gen of board.generators) {
      if (gen.state === 'DEPLETED') continue;
      for (let q = gen.queueCursor; q < gen.queue.length; q++) {
        const spec = gen.queue[q];
        for (const c of spec.colorStack) {
          if (c > 0 && c <= 9) supply[c]++;
        }
      }
    }

    let passChanged = false;

    // Advance any unlocked-room gate whose current front color has 0 remaining supply on board + generators (`MECH-12`, `MECH-18`)
    for (const gate of board.gates) {
      if (isGateInLockedRoom(board, gate)) continue;
      while (gate.colorCursor + 1 < gate.colorQueue.length) {
        const frontColor = getGateActiveColor(gate);
        if (supply[frontColor] === 0) {
          gate.colorCursor++;
          passChanged = true;
          advancedAny = true;
        } else {
          break;
        }
      }
    }

    if (!passChanged) break;
  }

  return advancedAny;
}

/**
 * Attempts to spawn blocks from any generators in the `READY_TO_SPAWN` state (`F-06`).
 */
export function trySpawnReadyGenerators(board: BoardState): BlockState[] {
  const spawned: BlockState[] = [];
  const { rows, cols, occupancy } = board;

  for (const gen of board.generators) {
    if (gen.state !== 'READY_TO_SPAWN') continue;
    const genRoom =
      board.roomMap && gen.row >= 0 && gen.row < rows && gen.col >= 0 && gen.col < cols
        ? board.roomMap[gen.row * cols + gen.col]
        : 0;
    if (!isRoomUnlocked(board, genRoom)) continue;
    if (gen.queueCursor >= gen.queue.length) {
      gen.state = 'DEPLETED';
      continue;
    }

    const spec = gen.queue[gen.queueCursor];
    const shape = getShape(spec.shapeId);

    let canFit = true;
    for (const [dr, dc] of shape.cells) {
      const r = gen.spawnRow + dr;
      const c = gen.spawnCol + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols || occupancy[r * cols + c] !== 0) {
        canFit = false;
        break;
      }
    }

    if (canFit) {
      const newBlock: BlockState = {
        id: board.nextDynamicBlockId++,
        shapeId: spec.shapeId,
        row: gen.spawnRow,
        col: gen.spawnCol,
        x: gen.spawnCol,
        y: gen.spawnRow,
        liftAlpha: 0,
        colorStack: [...spec.colorStack],
        colorCursor: 0,
        axisLock: spec.axisLock ?? 'NONE',
        iceCount: 0,
        isStar: spec.isStar ?? false,
        chained: false,
        lockId: 0,
        hasKey: spec.hasKey ?? 0,
        bombCount: 0,
        bombMax: 0,
        groupId: 0,
        ropeColor: 0,
        scissorColor: spec.scissorColor ?? 0,
        shutterGemColor: spec.shutterGemColor ?? 0,
        status: 'ACTIVE',
        shredGateIndex: -1,
        shredProgress: 0,
        reboundTimerMs: 0,
      };

      board.blocks.push(newBlock);
      spawned.push(newBlock);
      gen.queueCursor++;
      if (gen.queueCursor >= gen.queue.length) {
        gen.state = 'DEPLETED';
        gen.cooldown = 0;
      } else {
        gen.state = 'COUNTING';
        gen.cooldown = gen.maxCooldown;
      }
      rebuildOccupancyGrid(board);
    }
  }

  return spawned;
}

function areBlocksOrthogonallyAdjacent(a: BlockState, b: BlockState): boolean {
  const shapeA = getShape(a.shapeId);
  const shapeB = getShape(b.shapeId);
  for (const [drA, dcA] of shapeA.cells) {
    const rA = a.row + drA;
    const cA = a.col + dcA;
    for (const [drB, dcB] of shapeB.cells) {
      const rB = b.row + drB;
      const cB = b.col + dcB;
      if (Math.abs(rA - rB) + Math.abs(cA - cB) === 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detaches `block` from its glued group (`groupId > 0`) when it peels a layer or clears,
 * and recomputes 4-connected orthogonal adjacency components for any remaining siblings.
 */
export function detachBlockFromGluedGroup(board: BoardState, block: BlockState): void {
  if (block.groupId <= 0) return;
  const oldGroupId = block.groupId;
  block.groupId = 0;

  const remaining = board.blocks.filter(
    (b) => b.status === 'ACTIVE' && b.id !== block.id && b.groupId === oldGroupId
  );
  if (remaining.length === 0) return;
  if (remaining.length === 1) {
    remaining[0].groupId = 0;
    return;
  }

  let nextGroupId = board.blocks.reduce((max, b) => Math.max(max, b.groupId), 0) + 1;
  const visited = new Set<number>();
  let usedOldGroupId = false;

  for (const seed of remaining) {
    if (visited.has(seed.id)) continue;
    const comp: BlockState[] = [seed];
    visited.add(seed.id);
    let head = 0;
    while (head < comp.length) {
      const cur = comp[head++];
      for (const other of remaining) {
        if (visited.has(other.id)) continue;
        if (areBlocksOrthogonallyAdjacent(cur, other)) {
          visited.add(other.id);
          comp.push(other);
        }
      }
    }

    if (comp.length === 1) {
      comp[0].groupId = 0;
    } else {
      const assignedGroupId = !usedOldGroupId ? oldGroupId : nextGroupId++;
      usedOldGroupId = true;
      for (const member of comp) {
        member.groupId = assignedGroupId;
      }
    }
  }
}

/**
 * Steps all Portcullis Barriers (`board.barriers`) on every block/layer shred:
 * - Decrements `shredsRemaining` on closed barriers
 * - Opens any barrier whose `shredsRemaining <= 0` and `lockId === 0`
 * - Enforces Zero-Softlock Law: if the remaining shreddable layers in currently unlocked rooms
 *   (plus unlocked generators) are fewer than `shredsRemaining` (or if a required key is no
 *   longer available in unlocked rooms), clamps `shredsRemaining` and auto-opens when `0`.
 */
export function stepPortcullisBarriersOnShred(board: BoardState): number[] {
  if (!board.barriers || board.barriers.length === 0) return [];

  const openedIds: number[] = [];

  for (const bar of board.barriers) {
    if (bar.open) continue;
    if (bar.shredsRemaining > 0) {
      bar.shredsRemaining = Math.max(0, bar.shredsRemaining - 1);
    }
    if (bar.shredsRemaining <= 0 && bar.lockId === 0) {
      bar.open = true;
      openedIds.push(bar.id);
    }
  }

  // Zero-Softlock Law for Multi-Room Portcullises:
  for (let pass = 0; pass < 4; pass++) {
    let unlockedLayers = 0;
    const availableKeys = new Set<number>();

    for (const b of board.blocks) {
      if (b.status !== 'ACTIVE') continue;
      if (isBlockInLockedRoom(board, b)) continue;
      const activeColor = getActiveColor(b.colorStack, b.colorCursor);
      if (activeColor !== 0) {
        unlockedLayers += getLayersRemaining(b.colorStack, b.colorCursor);
      }
      if (b.hasKey > 0) {
        availableKeys.add(b.hasKey);
      }
    }

    for (const gen of board.generators) {
      if (gen.state === 'DEPLETED') continue;
      const genRoom =
        board.roomMap && gen.row >= 0 && gen.row < board.rows && gen.col >= 0 && gen.col < board.cols
          ? board.roomMap[gen.row * board.cols + gen.col]
          : 0;
      if (!isRoomUnlocked(board, genRoom)) continue;
      for (let q = gen.queueCursor; q < gen.queue.length; q++) {
        const spec = gen.queue[q];
        unlockedLayers += spec.colorStack.length;
        if (spec.hasKey && spec.hasKey > 0) {
          availableKeys.add(spec.hasKey);
        }
      }
    }

    let passOpened = false;
    for (const bar of board.barriers) {
      if (bar.open) continue;
      if (bar.lockId > 0 && !availableKeys.has(bar.lockId)) {
        bar.lockId = 0;
      }
      if (bar.shredsRemaining > unlockedLayers) {
        bar.shredsRemaining = unlockedLayers;
      }
      if (bar.shredsRemaining <= 0 && bar.lockId === 0) {
        bar.open = true;
        openedIds.push(bar.id);
        passOpened = true;
      }
    }
    if (!passOpened) break;
  }

  if (openedIds.length > 0) {
    rebuildOccupancyGrid(board);
  }

  return openedIds;
}

/**
 * Globally steps dynamic gates on every block/layer shred:
 * - Advances `exitedGate.colorCursor` ONLY on `exitedGate`
 * - Flips all unlocked toggling shutter gates (`g.togglesOnClear && g.shutterLockColor === 0`)
 * - Steps all sliding gates (`g.slidesOnClear`)
 * - Steps all size-changing gates (`g.sizeChangesOnClear`)
 */
export function stepDynamicGatesOnShred(board: BoardState, exitedGate?: GateState): void {
  if (exitedGate && exitedGate.colorCursor + 1 < exitedGate.colorQueue.length) {
    exitedGate.colorCursor++;
  }

  for (const g of board.gates) {
    if (isGateInLockedRoom(board, g)) continue;
    const edgeLine =
      g.edgeLine ??
      (g.edge === 'TOP' || g.edge === 'LEFT'
        ? 0
        : g.edge === 'BOTTOM'
          ? board.rows - 1
          : board.cols - 1);
    const { minSpan, maxSpanEnd } = getPlayableEdgeSpanBounds(
      board.rows,
      board.cols,
      board.occupancy,
      g.edge,
      edgeLine,
      g.spanStart,
      g.spanLength
    );
    const playableLimit = Math.max(1, maxSpanEnd - minSpan);

    if (g.togglesOnClear && g.shutterLockColor === 0) {
      g.shutterOpen = !g.shutterOpen;
    }
    if (g.sizeChangesOnClear) {
      const effectiveMaxLen = Math.min(g.maxLength, playableLimit);
      let nextLen = g.spanLength + g.sizeDir;
      if (nextLen < g.minLength || nextLen > effectiveMaxLen) {
        g.sizeDir = (g.sizeDir * -1) as 1 | -1;
        nextLen = Math.max(g.minLength, Math.min(effectiveMaxLen, g.spanLength + g.sizeDir));
      }
      g.spanLength = nextLen;
      if (g.spanStart < minSpan) {
        g.spanStart = minSpan;
      }
      if (g.spanStart + g.spanLength > maxSpanEnd) {
        g.spanStart = Math.max(minSpan, maxSpanEnd - g.spanLength);
      }
    }
    if (g.slidesOnClear) {
      const clampSlideMin = Math.max(minSpan, g.slideMin);
      const clampSlideMax = Math.max(
        clampSlideMin,
        Math.min(g.slideMax, maxSpanEnd - g.spanLength)
      );
      let nextStart = g.spanStart + g.slideDir;
      if (nextStart < clampSlideMin || nextStart > clampSlideMax) {
        g.slideDir = (g.slideDir * -1) as 1 | -1;
        nextStart = Math.max(
          clampSlideMin,
          Math.min(clampSlideMax, g.spanStart + g.slideDir)
        );
      }
      g.spanStart = nextStart;
    }
  }

  // Anti-Softlock Parity & Span Guards (`DRAG-06`):
  // If any active movable non-stone blocks remain and zero currently open/sized gates can accept any
  // movable block solely because all matching toggling shutters are closed or resizing gates are too narrow,
  // auto-recover the dynamic gate state so the final blocks can never be parity-deadlocked.
  const activeMovableNonStone = board.blocks.filter(
    (b) =>
      b.status === 'ACTIVE' &&
      getActiveColor(b.colorStack, b.colorCursor) !== 0 &&
      b.iceCount === 0 &&
      !b.chained &&
      b.ropeColor === 0 &&
      !isBlockInLockedRoom(board, b)
  );
  if (activeMovableNonStone.length > 0) {
    const anyOpenGateMatchesBlock = board.gates.some((g) => {
      if (isGateInLockedRoom(board, g)) return false;
      if (!g.shutterOpen || g.shutterLockColor > 0 || g.iceCount > 0) return false;
      const gColor = getGateActiveColor(g);
      const isHoriz = g.edge === 'TOP' || g.edge === 'BOTTOM';
      return activeMovableNonStone.some((b) => {
        if (getActiveColor(b.colorStack, b.colorCursor) !== gColor) return false;
        const sh = getShape(b.shapeId);
        const reqSpan = isHoriz ? sh.cols : sh.rows;
        return reqSpan <= g.spanLength;
      });
    });

    if (!anyOpenGateMatchesBlock) {
      for (const g of board.gates) {
        if (isGateInLockedRoom(board, g)) continue;
        if (g.togglesOnClear && !g.shutterOpen && g.shutterLockColor === 0) {
          g.shutterOpen = true;
        }
        if (g.sizeChangesOnClear) {
          const gColor = getGateActiveColor(g);
          const isHoriz = g.edge === 'TOP' || g.edge === 'BOTTOM';
          const edgeLine =
            g.edgeLine ??
            (g.edge === 'TOP' || g.edge === 'LEFT'
              ? 0
              : g.edge === 'BOTTOM'
                ? board.rows - 1
                : board.cols - 1);
          const { minSpan, maxSpanEnd } = getPlayableEdgeSpanBounds(
            board.rows,
            board.cols,
            board.occupancy,
            g.edge,
            edgeLine,
            g.spanStart,
            g.spanLength
          );
          const playableLimit = Math.max(1, maxSpanEnd - minSpan);
          const effectiveMaxLen = Math.min(g.maxLength, playableLimit);
          for (const b of activeMovableNonStone) {
            if (getActiveColor(b.colorStack, b.colorCursor) === gColor) {
              const sh = getShape(b.shapeId);
              const reqSpan = isHoriz ? sh.cols : sh.rows;
              if (reqSpan > g.spanLength && reqSpan <= effectiveMaxLen) {
                g.spanLength = reqSpan;
                if (g.spanStart < minSpan) {
                  g.spanStart = minSpan;
                }
                if (g.spanStart + g.spanLength > maxSpanEnd) {
                  g.spanStart = Math.max(minSpan, maxSpanEnd - g.spanLength);
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Steps all Moving Elevators (`F-05` Rigid-Containment Rule):
 * A block is carried by an elevator if and only if 100% of its constituent cells lie inside
 * the elevator platform's current footprint, it is not immobilized/axis-blocked, its entire
 * glued group is contained, and its shifted footprint respects `board.floorColor`.
 */
export function stepMovingElevators(board: BoardState): void {
  const { rows, cols, occupancy, floorColor } = board;

  for (const elev of board.elevators) {
    const elevRoomId =
      board.roomMap && elev.row >= 0 && elev.row < rows && elev.col >= 0 && elev.col < cols
        ? board.roomMap[elev.row * cols + elev.col]
        : 0;
    if (elevRoomId > 0 && !isRoomUnlocked(board, elevRoomId)) continue;

    const dir = elev.atAlternatePos ? -1 : 1;
    const dRow = elev.deltaRow * dir;
    const dCol = elev.deltaCol * dir;
    if (dRow === 0 && dCol === 0) continue;

    const minR = elev.row;
    const maxR = elev.row + elev.height - 1;
    const minC = elev.col;
    const maxC = elev.col + elev.width - 1;

    // Find all ACTIVE blocks that are 100% contained within [minR..maxR, minC..maxC]
    const passengers: BlockState[] = [];
    const passengerIds = new Set<number>();
    let partialOverlap = false;

    for (const b of board.blocks) {
      if (b.status !== 'ACTIVE') continue;
      const shape = getShape(b.shapeId);
      let insideCount = 0;
      for (const [dr, dc] of shape.cells) {
        const r = b.row + dr;
        const c = b.col + dc;
        if (r >= minR && r <= maxR && c >= minC && c <= maxC) {
          insideCount++;
        }
      }
      if (insideCount > 0) {
        const lockedOnElevator =
          b.iceCount > 0 ||
          b.chained ||
          b.ropeColor > 0 ||
          isBlockInLockedRoom(board, b) ||
          (dRow !== 0 && b.axisLock === 'H') ||
          (dCol !== 0 && b.axisLock === 'V');

        if (insideCount < shape.cells.length || lockedOnElevator) {
          // A block straddling the elevator boundary or locked in place jams the elevator
          partialOverlap = true;
          break;
        }
        passengers.push(b);
        passengerIds.add(b.id);
      }
    }

    if (partialOverlap) continue;

    // Never shear a glued group in half: if any passenger has an active sibling outside, jam
    for (const p of passengers) {
      if (p.groupId > 0) {
        const hasOutsideSibling = board.blocks.some(
          (other) =>
            other.status === 'ACTIVE' &&
            other.groupId === p.groupId &&
            !passengerIds.has(other.id)
        );
        if (hasOutsideSibling) {
          partialOverlap = true;
          break;
        }
      }
    }

    if (partialOverlap) continue;

    // Verify target footprint [minR+dRow .. maxR+dRow, minC+dCol .. maxC+dCol] is clear of non-passengers
    let targetClear = true;
    for (let r = minR + dRow; r <= maxR + dRow; r++) {
      for (let c = minC + dCol; c <= maxC + dCol; c++) {
        if (r < 0 || r >= rows || c < 0 || c >= cols) {
          targetClear = false;
          break;
        }
        const occ = occupancy[r * cols + c];
        if (occ !== 0 && !passengerIds.has(occ)) {
          targetClear = false;
          break;
        }
      }
      if (!targetClear) break;
    }

    if (!targetClear) continue;

    // Verify every passenger's shifted footprint is compatible with floorColor
    for (const p of passengers) {
      const pShape = getShape(p.shapeId);
      const pColor = getActiveColor(p.colorStack, p.colorCursor);
      for (const [dr, dc] of pShape.cells) {
        const nr = p.row + dRow + dr;
        const nc = p.col + dCol + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
          targetClear = false;
          break;
        }
        const fc = floorColor[nr * cols + nc];
        if (fc !== 0 && fc !== pColor) {
          targetClear = false;
          break;
        }
      }
      if (!targetClear) break;
    }

    if (!targetClear) continue;

    // Shift elevator and all fully contained passenger blocks
    elev.row += dRow;
    elev.col += dCol;
    elev.atAlternatePos = !elev.atAlternatePos;

    for (const p of passengers) {
      p.row += dRow;
      p.col += dCol;
      p.x = p.col;
      p.y = p.row;
    }

    rebuildOccupancyGrid(board);
  }
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
      if (
        b.status === 'ACTIVE' &&
        b.id !== block.id &&
        b.iceCount > 0 &&
        !isBlockInLockedRoom(board, b)
      ) {
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
