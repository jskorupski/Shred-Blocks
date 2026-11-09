import {
  autoAdvanceColorQueues,
  detachBlockFromGluedGroup,
  findEligibleGateForBlockAt,
  resolveClearCascade,
  stepDynamicGatesOnShred,
  stepMovingElevators,
  triggerCarrierItems,
  trySpawnReadyGenerators,
} from './gate-clearance';
import {
  canGroupOccupyOffset,
  getMovedGroupBlocks,
  getReachableAnchors,
  isBlockMovable,
  rebuildOccupancyGrid,
} from './physics';
import { getActiveColor, getShape } from './polyomino';
import type {
  BlockState,
  BoardState,
  ColorId,
  CrateState,
  ElevatorState,
  GateState,
  GeneratorState,
  LevelSpec,
  PlayMode,
  RocketAxis,
} from './types';

export function createBoardState(spec: LevelSpec): BoardState {
  const { rows, cols } = spec;
  const occupancy = new Int16Array(rows * cols);
  const floorColor = new Uint8Array(rows * cols);

  if (spec.cutouts) {
    for (const [r, c] of spec.cutouts) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        occupancy[r * cols + c] = -1;
      }
    }
  }

  if (spec.pillars) {
    for (const [r, c] of spec.pillars) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        occupancy[r * cols + c] = -2;
      }
    }
  }

  if (spec.floorPaths) {
    for (const fp of spec.floorPaths) {
      if (fp.row >= 0 && fp.row < rows && fp.col >= 0 && fp.col < cols) {
        floorColor[fp.row * cols + fp.col] = fp.color;
      }
    }
  }

  let maxBlockId = 0;
  const blocks: BlockState[] = spec.blocks.map((b) => {
    if (b.id > maxBlockId) maxBlockId = b.id;
    return {
      id: b.id,
      shapeId: b.shapeId,
      row: b.row,
      col: b.col,
      x: b.col,
      y: b.row,
      liftAlpha: 0,
      colorStack: [...b.colorStack],
      colorCursor: 0,
      axisLock: b.axisLock ?? 'NONE',
      iceCount: b.iceCount ?? 0,
      isStar: b.isStar ?? false,
      chained: b.chained ?? false,
      lockId: b.lockId ?? 0,
      hasKey: b.hasKey ?? 0,
      bombCount: b.bombCount ?? 0,
      bombMax: b.bombCount ?? 0,
      groupId: b.groupId ?? 0,
      ropeColor: b.ropeColor ?? 0,
      scissorColor: b.scissorColor ?? 0,
      shutterGemColor: b.shutterGemColor ?? 0,
      status: 'ACTIVE',
      shredGateIndex: -1,
      shredProgress: 0,
      reboundTimerMs: 0,
    };
  });

  const gates: GateState[] = spec.gates.map((g, idx) => {
    const edgeLimit = g.edge === 'TOP' || g.edge === 'BOTTOM' ? cols : rows;
    return {
      index: idx,
      edge: g.edge,
      spanStart: g.spanStart,
      spanLength: g.spanLength,
      colorQueue: [...g.colorQueue],
      colorCursor: 0,
      isStar: g.isStar ?? false,
      iceCount: g.iceCount ?? 0,
      shutterLockColor: g.shutterLockColor ?? 0,
      togglesOnClear: g.togglesOnClear ?? false,
      shutterOpen: g.shutterOpen ?? (g.shutterLockColor ? false : true),
      slidesOnClear: g.slidesOnClear ?? false,
      slideMin: g.slideMin ?? 0,
      slideMax: g.slideMax ?? Math.max(0, edgeLimit - g.spanLength),
      slideDir: g.slideDir ?? 1,
      sizeChangesOnClear: g.sizeChangesOnClear ?? false,
      minLength: g.minLength ?? 1,
      maxLength: g.maxLength ?? Math.min(4, edgeLimit),
      sizeDir: -1,
      rollerPhase: 0,
    };
  });

  const crates: CrateState[] = (spec.crates ?? []).map((c) => ({
    id: c.id,
    row: c.row,
    col: c.col,
    hp: c.hp,
    maxHp: c.hp,
    destroyed: c.hp <= 0,
  }));

  const generators: GeneratorState[] = (spec.generators ?? []).map((gen) => ({
    id: gen.id,
    row: gen.row,
    col: gen.col,
    spawnRow: gen.spawnRow,
    spawnCol: gen.spawnCol,
    cooldown: gen.cooldown,
    maxCooldown: Math.max(1, gen.cooldown),
    queue: gen.queue.map((q) => ({
      ...q,
      colorStack: [...q.colorStack],
    })),
    queueCursor: 0,
    state: gen.queue.length === 0 ? 'DEPLETED' : gen.cooldown <= 0 ? 'READY_TO_SPAWN' : 'COUNTING',
  }));

  const elevators: ElevatorState[] = (spec.elevators ?? []).map((e) => ({
    id: e.id,
    row: e.row,
    col: e.col,
    width: e.width,
    height: e.height,
    deltaRow: e.deltaRow,
    deltaCol: e.deltaCol,
    atAlternatePos: false,
  }));

  const timeLimitSec = spec.timeLimitSec ?? 90;
  const parMoves = spec.parMoves ?? Math.max(4, blocks.length * 2);

  const board: BoardState = {
    levelId: spec.id,
    name: spec.name,
    difficulty: spec.difficulty,
    rows,
    cols,
    occupancy,
    floorColor,
    blocks,
    gates,
    crates,
    generators,
    elevators,
    parMoves,
    timeLimitSec,
    timeRemainingSec: timeLimitSec,
    freezeRemainingSec: 0,
    timerRunning: false,
    movesCommitted: 0,
    sessionBlocksShredded: 0,
    nextDynamicBlockId: maxBlockId + 1,
    hintMove: null,
  };

  rebuildOccupancyGrid(board);
  trySpawnReadyGenerators(board);
  autoAdvanceColorQueues(board);
  return board;
}

