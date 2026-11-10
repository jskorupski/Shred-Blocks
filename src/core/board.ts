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
  getPlayableEdgeSpanBounds,
  getReachableAnchors,
  isBlockInLockedRoom,
  isBlockMovable,
  isGateInLockedRoom,
  isRoomUnlocked,
  rebuildOccupancyGrid,
} from './physics';
import { getActiveColor, getShape } from './polyomino';
import type {
  BarrierState,
  BlockState,
  BoardState,
  ColorId,
  CourtyardLayoutId,
  CrateState,
  EdgeDir,
  ElevatorState,
  GateState,
  GeneratorState,
  LevelSpec,
  PlayMode,
  RocketAxis,
} from './types';

/**
 * Resolves the boundary row (`TOP`/`BOTTOM`) or col (`LEFT`/`RIGHT`) along which a gate sits.
 * When `explicitEdgeLine` is omitted, auto-detects the outermost playable (`occ !== -1`) line
 * spanning `[spanStart .. spanStart + spanLength - 1]` so recessed L-Wing and T-Pavilion gates
 * bind cleanly to their stepped wall.
 */
export function resolveGateEdgeLine(
  rows: number,
  cols: number,
  occupancy: Int16Array,
  edge: EdgeDir,
  spanStart: number,
  spanLength: number,
  explicitEdgeLine?: number
): number {
  if (explicitEdgeLine !== undefined) {
    return explicitEdgeLine;
  }
  if (edge === 'TOP') {
    for (let r = 0; r < rows; r++) {
      let allPlayable = true;
      for (let c = spanStart; c < spanStart + spanLength; c++) {
        if (c < 0 || c >= cols || occupancy[r * cols + c] === -1) {
          allPlayable = false;
          break;
        }
      }
      if (allPlayable) return r;
    }
    return 0;
  }
  if (edge === 'BOTTOM') {
    for (let r = rows - 1; r >= 0; r--) {
      let allPlayable = true;
      for (let c = spanStart; c < spanStart + spanLength; c++) {
        if (c < 0 || c >= cols || occupancy[r * cols + c] === -1) {
          allPlayable = false;
          break;
        }
      }
      if (allPlayable) return r;
    }
    return rows - 1;
  }
  if (edge === 'LEFT') {
    for (let c = 0; c < cols; c++) {
      let allPlayable = true;
      for (let r = spanStart; r < spanStart + spanLength; r++) {
        if (r < 0 || r >= rows || occupancy[r * cols + c] === -1) {
          allPlayable = false;
          break;
        }
      }
      if (allPlayable) return c;
    }
    return 0;
  }
  for (let c = cols - 1; c >= 0; c--) {
    let allPlayable = true;
    for (let r = spanStart; r < spanStart + spanLength; r++) {
      if (r < 0 || r >= rows || occupancy[r * cols + c] === -1) {
        allPlayable = false;
        break;
      }
    }
    if (allPlayable) return c;
  }
  return cols - 1;
}

export function createBoardState(spec: LevelSpec): BoardState {
  const { rows, cols } = spec;
  const occupancy = new Int16Array(rows * cols);
  const floorColor = new Uint8Array(rows * cols);
  const roomMap = new Uint8Array(rows * cols);

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

  const barriers: BarrierState[] = (spec.barriers ?? []).map((bar, idx) => {
    const unlocksRoomId = bar.unlocksRoomId ?? idx + 1;
    const shredsRemaining = Math.max(0, bar.shredsRemaining ?? 0);
    const lockId = bar.lockId ?? 0;
    if (bar.roomCells) {
      for (const [rr, cc] of bar.roomCells) {
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
          roomMap[rr * cols + cc] = unlocksRoomId;
        }
      }
    }
    return {
      id: bar.id,
      cells: bar.cells.map(([r, c]) => [r, c]),
      orientation: bar.orientation,
      shredsRemaining,
      maxShreds: Math.max(1, shredsRemaining),
      lockId,
      unlocksRoomId,
      open: shredsRemaining <= 0 && lockId === 0,
    };
  });

  const inferredLayoutId: CourtyardLayoutId =
    spec.layoutId ??
    (barriers.length > 0
      ? 'TWIN_SANCTUM'
      : (spec.cutouts?.length ?? 0) > 0
        ? 'CROSS_ATRIUM'
        : 'RECTANGLE');

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
    const edgeLine = resolveGateEdgeLine(
      rows,
      cols,
      occupancy,
      g.edge,
      g.spanStart,
      g.spanLength,
      g.edgeLine
    );
    const { minSpan, maxSpanEnd } = getPlayableEdgeSpanBounds(
      rows,
      cols,
      occupancy,
      g.edge,
      edgeLine,
      g.spanStart,
      g.spanLength
    );
    const playableSpanLen = Math.max(g.spanLength, maxSpanEnd - minSpan);
    return {
      index: idx,
      edge: g.edge,
      spanStart: g.spanStart,
      spanLength: g.spanLength,
      edgeLine,
      colorQueue: [...g.colorQueue],
      colorCursor: 0,
      isStar: g.isStar ?? false,
      iceCount: g.iceCount ?? 0,
      shutterLockColor: g.shutterLockColor ?? 0,
      togglesOnClear: g.togglesOnClear ?? false,
      shutterOpen: g.shutterOpen ?? (g.shutterLockColor ? false : true),
      slidesOnClear: g.slidesOnClear ?? false,
      slideMin: g.slideMin ?? minSpan,
      slideMax: g.slideMax ?? Math.max(minSpan, maxSpanEnd - g.spanLength),
      slideDir: g.slideDir ?? 1,
      sizeChangesOnClear: g.sizeChangesOnClear ?? false,
      minLength: g.minLength ?? 1,
      maxLength: g.maxLength ?? Math.min(4, playableSpanLen),
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
    cooldown: gen.cooldown ?? 0,
    maxCooldown: Math.max(1, gen.cooldown ?? 1),
    queue: gen.queue.map((q) => ({
      ...q,
      colorStack: [...q.colorStack],
    })),
    queueCursor: 0,
    state:
      gen.queue.length === 0 ? 'DEPLETED' : (gen.cooldown ?? 0) <= 0 ? 'READY_TO_SPAWN' : 'COUNTING',
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
    layoutId: inferredLayoutId,
    rows,
    cols,
    occupancy,
    floorColor,
    roomMap,
    blocks,
    gates,
    crates,
    generators,
    elevators,
    barriers,
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
    roomMap: new Uint8Array(board.roomMap),
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
    barriers: board.barriers.map((bar) => ({
      ...bar,
      cells: bar.cells.map(([r, c]) => [r, c]),
    })),
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

  const didMoveOrClear =
    dRow !== 0 || dCol !== 0 || clearedBlockIds.length > 0 || peeledBlockIds.length > 0;

  if (didMoveOrClear) {
    board.movesCommitted++;
    board.timerRunning = true;
    board.hintMove = null;

    // In ZEN mode, Bomb counters decrement by 1 per committed move (only in unlocked rooms)
    if (playMode === 'ZEN' && board.freezeRemainingSec <= 0) {
      for (const b of board.blocks) {
        if (
          b.status === 'ACTIVE' &&
          b.bombMax > 0 &&
          b.bombCount > 0 &&
          !isBlockInLockedRoom(board, b)
        ) {
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
export function applyBoosterRocket(
  board: BoardState,
  row: number,
  col: number,
  axis: RocketAxis
): boolean {
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
      if (bar.open) continue;
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
