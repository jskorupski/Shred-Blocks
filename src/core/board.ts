import {
  autoAdvanceColorQueues,
  detachBlockFromGluedGroup,
  findEligibleGateForBlockAt,
  resolveClearCascade,
  stepDynamicGatesOnShred,
  stepMovingElevators,
  stepPortcullisBarriersOnShred,
  triggerCarrierItems,
  trySpawnReadyGenerators,
} from './gate-clearance';
import {
  canGroupOccupyOffset,
  getMovedGroupBlocks,
  getReachableAnchors,
  isBlockInLockedRoom,
  isBlockMovable,
  isGateInLockedRoom,
  isRoomUnlocked,
  rebuildOccupancyGrid,
} from './physics';
import { getActiveColor, getShape } from './polyomino';
import type { BlockState, BoardState, ColorId, PlayMode, RocketAxis } from './types';

export * from './board-state';

export interface CommitMoveOutcome {
  moved: boolean;
  clearedGateIndex: number;
  clearedBlockIds: number[];
  peeledBlockIds: number[];
  spawnedBlockIds: number[];
  unlockedBarrierIds: number[];
}

/**
 * Commits a discrete move of `blockId` (and its glued group) to `(targetRow, targetCol)`.
 * Evaluates gate clearance for all moved blocks, runs `resolveClearCascade`, increments
 * `movesCommitted`, and ticks Bomb countdowns in `ZEN` mode.
 */
export function commitBlockMove(
  board: BoardState,
  blockId: number,
  targetRow: number,
  targetCol: number,
  playMode: PlayMode,
  velX = 0,
  velY = 0
): CommitMoveOutcome {
  const group = getMovedGroupBlocks(board, blockId);
  if (group.length === 0 || !isBlockMovable(board, blockId)) {
    return {
      moved: false,
      clearedGateIndex: -1,
      clearedBlockIds: [],
      peeledBlockIds: [],
      spawnedBlockIds: [],
      unlockedBarrierIds: [],
    };
  }

  const lead = group.find((b) => b.id === blockId) ?? group[0];
  const dRow = targetRow - lead.row;
  const dCol = targetCol - lead.col;

  if (!canGroupOccupyOffset(board, group, dRow, dCol)) {
    return {
      moved: false,
      clearedGateIndex: -1,
      clearedBlockIds: [],
      peeledBlockIds: [],
      spawnedBlockIds: [],
      unlockedBarrierIds: [],
    };
  }

  if (dRow !== 0 || dCol !== 0) {
    const reachable = getReachableAnchors(board, lead.id);
    if (!reachable.some((a) => a.row === targetRow && a.col === targetCol)) {
      return {
        moved: false,
        clearedGateIndex: -1,
        clearedBlockIds: [],
        peeledBlockIds: [],
        spawnedBlockIds: [],
        unlockedBarrierIds: [],
      };
    }
  }

  for (const b of group) {
    b.row += dRow;
    b.col += dCol;
    b.x = b.col;
    b.y = b.row;
  }

  rebuildOccupancyGrid(board);

  // Check if any member of the moved group now satisfies Gate Clearance
  let clearedGateIndex = -1;
  const clearedBlockIds: number[] = [];
  const peeledBlockIds: number[] = [];
  const spawnedBlockIds: number[] = [];
  const unlockedBarrierIds: number[] = [];
  const movedGroupIds = new Set<number>(group.map((b) => b.id));

  for (const b of group) {
    if (b.status !== 'ACTIVE') continue;
    const gIdx = findEligibleGateForBlockAt(board, b, b.row, b.col, velX, velY);
    if (gIdx >= 0) {
      clearedGateIndex = gIdx;
      const cascade = resolveClearCascade(board, b, gIdx, movedGroupIds);
      clearedBlockIds.push(...cascade.clearedBlockIds);
      peeledBlockIds.push(...cascade.peeledBlockIds);
      spawnedBlockIds.push(...cascade.spawnedBlockIds);
      unlockedBarrierIds.push(...cascade.unlockedBarrierIds);
    }
  }

  const didMoveOrClear = dRow !== 0 || dCol !== 0 || clearedBlockIds.length > 0 || peeledBlockIds.length > 0;

  if (didMoveOrClear) {
    board.movesCommitted++;
    board.timerRunning = true;
    board.hintMove = null;

    // In ZEN mode, Bomb counters decrement by 1 per committed move (only in unlocked rooms)
    if (playMode === 'ZEN' && board.freezeRemainingSec <= 0) {
      for (const b of board.blocks) {
        if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount > 0 && !isBlockInLockedRoom(board, b)) {
          b.bombCount = Math.max(0, b.bombCount - 1);
        }
      }
    }
  } else {
    // Restore exact coordinates for all group members if nothing changed
    for (const b of group) {
      b.row -= dRow;
      b.col -= dCol;
      b.x = b.col;
      b.y = b.row;
    }
    rebuildOccupancyGrid(board);
  }

  return {
    moved: didMoveOrClear,
    clearedGateIndex,
    clearedBlockIds,
    peeledBlockIds,
    spawnedBlockIds,
    unlockedBarrierIds,
  };
}