export function cloneBoardState(board: BoardState): BoardState {
  return {
    ...board,
    occupancy: new Int16Array(board.occupancy),
    floorColor: new Uint8Array(board.floorColor),
    blocks: board.blocks.map((b) => ({
      ...b,
      colorStack: [...b.colorStack],
    })),
    gates: board.gates.map((g) => ({
      ...g,
      colorQueue: [...g.colorQueue],
    })),
    crates: board.crates.map((c) => ({ ...c })),
    generators: board.generators.map((gen) => ({
      ...gen,
      queue: gen.queue.map((q) => ({ ...q, colorStack: [...q.colorStack] })),
    })),
    elevators: board.elevators.map((e) => ({ ...e })),
    hintMove: board.hintMove ? { ...board.hintMove } : null,
  };
}

/**
 * A level is won when every non-stone block (`activeColor !== 0`) has been cleared
 * AND all Block Generators are `DEPLETED`.
 */
export function isBoardWon(board: BoardState): boolean {
  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    const activeColor = getActiveColor(b.colorStack, b.colorCursor);
    if (activeColor !== 0) return false;
  }
  for (const gen of board.generators) {
    if (gen.state !== 'DEPLETED' && gen.queueCursor < gen.queue.length) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether the board is in a loss state due to time expiration (in `TIMED` mode)
 * or an active Bomb block reaching 0.
 */
export function isBoardFailed(
  board: BoardState,
  playMode: PlayMode
): { failed: boolean; reason: 'TIME_OUT' | 'BOMB_EXPLODED' | null } {
  if (playMode === 'TIMED' && board.timeRemainingSec <= 0) {
    return { failed: true, reason: 'TIME_OUT' };
  }
  for (const b of board.blocks) {
    if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount <= 0) {
      return { failed: true, reason: 'BOMB_EXPLODED' };
    }
  }
  return { failed: false, reason: null };
}

