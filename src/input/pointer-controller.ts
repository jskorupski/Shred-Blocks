import {
  commitBlockMove,
  type CommitMoveOutcome,
} from "../core/board";
import {
  checkMidDragGateCapture,
  findEligibleGateForBlockAt,
  getGateOutwardNormal,
} from "../core/gate-clearance";
import {
  getMovedGroupBlocks,
  isBlockMovable,
  rebuildOccupancyGrid,
  snapGroupToNearestGrid,
  sweepBlockToTarget,
} from '../core/physics';
import type {
  BoardState,
  InputMode,
  RocketAxis,
} from "../core/types";
import {
  executeBoosterTargetTap,
  handleBoardKeyDown,
  pickBlockAtBoardPoint,
  playOutcomeAudioHelper,
  type BoardInputCallbacks,
  type HoverState,
} from "./targeting-and-keyboard";

export * from "./targeting-and-keyboard";

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
    executeBoosterTargetTap(
      board,
      boardX,
      boardY,
      this.inputMode,
      this.rocketAxis,
      this.callbacks,
      (mode) => this.setInputMode(mode)
    );
  }

  private playOutcomeAudio(outcome: CommitMoveOutcome): void {
    playOutcomeAudioHelper(this.callbacks.sound, outcome);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    handleBoardKeyDown(e, {
      canvas: this.canvas,
      callbacks: this.callbacks,
      getInputMode: () => this.inputMode,
      setInputMode: (mode) => this.setInputMode(mode),
      toggleRocketAxis: () => this.toggleRocketAxis(),
      getSelectedBlockId: () => this.selectedBlockId,
      setSelectedBlockId: (id) => {
        this.selectedBlockId = id;
      },
      emitHoverState: () => this.emitHoverState(),
    });
  }
}