/**
 * Helper used by boosters to destroy or peel a single block while strictly enforcing
 * the Zero-Softlock Law and full Clear Cascade side effects (`C1-03`).
 */
function destroyOrPeelBlockByBooster(board: BoardState, block: BlockState): void {
  if (block.status !== 'ACTIVE') return;

  const shape = getShape(block.shapeId);
  const clearedFootprint: Array<[number, number]> = shape.cells.map(([dr, dc]) => [
    block.row + dr,
    block.col + dc,
  ]);

  // Zero-Softlock Law: always trigger Key, Scissors, and Shutter Gem when hit by a booster
  triggerCarrierItems(board, block);

  // If frozen, chained, or roped, clear the restriction or peel outer layer
  if (block.iceCount > 0) block.iceCount = 0;
  if (block.chained) block.chained = false;
  if (block.ropeColor > 0) block.ropeColor = 0;

  board.sessionBlocksShredded++;
  if (block.colorCursor + 1 < block.colorStack.length) {
    block.colorCursor++;
    if (block.bombMax > 0 && block.bombCount > 0) {
      block.bombCount += 2;
    }
    detachBlockFromGluedGroup(board, block);
  } else {
    block.status = 'CLEARED';
    block.shredProgress = 1;
    detachBlockFromGluedGroup(board, block);
  }

  // Global Ice thaw (blocks & gates in unlocked rooms)
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

  // Damage orthogonally adjacent Wooden Crates
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
      }
    }
  }

  stepDynamicGatesOnShred(board, undefined);
  stepPortcullisBarriersOnShred(board);
  rebuildOccupancyGrid(board);
  stepMovingElevators(board);

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

  const spawned = trySpawnReadyGenerators(board);
  autoAdvanceColorQueues(board);
  for (const sb of spawned) {
    if (sb.status !== 'ACTIVE') continue;
    const gIdx = findEligibleGateForBlockAt(board, sb, sb.row, sb.col);
    if (gIdx >= 0) {
      resolveClearCascade(board, sb, gIdx, new Set([sb.id]));
    }
  }
}

/**
 * Booster 3: Hammer (`🔨`) — Smashes 1 tapped block (including Stone blocks, or peels outer layer),
 * destroys 1 Wooden Crate, shatters a closed Portcullis Barrier, or shatters an Iced / Locked
 * Shutter Gate directly. Supports optional `blockId` for non-convex shapes whose `(row, col)`
 * anchor is an empty pocket cell.
 */
export function applyBoosterHammer(
  board: BoardState,
  row: number,
  col: number,
  blockId?: number | null
): boolean {
  if (blockId !== undefined && blockId !== null && blockId > 0) {
    const directBlock = board.blocks.find(
      (b) => b.id === blockId && b.status === 'ACTIVE' && !isBlockInLockedRoom(board, b)
    );
    if (directBlock) {
      destroyOrPeelBlockByBooster(board, directBlock);
      return true;
    }
  }

  if (row >= 0 && row < board.rows && col >= 0 && col < board.cols) {
    // Allow Hammer to smash open a closed Portcullis Barrier directly
    if (board.barriers) {
      const hitBarrier = board.barriers.find(
        (bar) => !bar.open && bar.cells.some(([br, bc]) => br === row && bc === col)
      );
      if (hitBarrier) {
        hitBarrier.shredsRemaining = 0;
        hitBarrier.lockId = 0;
        hitBarrier.open = true;
        rebuildOccupancyGrid(board);
        const spawned = trySpawnReadyGenerators(board);
        autoAdvanceColorQueues(board);
        for (const sb of spawned) {
          const gIdx = findEligibleGateForBlockAt(board, sb, sb.row, sb.col);
          if (gIdx >= 0) {
            resolveClearCascade(board, sb, gIdx, new Set([sb.id]));
          }
        }
        return true;
      }
    }

    // Check if a crate in an unlocked room occupies (row, col)
    const crate = board.crates.find(
      (c) =>
        !c.destroyed &&
        c.row === row &&
        c.col === col &&
        isRoomUnlocked(board, board.roomMap[c.row * board.cols + c.col] ?? 0)
    );
    if (crate) {
      crate.hp = 0;
      crate.destroyed = true;
      rebuildOccupancyGrid(board);
      const spawned = trySpawnReadyGenerators(board);
      autoAdvanceColorQueues(board);
      for (const sb of spawned) {
        const gIdx = findEligibleGateForBlockAt(board, sb, sb.row, sb.col);
        if (gIdx >= 0) {
          resolveClearCascade(board, sb, gIdx, new Set([sb.id]));
        }
      }
      return true;
    }

    const occ = board.occupancy[row * board.cols + col];
    if (occ > 0) {
      const block = board.blocks.find(
        (b) => b.id === occ && b.status === 'ACTIVE' && !isBlockInLockedRoom(board, b)
      );
      if (block) {
        destroyOrPeelBlockByBooster(board, block);
        return true;
      }
    }
  }

  // Also allow Hammer to shatter an Iced Gate or break open a Locked/Closed Shutter Gate
  for (const gate of board.gates) {
    if (isGateInLockedRoom(board, gate)) continue;
    const isLockedOrIced = gate.iceCount > 0 || !gate.shutterOpen || gate.shutterLockColor > 0;
    if (!isLockedOrIced) continue;

    const edgeLine =
      gate.edgeLine ??
      (gate.edge === 'TOP' || gate.edge === 'LEFT'
        ? 0
        : gate.edge === 'BOTTOM'
          ? board.rows - 1
          : board.cols - 1);

    const hitsTop =
      gate.edge === 'TOP' &&
      (row === edgeLine - 1 || row === edgeLine) &&
      col >= gate.spanStart &&
      col < gate.spanStart + gate.spanLength;
    const hitsBottom =
      gate.edge === 'BOTTOM' &&
      (row === edgeLine + 1 || row === edgeLine) &&
      col >= gate.spanStart &&
      col < gate.spanStart + gate.spanLength;
    const hitsLeft =
      gate.edge === 'LEFT' &&
      (col === edgeLine - 1 || col === edgeLine) &&
      row >= gate.spanStart &&
      row < gate.spanStart + gate.spanLength;
    const hitsRight =
      gate.edge === 'RIGHT' &&
      (col === edgeLine + 1 || col === edgeLine) &&
      row >= gate.spanStart &&
      row < gate.spanStart + gate.spanLength;

    if (hitsTop || hitsBottom || hitsLeft || hitsRight) {
      gate.iceCount = 0;
      gate.shutterLockColor = 0;
      gate.shutterOpen = true;
      gate.togglesOnClear = false;
      autoAdvanceColorQueues(board);
      return true;
    }
  }

  return false;
}

