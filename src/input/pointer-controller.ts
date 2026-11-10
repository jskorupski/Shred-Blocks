import { SoundEngine } from '../audio/synth';
import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  commitBlockMove,
  type CommitMoveOutcome,
} from '../core/board';
import {
  checkMidDragGateCapture,
  findEligibleGateForBlockAt,
  getGateOutwardNormal,
} from '../core/gate-clearance';
import {
  canGroupOccupyOffset,
  getMovedGroupBlocks,
  isBlockInLockedRoom,
  isBlockMovable,
  rebuildOccupancyGrid,
  snapGroupToNearestGrid,
  sweepBlockToTarget,
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
export function pickBlockAtBoardPoint(
  board: BoardState,
  boardX: number,
  boardY: number
): BlockState | null {
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

export class BoardInputController {
  private readonly canvas: HTMLElement;
  private readonly callbacks: BoardInputCallbacks;

  private activePointerId: number | null = null;
  private activeBlockId: number | null = null;
  private selectedBlockId: number | null = null;

  private inputMode: InputMode = 'DRAG';
  private rocketAxis: RocketAxis = 'ROW';
  private hoverRow = -1;
  private hoverCol = -1;
  private hoverBlockId: number | null = null;

  private grabOffsetX = 0;
  private grabOffsetY = 0;
  private lastLeadX = 0;
  private lastLeadY = 0;
  private lastVelX = 0;
  private lastVelY = 0;
  private lastPullX = 0;
  private lastPullY = 0;
  private lastTickCellCol = 0;
  private lastTickCellRow = 0;
  private groupStartCoords = new Map<number, { row: number; col: number }>();

  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerMoveBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: (e: PointerEvent) => void;
  private readonly onPointerCancelBound: (e: PointerEvent) => void;
  private readonly onBlurBound: () => void;
  private readonly onVisibilityChangeBound: () => void;
  private readonly onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLElement, callbacks: BoardInputCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.onPointerDownBound = (e) => this.handlePointerDown(e);
    this.onPointerMoveBound = (e) => this.handlePointerMove(e);
    this.onPointerUpBound = (e) => this.handlePointerUp(e);
    this.onPointerCancelBound = (e) => this.handlePointerCancel(e);
    this.onBlurBound = () => this.cancelActiveDrag();
    this.onVisibilityChangeBound = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        this.cancelActiveDrag();
      }
    };
    this.onKeyDownBound = (e) => this.handleKeyDown(e);

    this.attach();
  }

  public attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.addEventListener('pointermove', this.onPointerMoveBound);
    this.canvas.addEventListener('pointerup', this.onPointerUpBound);
    this.canvas.addEventListener('pointercancel', this.onPointerCancelBound);
    this.canvas.addEventListener('lostpointercapture', this.onPointerCancelBound);

    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.onBlurBound);
      window.addEventListener('keydown', this.onKeyDownBound);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChangeBound);
    }
  }

  public destroy(): void {
    this.cancelActiveDrag();
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.removeEventListener('pointermove', this.onPointerMoveBound);
    this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancelBound);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancelBound);

    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.onBlurBound);
      window.removeEventListener('keydown', this.onKeyDownBound);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
    }
  }

  public getInputMode(): InputMode {
    return this.inputMode;
  }

  public setInputMode(mode: InputMode): void {
    if (this.inputMode === mode) return;
    if (mode !== 'DRAG') {
      this.cancelActiveDrag();
    }
    this.inputMode = mode;
    this.emitHoverState();
  }

  public cancelTargeting(): void {
    this.setInputMode('DRAG');
  }

  public getRocketAxis(): RocketAxis {
    return this.rocketAxis;
  }

  public setRocketAxis(axis: RocketAxis): void {
    this.rocketAxis = axis;
    this.emitHoverState();
  }

  public toggleRocketAxis(): RocketAxis {
    this.rocketAxis = this.rocketAxis === 'ROW' ? 'COL' : 'ROW';
    this.emitHoverState();
    return this.rocketAxis;
  }

  public getSelectedBlockId(): number | null {
    return this.selectedBlockId;
  }

  public setSelectedBlockId(blockId: number | null): void {
    this.selectedBlockId = blockId;
    this.emitHoverState();
  }

  public getActiveBlockId(): number | null {
    return this.activeBlockId;
  }

  public getHoverState(): HoverState {
    return {
      inputMode: this.inputMode,
      hoverRow: this.hoverRow,
      hoverCol: this.hoverCol,
      hoverBlockId: this.hoverBlockId,
      rocketAxis: this.rocketAxis,
      selectedBlockId: this.selectedBlockId,
      activeBlockId: this.activeBlockId,
    };
  }

  private emitHoverState(): void {
    this.callbacks.onHoverChanged?.(this.getHoverState());
  }

  private clientToBoardCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    if (this.callbacks.screenToBoard) {
      return this.callbacks.screenToBoard(clientX, clientY);
    }

    const board = this.callbacks.getBoard();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    // Default orthographic board projection with 12% gate frame margin
    const marginRatio = 0.12;
    const availW = rect.width * (1 - 2 * marginRatio);
    const availH = rect.height * (1 - 2 * marginRatio);
    const cellPx = Math.min(availW / board.cols, availH / board.rows);

    const gridW = cellPx * board.cols;
    const gridH = cellPx * board.rows;
    const originX = rect.left + (rect.width - gridW) * 0.5;
    const originY = rect.top + (rect.height - gridH) * 0.5;

    return {
      x: (clientX - originX) / cellPx,
      y: (clientY - originY) / cellPx,
    };
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // UX-08 Single-Pointer Lock: ignore secondary pointers while a drag is active
    if (this.activePointerId !== null) return;

    const pt = this.clientToBoardCoords(e.clientX, e.clientY);
    if (!pt) return;

    const board = this.callbacks.getBoard();

    // Handle Booster Targeting Modes (UX-04)
    if (this.inputMode !== 'DRAG') {
      this.handleBoosterTargetTap(board, pt.x, pt.y);
      return;
    }

    const picked = pickBlockAtBoardPoint(board, pt.x, pt.y);
    if (!picked) {
      return;
    }

    // Immobile Block Shake Feedback (Stone, Frozen, Chained, Roped)
    if (!isBlockMovable(board, picked.id)) {
      const group = getMovedGroupBlocks(board, picked.id);
      const targets = group.length > 0 ? group : [picked];
      for (const b of targets) {
        b.reboundTimerMs = 240;
      }
      this.callbacks.sound?.playWallClack();
      this.callbacks.onImmobileBlockTap?.(picked);
      this.callbacks.onBoardChanged?.();
      return;
    }

    // Start dragging the movable block (and its glued group)
    this.activePointerId = e.pointerId;
    this.activeBlockId = picked.id;
    this.selectedBlockId = picked.id;

    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore if synthetic event in test environment
    }

    this.grabOffsetX = pt.x - picked.x;
    this.grabOffsetY = pt.y - picked.y;
    this.lastLeadX = picked.x;
    this.lastLeadY = picked.y;
    this.lastVelX = 0;
    this.lastVelY = 0;
    this.lastPullX = 0;
    this.lastPullY = 0;
    this.lastTickCellCol = Math.round(picked.x);
    this.lastTickCellRow = Math.round(picked.y);

    this.groupStartCoords.clear();
    const group = getMovedGroupBlocks(board, picked.id);
    for (const b of group) {
      this.groupStartCoords.set(b.id, { row: b.row, col: b.col });
      b.liftAlpha = 1;
      b.reboundTimerMs = 0;
    }

    this.callbacks.sound?.playPickup();
    this.emitHoverState();
    this.callbacks.onBoardChanged?.();
  }

  private handlePointerMove(e: PointerEvent): void {
    const board = this.callbacks.getBoard();

    // Update hover preview when not actively dragging
    if (this.activePointerId === null || this.inputMode !== 'DRAG') {
      const pt = this.clientToBoardCoords(e.clientX, e.clientY);
      if (pt) {
        const r = Math.floor(pt.y);
        const c = Math.floor(pt.x);
        const inBounds = r >= 0 && r < board.rows && c >= 0 && c < board.cols;
        const nextRow = inBounds ? r : -1;
        const nextCol = inBounds ? c : -1;
        const picked = inBounds ? pickBlockAtBoardPoint(board, pt.x, pt.y) : null;
        const nextBlockId = picked ? picked.id : null;

        if (
          nextRow !== this.hoverRow ||
          nextCol !== this.hoverCol ||
          nextBlockId !== this.hoverBlockId
        ) {
          this.hoverRow = nextRow;
          this.hoverCol = nextCol;
          this.hoverBlockId = nextBlockId;
          this.emitHoverState();
        }
      }
      return;
    }

    // UX-08: Ignore secondary fingers
    if (e.pointerId !== this.activePointerId || this.activeBlockId === null) {
      return;
    }

    // PERF-02: Sample at most 3 coalesced events + final pointer position
    const samples: Array<{ clientX: number; clientY: number }> = [];
    if (typeof e.getCoalescedEvents === 'function') {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 0) {
        const maxCoalesced = Math.min(3, coalesced.length);
        for (let i = 0; i < maxCoalesced; i++) {
          const idx = Math.floor(((i + 1) * coalesced.length) / (maxCoalesced + 1));
          const ce = coalesced[idx];
          if (ce) {
            samples.push({ clientX: ce.clientX, clientY: ce.clientY });
          }
        }
      }
    }
    samples.push({ clientX: e.clientX, clientY: e.clientY });

    const blockId = this.activeBlockId;

    for (const sample of samples) {
      const pt = this.clientToBoardCoords(sample.clientX, sample.clientY);
      if (!pt) continue;

      const targetX = pt.x - this.grabOffsetX;
      const targetY = pt.y - this.grabOffsetY;

      const sweepRes = sweepBlockToTarget(
        board,
        blockId,
        targetX,
        targetY,
        (leadX, leadY, stepVecX, stepVecY) => {
          const cellC = Math.round(leadX);
          const cellR = Math.round(leadY);
          if (cellC !== this.lastTickCellCol || cellR !== this.lastTickCellRow) {
            this.lastTickCellCol = cellC;
            this.lastTickCellRow = cellR;
            this.callbacks.sound?.playSlideTick();
          }

          const capture = checkMidDragGateCapture(
            board,
            blockId,
            stepVecX,
            stepVecY,
            targetX - leadX,
            targetY - leadY
          );
          return capture ? capture.gateIndex : -1;
        }
      );

      const dx = sweepRes.leadX - this.lastLeadX;
      const dy = sweepRes.leadY - this.lastLeadY;
      if (Math.hypot(dx, dy) > 1e-4) {
        this.lastVelX = dx;
        this.lastVelY = dy;
      }
      this.lastPullX = targetX - sweepRes.leadX;
      this.lastPullY = targetY - sweepRes.leadY;
      this.lastLeadX = sweepRes.leadX;
      this.lastLeadY = sweepRes.leadY;

      // F-01: Immediate Mid-Drag Gate Capture
      if (sweepRes.capturedGateIndex >= 0) {
        this.finalizeDragMove(board, blockId, true);
        return;
      }
    }

    this.callbacks.onBoardChanged?.();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.activePointerId === null || e.pointerId !== this.activePointerId) return;

    const board = this.callbacks.getBoard();
    const blockId = this.activeBlockId;

    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore
    }

    if (blockId !== null) {
      this.finalizeDragMove(board, blockId, false);
    } else {
      this.activePointerId = null;
      this.emitHoverState();
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.activePointerId === null || e.pointerId !== this.activePointerId) return;
    this.cancelActiveDrag();
  }

  /**
   * Snaps the active dragged group to the nearest valid grid cell and commits the move
   * if the block changed cells or was captured by an exit gate.
   */
  private finalizeDragMove(board: BoardState, blockId: number, capturedMidDrag: boolean): void {
    const group = getMovedGroupBlocks(board, blockId);
    const lead = group.find((b) => b.id === blockId) ?? group[0];

    for (const b of group) {
      b.liftAlpha = 0;
    }

    // Use snapGroupToNearestGrid to determine the exact valid integer (snappedRow, snappedCol)
    snapGroupToNearestGrid(board, blockId);
    const snappedRow = lead ? lead.row : 0;
    const snappedCol = lead ? lead.col : 0;

    // Restore group blocks to their starting integer coordinates before commitBlockMove
    // so Undo snapshots see the clean pre-drag state and commitBlockMove sees true dRow/dCol.
    let changedFromStart = capturedMidDrag;
    for (const b of group) {
      const start = this.groupStartCoords.get(b.id);
      if (start) {
        if (b.row !== start.row || b.col !== start.col) {
          changedFromStart = true;
        }
        b.row = start.row;
        b.col = start.col;
        b.x = start.col;
        b.y = start.row;
      }
    }
    rebuildOccupancyGrid(board);

    this.activePointerId = null;
    this.activeBlockId = null;
    this.groupStartCoords.clear();

    const effVelX =
      Math.hypot(this.lastVelX, this.lastVelY) > 1e-4 ? this.lastVelX : this.lastPullX;
    const effVelY =
      Math.hypot(this.lastVelX, this.lastVelY) > 1e-4 ? this.lastVelY : this.lastPullY;

    // If a boundary-aligned block was pulled outward toward an eligible gate without changing integer cells,
    // allow commitBlockMove to evaluate the outward exit (`DRAG-03`).
    if (!changedFromStart && Math.hypot(this.lastPullX, this.lastPullY) >= 0.08) {
      for (const b of group) {
        const gIdx = findEligibleGateForBlockAt(board, b, b.row, b.col, effVelX, effVelY);
        if (gIdx >= 0 && board.gates[gIdx]) {
          const [nx, ny] = getGateOutwardNormal(board.gates[gIdx].edge);
          if (this.lastPullX * nx + this.lastPullY * ny >= 0.06) {
            changedFromStart = true;
            break;
          }
        }
      }
    }

    if (lead && (changedFromStart || capturedMidDrag)) {
      this.callbacks.onBeforeMoveCommit?.(board);
      const outcome = commitBlockMove(
        board,
        blockId,
        snappedRow,
        snappedCol,
        this.callbacks.getPlayMode(),
        effVelX,
        effVelY
      );
      this.playOutcomeAudio(outcome);
      this.emitHoverState();
      this.callbacks.onMoveCommitted?.(outcome);
      this.callbacks.onBoardChanged?.();
    } else {
      this.callbacks.sound?.playSnap();
      this.emitHoverState();
      this.callbacks.onBoardChanged?.();
    }
  }

  public cancelActiveDrag(): void {
    if (this.activeBlockId !== null) {
      const board = this.callbacks.getBoard();
      const group = getMovedGroupBlocks(board, this.activeBlockId);
      for (const b of group) {
        const start = this.groupStartCoords.get(b.id);
        if (start) {
          b.row = start.row;
          b.col = start.col;
          b.x = start.col;
          b.y = start.row;
        } else {
          b.x = b.col;
          b.y = b.row;
        }
        b.liftAlpha = 0;
      }
      rebuildOccupancyGrid(board);
    }

    this.activePointerId = null;
    this.activeBlockId = null;
    this.groupStartCoords.clear();
    this.emitHoverState();
    this.callbacks.onBoardChanged?.();
  }

  private handleBoosterTargetTap(board: BoardState, boardX: number, boardY: number): void {
    const row = Math.floor(boardY);
    const col = Math.floor(boardX);

    // Tapping outside the board cancels targeting without spending the booster
    // (Allow Hammer to tap 1 cell outside the board rim to shatter Iced/Shutter Gates)
    const minCoord = this.inputMode === 'TARGET_HAMMER' ? -1 : 0;
    const maxRow = this.inputMode === 'TARGET_HAMMER' ? board.rows : board.rows - 1;
    const maxCol = this.inputMode === 'TARGET_HAMMER' ? board.cols : board.cols - 1;
    if (row < minCoord || row > maxRow || col < minCoord || col > maxCol) {
      this.setInputMode('DRAG');
      return;
    }

    const inBounds = row >= 0 && row < board.rows && col >= 0 && col < board.cols;
    const cellOcc = inBounds ? board.occupancy[row * board.cols + col] : -1;
    const isDirectNonBlockHammerCell =
      this.inputMode === 'TARGET_HAMMER' &&
      (!inBounds || cellOcc === -1 || cellOcc === -3 || cellOcc <= -100);

    const rawPicked = isDirectNonBlockHammerCell ? null : pickBlockAtBoardPoint(board, boardX, boardY);
    const picked = rawPicked && !isBlockInLockedRoom(board, rawPicked) ? rawPicked : null;
    if (
      this.inputMode === 'TARGET_VACUUM' &&
      (!picked || picked.iceCount > 0 || picked.chained || picked.ropeColor > 0)
    ) {
      this.setInputMode('DRAG');
      return;
    }
    const pickedColor = picked ? getActiveColor(picked.colorStack, picked.colorCursor) : null;

    const payload: BoosterTargetPayload = {
      row,
      col,
      blockId: picked ? picked.id : null,
      color: pickedColor,
      axis: this.rocketAxis,
    };

    let boosterType: BoosterType = 'HAMMER';
    if (this.inputMode === 'TARGET_ROCKET') boosterType = 'ROCKET';
    if (this.inputMode === 'TARGET_VACUUM') boosterType = 'VACUUM';

    if (this.callbacks.onExecuteBooster) {
      const executed = this.callbacks.onExecuteBooster(boosterType, payload);
      if (executed) {
        this.callbacks.sound?.playBooster(boosterType);
        this.setInputMode('DRAG');
        this.callbacks.onBoardChanged?.();
      } else {
        // Invalid target tapped -> cancel targeting without spending booster
        this.setInputMode('DRAG');
      }
      return;
    }

    // Fallback direct booster execution if no custom callback was provided
    this.callbacks.onBeforeMoveCommit?.(board);
    let success = false;
    if (boosterType === 'HAMMER') {
      const firstCell = picked ? getShape(picked.shapeId).cells[0] : null;
      const targetR = picked && firstCell ? picked.row + firstCell[0] : row;
      const targetC = picked && firstCell ? picked.col + firstCell[1] : col;
      success = (
        applyBoosterHammer as (b: BoardState, r: number, c: number, id?: number | null) => boolean
      )(board, targetR, targetC, picked ? picked.id : null);
    } else if (boosterType === 'ROCKET') {
      success = applyBoosterRocket(board, row, col, this.rocketAxis);
    } else if (boosterType === 'VACUUM' && pickedColor && pickedColor > 0) {
      success = applyBoosterVacuum(board, pickedColor);
    }

    if (success) {
      this.callbacks.sound?.playBooster(boosterType);
    }
    this.setInputMode('DRAG');
    this.callbacks.onBoardChanged?.();
  }

  private playOutcomeAudio(outcome: CommitMoveOutcome): void {
    const sound = this.callbacks.sound;
    if (!sound) return;

    if (outcome.clearedBlockIds.length > 0) {
      outcome.clearedBlockIds.forEach((_, idx) => sound.playShred(idx));
    } else if (outcome.peeledBlockIds.length > 0) {
      sound.playLayerPeel();
    } else if (outcome.moved) {
      sound.playSnap();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.callbacks.isBoardInteractive && !this.callbacks.isBoardInteractive()) {
      return;
    }
    if (this.canvas.closest?.('[hidden], [inert]')) {
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

    const board = this.callbacks.getBoard();
    const key = e.key;

    if (key === 'Escape' && this.inputMode !== 'DRAG') {
      e.preventDefault();
      this.setInputMode('DRAG');
      return;
    }

    if ((key === ' ' || key === 'x' || key === 'X') && this.inputMode === 'TARGET_ROCKET') {
      e.preventDefault();
      this.toggleRocketAxis();
      return;
    }

    // Tab / Shift+Tab: Cycle movable blocks
    if (key === 'Tab') {
      const movable = board.blocks.filter(
        (b) => b.status === 'ACTIVE' && isBlockMovable(board, b.id)
      );
      if (movable.length === 0) return;
      e.preventDefault();

      movable.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
      const curIdx = movable.findIndex((b) => b.id === this.selectedBlockId);
      const dir = e.shiftKey ? -1 : 1;
      const nextIdx =
        curIdx === -1 ? 0 : (curIdx + dir + movable.length) % movable.length;
      this.selectedBlockId = movable[nextIdx].id;
      this.callbacks.sound?.playPickup();
      this.emitHoverState();
      this.callbacks.onBoardChanged?.();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'Z')) {
        e.preventDefault();
        this.callbacks.onShortcutAction?.('UNDO');
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
        (b) => b.id === this.selectedBlockId && b.status === 'ACTIVE' && isBlockMovable(board, b.id)
      );
      if (!block) {
        block = board.blocks.find((b) => b.status === 'ACTIVE' && isBlockMovable(board, b.id));
        if (block) this.selectedBlockId = block.id;
      }
      if (!block) return;

      this.callbacks.onBeforeMoveCommit?.(board);
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
        this.callbacks.getPlayMode(),
        dCol,
        dRow
      );
      if (outcome.moved) {
        this.playOutcomeAudio(outcome);
        this.callbacks.onMoveCommitted?.(outcome);
      } else {
        block.reboundTimerMs = 160;
        this.callbacks.sound?.playWallClack();
        this.callbacks.onMoveCommitted?.(outcome);
      }
      this.emitHoverState();
      this.callbacks.onBoardChanged?.();
      return;
    }

    // Z: Undo, R: Restart, 1..5: Boosters
    if (key === 'z' || key === 'Z' || key === '1') {
      e.preventDefault();
      this.callbacks.onShortcutAction?.('UNDO');
    } else if (key === 'r' || key === 'R') {
      e.preventDefault();
      this.callbacks.onShortcutAction?.('RESTART');
    } else if (key === '2') {
      e.preventDefault();
      this.callbacks.onShortcutAction?.('FREEZE');
    } else if (key === '3') {
      e.preventDefault();
      this.callbacks.onShortcutAction?.('HAMMER');
    } else if (key === '4') {
      e.preventDefault();
      this.callbacks.onShortcutAction?.('ROCKET');
    } else if (key === '5') {
      e.preventDefault();
      this.callbacks.onShortcutAction?.('VACUUM');
    }
  }
}
