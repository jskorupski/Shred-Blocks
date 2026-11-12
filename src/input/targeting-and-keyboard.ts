import type { SoundEngine } from '../audio/synth';
import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  type CommitMoveOutcome,
  commitBlockMove,
} from '../core/board';
import { findEligibleGateForBlockAt, getGateOutwardNormal } from '../core/gate-clearance';
import {
  canGroupOccupyOffset,
  getMovedGroupBlocks,
  getSealedVaultAtCell,
  isBlockInLockedRoom,
  isBlockInSealedVault,
  isBlockMovable,
} from '../core/physics';
import { getActiveColor, getShape } from '../core/polyomino';
import type {
  BarrierState,
  BlockState,
  BoardState,
  BoosterType,
  ColorId,
  InputMode,
  PlayMode,
  RocketAxis,
} from '../core/types';
import type { PathWaypoint } from '../render/pass2-drag-fx';

export const HIT_SLOP_HALO = 0.32;
export const MONO_PRIORITY_WEIGHT = 1.3;

export interface BoosterTargetPayload {
  row: number;
  col: number;
  blockId: number | null;
  color: ColorId | null;
  axis: RocketAxis;
}

export interface CommittedPathTraceInfo {
  waypoints: PathWaypoint[];
  colorId: ColorId;
  zOffset: number;
  spanCols: number;
  spanRows: number;
  intoGate?: boolean;
  cellMask?: number;
}

export interface HoverState {
  inputMode: InputMode;
  hoverRow: number;
  hoverCol: number;
  hoverBlockId: number | null;
  rocketAxis: RocketAxis;
  selectedBlockId: number | null;
  activeBlockId: number | null;
  dragLeftOrigin?: boolean;
}

export interface BoardInputCallbacks {
  getBoard: () => BoardState;
  getPlayMode: () => PlayMode;
  sound?: SoundEngine;
  /** Optional custom raycast/unproject from client (px) to continuous board coordinates (0..cols, 0..rows) */
  screenToBoard?: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** Called right before a move or booster mutates the board so Undo history can snapshot clean state */
  onBeforeMoveCommit?: (board: BoardState) => void;
  /** Called after a move is committed (either mid-drag gate capture or grid snap on release/keyboard) */
  onMoveCommitted?: (outcome: CommitMoveOutcome) => void;
  /** Called after a move or shred commits so the renderer can trace the path taken (`MYSTIC-TRACE-01`) */
  onPathTrace?: (trace: CommittedPathTraceInfo) => void;
  /** Called when a player taps an immobile block (Stone, Frozen, Chained, Roped) */
  onImmobileBlockTap?: (block: BlockState) => void;
  /** Called when a player taps a closed Sealed Mystery Vault lid (`bar.isVault`) */
  onLockedVaultTap?: (vault: BarrierState) => void;
  /** Called when a targeted booster (Hammer, Rocket, Vacuum) is executed on a valid target */
  onExecuteBooster?: (type: BoosterType, target: BoosterTargetPayload) => boolean;
  /** Called when a keyboard shortcut triggers a quick action or booster slot 1..5 */
  onShortcutAction?: (action: 'UNDO' | 'RESTART' | 'HINT' | 'HAMMER' | 'ROCKET' | 'VACUUM') => void;
  /** Called whenever hover/selection/targeting state changes */
  onHoverChanged?: (state: HoverState) => void;
  /** Optional guard returning whether keyboard/pointer board controls are currently active */
  isBoardInteractive?: () => boolean;
  /** Called during drag updates */
  onBoardChanged?: () => void;
}

/**
 * UX-02 Voronoi `1.30x` Priority Hit-Slop Picker:
 * Checks exact cell containment first, and within a `0.32`-cell halo around blocks,
 * gives `1x1` monominoes a `1.30x` priority weight so a `1x1` block tucked inside
 * a non-convex `U` or `L` pocket is always easy to grab.
 */