/**
 * Booster 4: Rocket (`🚀`) — Clears a full Row or Column of crates, opens any intersected
 * Portcullis Barrier, and peels/destroys all unlocked-room blocks (including Neutral Stone
 * Sliders) intersecting that Row or Column.
 */
export function applyBoosterRocket(board: BoardState, row: number, col: number, axis: RocketAxis): boolean {
  if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return false;

  let affected = false;

  // Snapshot unlocked rooms before breaching barriers so blocks/crates sealed inside a locked room
  // are shielded while the Portcullis Barrier itself is breached by the Rocket strike.
  const hitBlocks = new Set<BlockState>();
  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    if (isBlockInLockedRoom(board, b)) continue;
    const shape = getShape(b.shapeId);
    for (const [dr, dc] of shape.cells) {
      const br = b.row + dr;
      const bc = b.col + dc;
      if ((axis === 'ROW' && br === row) || (axis === 'COL' && bc === col)) {
        hitBlocks.add(b);
        break;
      }
    }
  }

  for (const crate of board.crates) {
    if (crate.destroyed) continue;
    const crateRoomId = board.roomMap[crate.row * board.cols + crate.col] ?? 0;
    if (!isRoomUnlocked(board, crateRoomId)) continue;
    if ((axis === 'ROW' && crate.row === row) || (axis === 'COL' && crate.col === col)) {
      crate.hp = 0;
      crate.destroyed = true;
      affected = true;
    }
  }

  if (board.barriers) {
    for (const bar of board.barriers) {
      if (bar.open || bar.isVault) continue;
      if (bar.cells.some(([br, bc]) => (axis === 'ROW' && br === row) || (axis === 'COL' && bc === col))) {
        bar.shredsRemaining = 0;
        bar.lockId = 0;
        bar.open = true;
        affected = true;
      }
    }
  }

  for (const b of hitBlocks) {
    destroyOrPeelBlockByBooster(board, b);
    affected = true;
  }

  rebuildOccupancyGrid(board);
  const spawned = trySpawnReadyGenerators(board);
  autoAdvanceColorQueues(board);
  for (const sb of spawned) {
    const gIdx = findEligibleGateForBlockAt(board, sb, sb.row, sb.col);
    if (gIdx >= 0) {
      resolveClearCascade(board, sb, gIdx, new Set([sb.id]));
    }
  }
  return affected;
}

/**
 * Booster 5: Color Vacuum (`🧲`) — Removes the outer layer of ALL unlocked active blocks matching the
 * tapped block's active color in currently unlocked rooms.
 */
export function applyBoosterVacuum(board: BoardState, targetColor: ColorId): boolean {
  if (targetColor <= 0 || targetColor > 9) return false;

  const matchingBlocks = board.blocks.filter(
    (b) =>
      b.status === 'ACTIVE' &&
      !b.chained &&
      b.ropeColor === 0 &&
      b.iceCount === 0 &&
      !isBlockInLockedRoom(board, b) &&
      getActiveColor(b.colorStack, b.colorCursor) === targetColor
  );
  if (matchingBlocks.length === 0) return false;

  for (const b of matchingBlocks) {
    destroyOrPeelBlockByBooster(board, b);
  }

  rebuildOccupancyGrid(board);
  trySpawnReadyGenerators(board);
  autoAdvanceColorQueues(board);
  return true;
}
