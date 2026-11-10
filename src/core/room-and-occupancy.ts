import { getShape } from './polyomino';
import type { AxisLock, BarrierState, BlockState, BoardState, EdgeDir, GateState } from './types';

/**
 * Computes the contiguous playable `[minSpan .. maxSpanEnd]` interval along `edgeLine` containing
 * `spanStart`, preventing sliding/size-changing gates on non-rectangular courtyards from
 * sliding or expanding into exterior cutout voids (`occupancy === -1`).
 */
export function getPlayableEdgeSpanBounds(
  rows: number,
  cols: number,
  occupancy: Int16Array,
  edge: EdgeDir,
  edgeLine: number,
  spanStart: number,
  spanLength: number
): { minSpan: number; maxSpanEnd: number } {
  const isHoriz = edge === 'TOP' || edge === 'BOTTOM';
  const limit = isHoriz ? cols : rows;
  const isPlayableAt = (pos: number): boolean => {
    if (pos < 0 || pos >= limit) return false;
    const r = isHoriz ? edgeLine : pos;
    const c = isHoriz ? pos : edgeLine;
    if (r < 0 || (r >= rows && c < 0)) return false;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    return occupancy[r * cols + c] !== -1;
  };

  let minSpan = Math.max(0, Math.min(limit - 1, spanStart));
  while (minSpan > 0 && isPlayableAt(minSpan - 1)) {
    minSpan--;
  }
  let maxSpanEnd = Math.max(minSpan + 1, Math.min(limit, spanStart + spanLength));
  while (maxSpanEnd < limit && isPlayableAt(maxSpanEnd)) {
    maxSpanEnd++;
  }
  return { minSpan, maxSpanEnd };
}

/**
 * Returns all ACTIVE blocks that move together as a rigid assembly with `blockId`.
 * If `block.groupId > 0`, all active blocks with the same `groupId` move together.
 */
export function getMovedGroupBlocks(board: BoardState, blockId: number): BlockState[] {
  const lead = board.blocks.find((b) => b.id === blockId && b.status === 'ACTIVE');
  if (!lead) return [];
  if (lead.groupId > 0) {
    return board.blocks.filter((b) => b.status === 'ACTIVE' && b.groupId === lead.groupId);
  }
  return [lead];
}

/**
 * Returns `true` if `roomId === 0` (the starting courtyard) or every Portcullis Barrier
 * guarding `roomId` (`unlocksRoomId === roomId`) is currently open.
 */
