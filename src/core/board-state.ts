import { autoAdvanceColorQueues, trySpawnReadyGenerators } from './gate-clearance';
import { getPlayableEdgeSpanBounds, rebuildOccupancyGrid } from './physics';
import { getActiveColor } from './polyomino';
import type {
  BarrierState,
  BlockState,
  BoardState,
  CourtyardLayoutId,
  CrateState,
  EdgeDir,
  ElevatorState,
  GateState,
  GeneratorState,
  LevelSpec,
  PlayMode,
} from './types';

/**
 * Resolves the canonical `edgeLine` row/col for a gate on a potentially sculpted courtyard.
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
    const isVault = Boolean(bar.isVault);
    const effectiveRoomCells = bar.roomCells ?? (isVault ? bar.cells : undefined);
    if (effectiveRoomCells) {
      for (const [rr, cc] of effectiveRoomCells) {
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
      isVault,
    };
  });

  const inferredLayoutId: CourtyardLayoutId =
    spec.layoutId ??
    (barriers.some((b) => b.isVault)
      ? 'MYSTERY_VAULT'
      : barriers.length > 0
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
      shutterOpen: g.shutterOpen ?? !g.shutterLockColor,
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
    state: gen.queue.length === 0 ? 'DEPLETED' : (gen.cooldown ?? 0) <= 0 ? 'READY_TO_SPAWN' : 'COUNTING',
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