export interface CommitMoveOutcome {
  moved: boolean;
  clearedGateIndex: number;
  clearedBlockIds: number[];
  peeledBlockIds: number[];
  spawnedBlockIds: number[];
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
    }
  }

  const didMoveOrClear =
    dRow !== 0 || dCol !== 0 || clearedBlockIds.length > 0 || peeledBlockIds.length > 0;

  if (didMoveOrClear) {
    board.movesCommitted++;
    board.timerRunning = true;
    board.hintMove = null;

    // In ZEN mode, Bomb counters decrement by 1 per committed move
    if (playMode === 'ZEN' && board.freezeRemainingSec <= 0) {
      for (const b of board.blocks) {
        if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount > 0) {
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

  // Global Ice thaw (blocks & gates)
  for (const b of board.blocks) {
    if (b.status === 'ACTIVE' && b.id !== block.id && b.iceCount > 0) {
      b.iceCount = Math.max(0, b.iceCount - 1);
    }
  }
  for (const g of board.gates) {
    if (g.iceCount > 0) {
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
  rebuildOccupancyGrid(board);
  stepMovingElevators(board);

  for (const gen of board.generators) {
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
 * destroys 1 Wooden Crate, or shatters an Iced / Locked Shutter Gate directly. Supports optional
 * `blockId` for non-convex shapes whose `(row, col)` anchor is an empty pocket cell.
 */
export function applyBoosterHammer(
  board: BoardState,
  row: number,
  col: number,
  blockId?: number | null
): boolean {
  if (blockId !== undefined && blockId !== null && blockId > 0) {
    const directBlock = board.blocks.find((b) => b.id === blockId && b.status === 'ACTIVE');
    if (directBlock) {
      destroyOrPeelBlockByBooster(board, directBlock);
      return true;
    }
  }

  if (row >= 0 && row < board.rows && col >= 0 && col < board.cols) {
    // Check if a crate occupies (row, col)
    const crate = board.crates.find((c) => !c.destroyed && c.row === row && c.col === col);
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
      const block = board.blocks.find((b) => b.id === occ && b.status === 'ACTIVE');
      if (block) {
        destroyOrPeelBlockByBooster(board, block);
        return true;
      }
    }
  }

  // Also allow Hammer to shatter an Iced Gate or break open a Locked/Closed Shutter Gate
  for (const gate of board.gates) {
    const isLockedOrIced = gate.iceCount > 0 || !gate.shutterOpen || gate.shutterLockColor > 0;
    if (!isLockedOrIced) continue;

    const hitsTop =
      gate.edge === 'TOP' &&
      (row === -1 || row === 0) &&
      col >= gate.spanStart &&
      col < gate.spanStart + gate.spanLength;
    const hitsBottom =
      gate.edge === 'BOTTOM' &&
      (row === board.rows || row === board.rows - 1) &&
      col >= gate.spanStart &&
      col < gate.spanStart + gate.spanLength;
    const hitsLeft =
      gate.edge === 'LEFT' &&
      (col === -1 || col === 0) &&
      row >= gate.spanStart &&
      row < gate.spanStart + gate.spanLength;
    const hitsRight =
      gate.edge === 'RIGHT' &&
      (col === board.cols || col === board.cols - 1) &&
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
 * Booster 4: Rocket (`🚀`) — Clears a full Row or Column of crates and peels/destroys all blocks
 * (including Neutral Stone Sliders) intersecting that Row or Column.
 */
export function applyBoosterRocket(
  board: BoardState,
  row: number,
  col: number,
  axis: RocketAxis
): boolean {
  if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return false;

  let affected = false;

  for (const crate of board.crates) {
    if (crate.destroyed) continue;
    if ((axis === 'ROW' && crate.row === row) || (axis === 'COL' && crate.col === col)) {
      crate.hp = 0;
      crate.destroyed = true;
      affected = true;
    }
  }

  const hitBlocks = new Set<BlockState>();
  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
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

  for (const b of hitBlocks) {
    destroyOrPeelBlockByBooster(board, b);
    affected = true;
  }

  rebuildOccupancyGrid(board);
  trySpawnReadyGenerators(board);
  autoAdvanceColorQueues(board);
  return affected;
}

/**
 * Booster 5: Color Vacuum (`🧲`) — Removes the outer layer of ALL unlocked active blocks matching the
 * tapped block's active color.
 */
export function applyBoosterVacuum(board: BoardState, targetColor: ColorId): boolean {
  if (targetColor <= 0 || targetColor > 9) return false;

  const matchingBlocks = board.blocks.filter(
    (b) =>
      b.status === 'ACTIVE' &&
      !b.chained &&
      b.ropeColor === 0 &&
      b.iceCount === 0 &&
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

/**
 * Computes star rating (1..3) upon level completion (`FR-29`):
 * - In `TIMED` mode (Speed Stars):
 *   - 3 Stars: `timeRemainingSec / timeLimitSec >= 0.25`
 *   - 2 Stars: `timeRemainingSec / timeLimitSec >= 0.10`
 *   - 1 Star:  cleared before `00:00`
 * - In `ZEN` mode (Efficiency Stars):
 *   - 3 Stars: `movesCommitted <= Math.ceil(parMoves * 1.25)`
 *   - 2 Stars: `movesCommitted <= Math.ceil(parMoves * 1.75)`
 *   - 1 Star:  cleared in any number of moves
 */
export function computeEarnedStars(board: BoardState, playMode: PlayMode = 'ZEN'): 1 | 2 | 3 {
  if (playMode === 'TIMED' && board.timeLimitSec > 0) {
    const ratio = board.timeRemainingSec / board.timeLimitSec;
    if (ratio >= 0.25) return 3;
    if (ratio >= 0.1) return 2;
    return 1;
  }
  const par = Math.max(1, board.parMoves);
  if (board.movesCommitted <= Math.ceil(par * 1.25)) return 3;
  if (board.movesCommitted <= Math.ceil(par * 1.75)) return 2;
  return 1;
}