export function isRoomUnlocked(board: BoardState, roomId: number): boolean {
  if (roomId <= 0 || !board.barriers || board.barriers.length === 0) return true;
  for (const bar of board.barriers) {
    if (bar.unlocksRoomId === roomId && !bar.open) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the room ID (`0` = starting courtyard, `1..N` = secondary chamber) containing `block`.
 */
export function getBlockRoomId(board: BoardState, block: BlockState): number {
  if (!board.roomMap || board.roomMap.length === 0) return 0;
  const shape = getShape(block.shapeId);
  for (const [dr, dc] of shape.cells) {
    const r = block.row + dr;
    const c = block.col + dc;
    if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
      const rid = board.roomMap[r * board.cols + c];
      if (rid > 0) return rid;
    }
  }
  return 0;
}

/**
 * Returns `true` if any constituent cell of `block` resides inside a currently sealed room.
 */
export function isBlockInLockedRoom(board: BoardState, block: BlockState): boolean {
  if (!board.roomMap || !board.barriers || board.barriers.length === 0) return false;
  const shape = getShape(block.shapeId);
  for (const [dr, dc] of shape.cells) {
    const r = block.row + dr;
    const c = block.col + dc;
    if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
      const rid = board.roomMap[r * board.cols + c];
      if (rid > 0 && !isRoomUnlocked(board, rid)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns `true` if `block` is concealed beneath a currently closed Sealed Mystery Vault (`bar.isVault`).
 */
export function isBlockInSealedVault(board: BoardState, block: BlockState): boolean {
  if (!board.roomMap || !board.barriers || board.barriers.length === 0) return false;
  const shape = getShape(block.shapeId);
  for (const [dr, dc] of shape.cells) {
    const r = block.row + dr;
    const c = block.col + dc;
    if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
      const rid = board.roomMap[r * board.cols + c];
      if (rid > 0) {
        for (const bar of board.barriers) {
          if (bar.unlocksRoomId === rid && bar.isVault && !bar.open) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Returns the closed Sealed Mystery Vault (`BarrierState`) covering `(row, col)`, or `null` if none.
 */
export function getSealedVaultAtCell(board: BoardState, row: number, col: number): BarrierState | null {
  if (!board.barriers || board.barriers.length === 0) return null;
  if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return null;
  for (const bar of board.barriers) {
    if (!bar.isVault || bar.open) continue;
    for (const [r, c] of bar.cells) {
      if (r === row && c === col) {
        return bar;
      }
    }
  }
  return null;
}

/**
 * Returns `true` if an Exit Gate sits along the wall of a currently sealed non-vault room (`MECH-18`).
 * Perimeter gates bordering a Sealed Mystery Vault (`bar.isVault`) remain active on the outer courtyard
 * wall so their staggered ice countdowns thaw in lockstep with vault openings.
 */
export function isGateInLockedRoom(board: BoardState, gate: GateState): boolean {
  if (!board.roomMap || !board.barriers || board.barriers.length === 0) return false;
  const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
  const edgeLine =
    gate.edgeLine ??
    (gate.edge === 'TOP' || gate.edge === 'LEFT'
      ? 0
      : gate.edge === 'BOTTOM'
        ? board.rows - 1
        : board.cols - 1);

  let foundPlayableCell = false;
  for (let s = gate.spanStart; s < gate.spanStart + gate.spanLength; s++) {
    const r = isHoriz ? edgeLine : s;
    const c = isHoriz ? s : edgeLine;
    if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
      const idx = r * board.cols + c;
      if (board.occupancy[idx] !== -1) {
        foundPlayableCell = true;
        const rid = board.roomMap[idx];
        const lockedByNonVaultRoom =
          rid > 0 && board.barriers.some((bar) => bar.unlocksRoomId === rid && !bar.open && !bar.isVault);
        if (!lockedByNonVaultRoom) {
          return false;
        }
      }
    }
  }
  return foundPlayableCell;
}

/**
 * Checks whether a single block (and its glued group if `groupId > 0`) is allowed to move.
 */
export function isBlockMovable(board: BoardState, blockId: number): boolean {
  const group = getMovedGroupBlocks(board, blockId);
  if (group.length === 0) return false;

  for (const b of group) {
    if (b.iceCount > 0) return false; // Frozen block
    if (b.chained) return false; // Padlocked / chained block
    if (b.ropeColor > 0) return false; // Tied with colored rope
    if (isBlockInLockedRoom(board, b)) return false; // Sealed inside a dormant chamber
  }

  // Also check if group has conflicting axis locks (e.g., H and V glued together)
  const effectiveLock = getGroupAxisLock(group);
  if (effectiveLock === 'LOCKED_BOTH') return false;

  return true;
}

export function getGroupAxisLock(group: BlockState[]): AxisLock | 'LOCKED_BOTH' {
  let hasH = false;
  let hasV = false;
  for (const b of group) {
    if (b.axisLock === 'H') hasH = true;
    if (b.axisLock === 'V') hasV = true;
  }
  if (hasH && hasV) return 'LOCKED_BOTH';
  if (hasH) return 'H';
  if (hasV) return 'V';
  return 'NONE';
}

/**
 * Rebuilds the `board.occupancy` flat Int16Array from cutouts, pillars, closed portcullis
 * barriers (`-3`), crates (`-100 - id`), and active blocks (`> 0`).
 * Calling this after any discrete grid mutation guarantees 0 stale cells.
 */
export function rebuildOccupancyGrid(board: BoardState): void {
  const { rows, cols, occupancy } = board;
  // Preserve static cutouts (-1) and pillars (-2); clear dynamic entries (>0, -3 portcullis, or <= -100)
  for (let i = 0; i < rows * cols; i++) {
    const val = occupancy[i];
    if (val > 0 || val === -3 || val <= -100) {
      occupancy[i] = 0;
    }
  }

  if (board.barriers) {
    for (const barrier of board.barriers) {
      if (!barrier.open) {
        for (const [r, c] of barrier.cells) {
          if (r >= 0 && r < rows && c >= 0 && c < cols) {
            occupancy[r * cols + c] = -3;
          }
        }
      }
    }
  }

  for (const crate of board.crates) {
    if (!crate.destroyed && crate.hp > 0) {
      const idx = crate.row * cols + crate.col;
      if (idx >= 0 && idx < rows * cols) {
        occupancy[idx] = -100 - crate.id;
      }
    }
  }

  for (const block of board.blocks) {
    if (block.status !== 'ACTIVE') continue;
    if (isBlockInSealedVault(board, block)) continue;
    const shape = getShape(block.shapeId);
    for (const [dr, dc] of shape.cells) {
      const r = block.row + dr;
      const c = block.col + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        occupancy[r * cols + c] = block.id;
      }
    }
  }
}