export function pickBlockAtBoardPoint(board: BoardState, boardX: number, boardY: number): BlockState | null {
  if (getSealedVaultAtCell(board, Math.floor(boardY), Math.floor(boardX)) !== null) {
    return null;
  }

  interface Candidate {
    block: BlockState;
    isMono: boolean;
    movable: boolean;
    minBoxDist: number;
    minCenterDist: number;
    weightedBoxDist: number;
    weightedCenterDist: number;
  }

  const candidates: Candidate[] = [];

  for (const block of board.blocks) {
    if (block.status !== 'ACTIVE') continue;
    if (isBlockInSealedVault(board, block)) continue;
    const shape = getShape(block.shapeId);
    const isMono = block.shapeId === '1x1';
    const weight = isMono ? MONO_PRIORITY_WEIGHT : 1.0;

    let minBoxDist = Infinity;
    let minCenterDist = Infinity;

    for (const [dr, dc] of shape.cells) {
      const cellX = block.x + dc;
      const cellY = block.y + dr;

      const dx = Math.max(cellX - boardX, 0, boardX - (cellX + 1));
      const dy = Math.max(cellY - boardY, 0, boardY - (cellY + 1));
      const boxDist = Math.hypot(dx, dy);
      const centerDist = Math.hypot(boardX - (cellX + 0.5), boardY - (cellY + 0.5));

      if (boxDist < minBoxDist) minBoxDist = boxDist;
      if (centerDist < minCenterDist) minCenterDist = centerDist;
    }

    if (minBoxDist <= HIT_SLOP_HALO) {
      candidates.push({
        block,
        isMono,
        movable: isBlockMovable(board, block.id),
        minBoxDist,
        minCenterDist,
        weightedBoxDist: minBoxDist / weight,
        weightedCenterDist: minCenterDist / weight,
      });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].block;

  // Check if a movable 1x1 monomino is within the 0.32 halo and beats other candidates by Voronoi weighted center distance
  const monoCandidate = candidates
    .filter((c) => c.isMono && c.movable)
    .sort((a, b) => a.weightedCenterDist - b.weightedCenterDist)[0];

  if (monoCandidate) {
    const bestOther = candidates
      .filter((c) => c.block.id !== monoCandidate.block.id)
      .sort((a, b) => a.weightedCenterDist - b.weightedCenterDist)[0];
    if (!bestOther || monoCandidate.weightedCenterDist <= bestOther.weightedCenterDist) {
      return monoCandidate.block;
    }
  }

  // Exact cell containment check (minBoxDist === 0)
  const exactHits = candidates.filter((c) => c.minBoxDist <= 1e-5);
  if (exactHits.length > 0) {
    exactHits.sort((a, b) => a.weightedCenterDist - b.weightedCenterDist);
    return exactHits[0].block;
  }

  // Halo fallback: prefer movable blocks first, then smallest weighted box distance, then weighted center distance
  candidates.sort((a, b) => {
    if (a.movable !== b.movable) return a.movable ? -1 : 1;
    if (Math.abs(a.weightedBoxDist - b.weightedBoxDist) > 1e-4) {
      return a.weightedBoxDist - b.weightedBoxDist;
    }
    return a.weightedCenterDist - b.weightedCenterDist;
  });

  return candidates[0].block;
}

export function playOutcomeAudioHelper(sound: SoundEngine | undefined, outcome: CommitMoveOutcome): void {
  if (!sound) return;
  if (outcome.clearedBlockIds.length > 0) {
    outcome.clearedBlockIds.forEach((_, idx) => {
      sound.playShred(idx);
    });
  } else if (outcome.peeledBlockIds.length > 0) {
    sound.playLayerPeel();
  } else if (outcome.moved) {
    sound.playSnap();
  }
}

export function executeBoosterTargetTap(
  board: BoardState,
  boardX: number,
  boardY: number,
  inputMode: InputMode,
  rocketAxis: RocketAxis,
  callbacks: BoardInputCallbacks,
  setInputMode: (mode: InputMode) => void
): void {
  const row = Math.floor(boardY);
  const col = Math.floor(boardX);

  // Tapping outside the board cancels targeting without spending the booster
  // (Allow Hammer to tap 1 cell outside the board rim to shatter Iced/Shutter Gates)
  const minCoord = inputMode === 'TARGET_HAMMER' ? -1 : 0;
  const maxRow = inputMode === 'TARGET_HAMMER' ? board.rows : board.rows - 1;
  const maxCol = inputMode === 'TARGET_HAMMER' ? board.cols : board.cols - 1;
  if (row < minCoord || row > maxRow || col < minCoord || col > maxCol) {
    setInputMode('DRAG');
    return;
  }

  const inBounds = row >= 0 && row < board.rows && col >= 0 && col < board.cols;
  const cellOcc = inBounds ? board.occupancy[row * board.cols + col] : -1;
  const isDirectNonBlockHammerCell =
    inputMode === 'TARGET_HAMMER' && (!inBounds || cellOcc === -1 || cellOcc === -3 || cellOcc <= -100);

  const rawPicked = isDirectNonBlockHammerCell ? null : pickBlockAtBoardPoint(board, boardX, boardY);
  const picked = rawPicked && !isBlockInLockedRoom(board, rawPicked) ? rawPicked : null;
  if (
    inputMode === 'TARGET_VACUUM' &&
    (!picked || picked.iceCount > 0 || picked.chained || picked.ropeColor > 0)
  ) {
    setInputMode('DRAG');
    return;
  }
  const pickedColor = picked ? getActiveColor(picked.colorStack, picked.colorCursor) : null;

  const payload: BoosterTargetPayload = {
    row,
    col,
    blockId: picked ? picked.id : null,
    color: pickedColor,
    axis: rocketAxis,
  };

  let boosterType: BoosterType = 'HAMMER';
  if (inputMode === 'TARGET_ROCKET') boosterType = 'ROCKET';
  if (inputMode === 'TARGET_VACUUM') boosterType = 'VACUUM';

  if (callbacks.onExecuteBooster) {
    const executed = callbacks.onExecuteBooster(boosterType, payload);
    if (executed) {
      callbacks.sound?.playBooster(boosterType);
      setInputMode('DRAG');
      callbacks.onBoardChanged?.();
    } else {
      // Invalid target tapped -> cancel targeting without spending booster
      setInputMode('DRAG');
    }
    return;
  }

  // Fallback direct booster execution if no custom callback was provided
  callbacks.onBeforeMoveCommit?.(board);
  let success = false;
  if (boosterType === 'HAMMER') {
    const firstCell = picked ? getShape(picked.shapeId).cells[0] : null;
    const targetR = picked && firstCell ? picked.row + firstCell[0] : row;
    const targetC = picked && firstCell ? picked.col + firstCell[1] : col;
    success = (applyBoosterHammer as (b: BoardState, r: number, c: number, id?: number | null) => boolean)(
      board,
      targetR,
      targetC,
      picked ? picked.id : null
    );
  } else if (boosterType === 'ROCKET') {
    success = applyBoosterRocket(board, row, col, rocketAxis);
  } else if (boosterType === 'VACUUM' && pickedColor && pickedColor > 0) {
    success = applyBoosterVacuum(board, pickedColor);
  }

  if (success) {
    callbacks.sound?.playBooster(boosterType);
  }
  setInputMode('DRAG');
  callbacks.onBoardChanged?.();
}

export function buildCommittedMoveTrace(
  board: BoardState,
  shapeId: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  colorId: ColorId,
  shredGateIndex: number,
  rawWaypoints?: ReadonlyArray<PathWaypoint>
): CommittedPathTraceInfo | null {
  // Only emit a confirmation flourish when the piece actually shredded/peeled into a gate
  // OR locked into a final cell strictly different from its original starting cell
  if (shredGateIndex < 0 && startRow === endRow && startCol === endCol) {
    return null;
  }
  const shape = getShape(shapeId);
  const off = { x: shape.cols * 0.5, y: shape.rows * 0.5 };
  const startPt: PathWaypoint = { x: startCol + off.x, y: startRow + off.y };
  const endPt: PathWaypoint = { x: endCol + off.x, y: endRow + off.y };
  let pts: PathWaypoint[] = [startPt];
  if (startRow !== endRow || startCol !== endCol) {
    // Always compute the cleanest shortest obstacle-respecting corridor from Origin -> Final Destination
    // (using rawWaypoints only as a tie-breaker when two equal-length corridors wrap around an island),
    // so exploratory detours or mid-drag backtracking never clutter the confirmation flourish.
    const visitedHint = new Set<number>();
    if (rawWaypoints) {
      for (const wp of rawWaypoints) {
        visitedHint.add(Math.round(wp.y - off.y) * 32 + Math.round(wp.x - off.x));
      }
    }
    const anchorCell = shape.cells[0] ?? [0, 0];
    const er = endRow + anchorCell[0];
    const ec = endCol + anchorCell[1];
    const endBlockId =
      er >= 0 && er < board.rows && ec >= 0 && ec < board.cols ? board.occupancy[er * board.cols + ec] : -999;
    const canOccupy = (r: number, c: number): boolean => {
      for (const [dr, dc] of shape.cells) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= board.rows || cc < 0 || cc >= board.cols) return false;
        const occ = board.occupancy[rr * board.cols + cc];
        if (occ !== 0 && occ !== endBlockId) return false;
      }
      return true;
    };
    const parent = new Map<number, number>();
    const startKey = startRow * 32 + startCol;
    const goalKey = endRow * 32 + endCol;
    const q: number[] = [startKey];
    parent.set(startKey, -1);
    const baseDirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    while (q.length > 0) {
      const cur = q.shift() ?? startKey;
      if (cur === goalKey) break;
      const cr = Math.floor(cur / 32);
      const cc = cur % 32;
      const neighbors: number[] = [];
      for (const [dr, dc] of baseDirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        const nk = nr * 32 + nc;
        if (!parent.has(nk) && canOccupy(nr, nc)) {
          neighbors.push(nk);
        }
      }
      neighbors.sort((a, b) => (visitedHint.has(b) ? 1 : 0) - (visitedHint.has(a) ? 1 : 0));
      for (const nk of neighbors) {
        parent.set(nk, cur);
        q.push(nk);
      }
    }
    if (parent.has(goalKey)) {
      const revCells: Array<{ r: number; c: number }> = [];
      let cur = goalKey;
      while (cur !== -1) {
        revCells.push({ r: Math.floor(cur / 32), c: cur % 32 });
        cur = parent.get(cur) ?? -1;
      }
      const gridCells = revCells.reverse();
      // Obstacle-safe swept diagonal string-pulling: collapse orthogonal stair-steps into smooth
      // diagonal glides whenever the block's swept footprint clears all intermediate grid cells.
      const canSweepDirect = (ra: number, ca: number, rb: number, cb: number): boolean => {
        const steps = Math.max(Math.abs(rb - ra), Math.abs(cb - ca)) * 4;
        for (let s = 1; s < steps; s++) {
          const rf = ra + ((rb - ra) * s) / steps;
          const cf = ca + ((cb - ca) * s) / steps;
          const r0 = Math.floor(rf + 1e-5);
          const r1 = Math.ceil(rf - 1e-5);
          const c0 = Math.floor(cf + 1e-5);
          const c1 = Math.ceil(cf - 1e-5);
          if (!canOccupy(r0, c0) || !canOccupy(r0, c1) || !canOccupy(r1, c0) || !canOccupy(r1, c1)) {
            return false;
          }
        }
        return true;
      };
      pts = [{ x: gridCells[0].c + off.x, y: gridCells[0].r + off.y }];
      let idx = 0;
      while (idx < gridCells.length - 1) {
        let nextIdx = idx + 1;
        for (let probe = gridCells.length - 1; probe > idx + 1; probe--) {
          if (canSweepDirect(gridCells[idx].r, gridCells[idx].c, gridCells[probe].r, gridCells[probe].c)) {
            nextIdx = probe;
            break;
          }
        }
        pts.push({ x: gridCells[nextIdx].c + off.x, y: gridCells[nextIdx].r + off.y });
        idx = nextIdx;
      }
    } else if (rawWaypoints && rawWaypoints.length >= 2) {
      pts = rawWaypoints.slice();
      pts[0] = startPt;
    } else {
      pts = [startPt, { x: endPt.x, y: startPt.y }, endPt];
    }
  }

  const lastRecorded = pts[pts.length - 1];
  if (Math.hypot(endPt.x - lastRecorded.x, endPt.y - lastRecorded.y) >= 0.08) {
    pts.push(endPt);
  } else {
    pts[pts.length - 1] = endPt;
  }

  const intoGate = Boolean(shredGateIndex >= 0 && board.gates[shredGateIndex]);
  if (intoGate) {
    const [nx, ny] = getGateOutwardNormal(board.gates[shredGateIndex].edge);
    if (pts.length === 1 || Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) < 0.12) {
      pts[0] = { x: startPt.x - nx * 0.18, y: startPt.y - ny * 0.18 };
    }
    pts.push({ x: endPt.x + nx * 0.52, y: endPt.y + ny * 0.52 });
  }

  if (pts.length < 2) return null;
  let cellMask = 0;
  for (const [dr, dc] of shape.cells) {
    if (dr >= 0 && dr < 4 && dc >= 0 && dc < 4) {
      cellMask |= 1 << (dr * 4 + dc);
    }
  }
  return {
    waypoints: pts,
    colorId,
    zOffset: 0,
    spanCols: shape.cols,
    spanRows: shape.rows,
    intoGate,
    cellMask,
  };
}

