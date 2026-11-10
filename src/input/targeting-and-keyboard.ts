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
  isBlockInLockedRoom,
  isBlockMovable,
} from '../core/physics';
import { getActiveColor, getShape } from '../core/polyomino';
import type {
  BlockState,
  BoardState,
  BoosterType,
  ColorId,
  InputMode,
  PlayMode,
  RocketAxis,
} from '../core/types';

export const HIT_SLOP_HALO = 0.32;
export const MONO_PRIORITY_WEIGHT = 1.3;

export interface BoosterTargetPayload {
  row: number;
  col: number;
  blockId: number | null;
  color: ColorId | null;
  axis: RocketAxis;
}

export interface HoverState {
  inputMode: InputMode;
  hoverRow: number;
  hoverCol: number;
  hoverBlockId: number | null;
  rocketAxis: RocketAxis;
  selectedBlockId: number | null;
  activeBlockId: number | null;
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
  /** Called when a player taps an immobile block (Stone, Frozen, Chained, Roped) */
  onImmobileBlockTap?: (block: BlockState) => void;
  /** Called when a targeted booster (Hammer, Rocket, Vacuum) is executed on a valid target */
  onExecuteBooster?: (type: BoosterType, target: BoosterTargetPayload) => boolean;
  /** Called when a keyboard shortcut triggers a quick action or booster slot 1..5 */
  onShortcutAction?: (action: 'UNDO' | 'RESTART' | 'FREEZE' | 'HAMMER' | 'ROCKET' | 'VACUUM') => void;
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

export interface KeyboardStepContext {
  canvas: HTMLElement;
  callbacks: BoardInputCallbacks;
  getInputMode: () => InputMode;
  setInputMode: (mode: InputMode) => void;
  toggleRocketAxis: () => void;
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
    let block = board.blocks.find(
      (b) => b.id === getSelectedBlockId() && b.status === 'ACTIVE' && isBlockMovable(board, b.id)
    );
    if (!block) {
      block = board.blocks.find((b) => b.status === 'ACTIVE' && isBlockMovable(board, b.id));
      if (block) setSelectedBlockId(block.id);
    }
    if (!block) return;

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
    callbacks.onShortcutAction?.('FREEZE');
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