export interface KeyboardStepContext {
  canvas: HTMLElement;
  callbacks: BoardInputCallbacks;
  getInputMode: () => InputMode;
  setInputMode: (mode: InputMode) => void;
  toggleRocketAxis: () => void;
  getHoverPos: () => { row: number; col: number };
  setHoverPos: (row: number, col: number) => void;
  fireRocketAtHover: () => void;
  getSelectedBlockId: () => number | null;
  setSelectedBlockId: (id: number | null) => void;
  emitHoverState: () => void;
}

export function handleBoardKeyDown(e: KeyboardEvent, ctx: KeyboardStepContext): void {
  const {
    canvas,
    callbacks,
    getInputMode,
    setInputMode,
    toggleRocketAxis,
    getHoverPos,
    setHoverPos,
    fireRocketAtHover,
    getSelectedBlockId,
    setSelectedBlockId,
    emitHoverState,
  } = ctx;
  const inputMode = getInputMode();
  if (callbacks.isBoardInteractive && !callbacks.isBoardInteractive()) {
    return;
  }
  if (canvas.closest?.('[hidden], [inert]')) {
    return;
  }
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }

  const board = callbacks.getBoard();
  const key = e.key;

  if (key === 'Escape' && inputMode !== 'DRAG') {
    e.preventDefault();
    setInputMode('DRAG');
    return;
  }

  if ((key === ' ' || key === 'x' || key === 'X') && inputMode === 'TARGET_ROCKET') {
    e.preventDefault();
    toggleRocketAxis();
    return;
  }

  if (key === 'Enter' && inputMode === 'TARGET_ROCKET') {
    const cur = getHoverPos();
    if (cur.row >= 0 && cur.col >= 0) {
      e.preventDefault();
      fireRocketAtHover();
    }
    return;
  }

  // Tab / Shift+Tab: Cycle movable blocks
  if (key === 'Tab') {
    const movable = board.blocks.filter((b) => b.status === 'ACTIVE' && isBlockMovable(board, b.id));
    if (movable.length === 0) return;
    e.preventDefault();

    movable.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
    const curIdx = movable.findIndex((b) => b.id === getSelectedBlockId());
    const dir = e.shiftKey ? -1 : 1;
    const nextIdx = curIdx === -1 ? 0 : (curIdx + dir + movable.length) % movable.length;
    setSelectedBlockId(movable[nextIdx].id);
    callbacks.sound?.playPickup();
    emitHoverState();
    callbacks.onBoardChanged?.();
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      callbacks.onShortcutAction?.('UNDO');
    }
    return;
  }

  // Arrow keys / WASD: Step selected block 1 cell
  let dRow = 0;
  let dCol = 0;
  if (key === 'ArrowUp' || key === 'w' || key === 'W') dRow = -1;
  else if (key === 'ArrowDown' || key === 's' || key === 'S') dRow = 1;
  else if (key === 'ArrowLeft' || key === 'a' || key === 'A') dCol = -1;
  else if (key === 'ArrowRight' || key === 'd' || key === 'D') dCol = 1;

  if (dRow !== 0 || dCol !== 0) {
    e.preventDefault();
    if (inputMode === 'TARGET_ROCKET') {
      const cur = getHoverPos();
      const baseR = cur.row >= 0 ? cur.row : Math.floor(board.rows * 0.5);
      const baseC = cur.col >= 0 ? cur.col : Math.floor(board.cols * 0.5);
      const nextR = cur.row < 0 ? baseR : Math.max(0, Math.min(board.rows - 1, baseR + dRow));
      const nextC = cur.col < 0 ? baseC : Math.max(0, Math.min(board.cols - 1, baseC + dCol));
      setHoverPos(nextR, nextC);
      callbacks.sound?.playSlideTick();
      emitHoverState();
      return;
    }
    if (inputMode !== 'DRAG') {
      return;
    }
    let block = board.blocks.find(
      (b) => b.id === getSelectedBlockId() && b.status === 'ACTIVE' && isBlockMovable(board, b.id)
    );
    if (!block) {
      block = board.blocks.find((b) => b.status === 'ACTIVE' && isBlockMovable(board, b.id));
      if (block) setSelectedBlockId(block.id);
    }
    if (!block) return;

    const preRow = block.row;
    const preCol = block.col;
    const preShapeId = block.shapeId;
    const preColor = getActiveColor(block.colorStack, block.colorCursor);
    callbacks.onBeforeMoveCommit?.(board);
    const group = getMovedGroupBlocks(board, block.id);
    let targetRow = block.row + dRow;
    let targetCol = block.col + dCol;
    if (!canGroupOccupyOffset(board, group, dRow, dCol)) {
      // Check if pressing the arrow key outward at the board edge clears a gate (`DRAG-05`)
      for (const member of group) {
        const gIdx = findEligibleGateForBlockAt(board, member, member.row, member.col, dCol, dRow);
        if (gIdx >= 0 && board.gates[gIdx]) {
          const [nx, ny] = getGateOutwardNormal(board.gates[gIdx].edge);
          if (dCol * nx + dRow * ny > 0) {
            targetRow = block.row;
            targetCol = block.col;
            break;
          }
        }
      }
    }
    const outcome = commitBlockMove(
      board,
      block.id,
      targetRow,
      targetCol,
      callbacks.getPlayMode(),
      dCol,
      dRow
    );
    if (outcome.moved) {
      playOutcomeAudioHelper(callbacks.sound, outcome);
      const afterBlk = board.blocks.find((b) => b.id === block.id);
      const endR = afterBlk ? afterBlk.row : targetRow;
      const endC = afterBlk ? afterBlk.col : targetCol;
      const gateIdx = afterBlk ? afterBlk.shredGateIndex : -1;
      const trace = buildCommittedMoveTrace(board, preShapeId, preRow, preCol, endR, endC, preColor, gateIdx);
      if (trace) callbacks.onPathTrace?.(trace);
      callbacks.onMoveCommitted?.(outcome);
    } else {
      block.reboundTimerMs = 160;
      callbacks.sound?.playWallClack();
      callbacks.onMoveCommitted?.(outcome);
    }
    emitHoverState();
    callbacks.onBoardChanged?.();
    return;
  }

  // Z: Undo, R: Restart, 1..5: Boosters
  if (key === 'z' || key === 'Z' || key === '1') {
    e.preventDefault();
    callbacks.onShortcutAction?.('UNDO');
  } else if (key === 'r' || key === 'R') {
    e.preventDefault();
    callbacks.onShortcutAction?.('RESTART');
  } else if (key === '2') {
    e.preventDefault();
    callbacks.onShortcutAction?.('HINT');
  } else if (key === '3') {
    e.preventDefault();
    callbacks.onShortcutAction?.('HAMMER');
  } else if (key === '4') {
    e.preventDefault();
    callbacks.onShortcutAction?.('ROCKET');
  } else if (key === '5') {
    e.preventDefault();
    callbacks.onShortcutAction?.('VACUUM');
  }
}
