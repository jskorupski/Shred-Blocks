import { type CommitMoveOutcome, commitBlockMove } from '../core/board';
import {
  checkMidDragGateCapture,
  findEligibleGateForBlockAt,
  getGateOutwardNormal,
} from '../core/gate-clearance';
import {
  canGroupOccupyOffset,
  getMovedGroupBlocks,
  getSealedVaultAtCell,
  isBlockMovable,
  rebuildOccupancyGrid,
  snapGroupToNearestGrid,
  sweepBlockToTarget,
} from '../core/physics';
import { getActiveColor, getShape } from '../core/polyomino';
import type { BoardState, InputMode, RocketAxis } from '../core/types';
import type { PathWaypoint } from '../render/pass2-drag-fx';
import {
  type BoardInputCallbacks,
  buildCommittedMoveTrace,
  executeBoosterTargetTap,
  type HoverState,
  handleBoardKeyDown,
  pickBlockAtBoardPoint,
  playOutcomeAudioHelper,
} from './targeting-and-keyboard';

export * from './targeting-and-keyboard';

export class BoardInputController {
  private readonly canvas: HTMLElement;
  private readonly callbacks: BoardInputCallbacks;

  private activePointerId: number | null = null;
  private targetingPointerId: number | null = null;
  private activeBlockId: number | null = null;
  private selectedBlockId: number | null = null;
  private dragBoardRef: BoardState | null = null;

  private inputMode: InputMode = 'DRAG';
  private rocketAxis: RocketAxis = 'ROW';
  private hoverRow = -1;
  private hoverCol = -1;
  private hoverBlockId: number | null = null;
  private dragLeftOrigin = false;
  private dragWaypoints: PathWaypoint[] = [];

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
  private readonly onPointerLeaveBound: () => void;
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
    this.onPointerLeaveBound = () => this.handlePointerLeave();
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
    this.canvas.addEventListener('pointerleave', this.onPointerLeaveBound);

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
    this.canvas.removeEventListener('pointerleave', this.onPointerLeaveBound);

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
    this.targetingPointerId = null;
    this.hoverRow = -1;
    this.hoverCol = -1;
    this.hoverBlockId = null;
    this.inputMode = mode;
    this.emitHoverState();
  }

  public cancelTargeting(): void {
    if (this.activePointerId !== null || this.activeBlockId !== null || this.targetingPointerId !== null) {
      this.cancelActiveDrag();
    }
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
      dragLeftOrigin: this.dragLeftOrigin,
    };
  }

  private handlePointerLeave(): void {
    if (this.targetingPointerId !== null || this.activePointerId !== null) return;
    if (this.hoverRow !== -1 || this.hoverCol !== -1 || this.hoverBlockId !== null) {
      this.hoverRow = -1;
      this.hoverCol = -1;
      this.hoverBlockId = null;
      this.emitHoverState();
    }
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
    if (this.callbacks.isBoardInteractive && !this.callbacks.isBoardInteractive()) return;

    // UX-08 Single-Pointer Lock: ignore secondary pointers while a drag or Rocket press-aim is active
    if (this.activePointerId !== null || this.targetingPointerId !== null) return;

    const pt = this.clientToBoardCoords(e.clientX, e.clientY);
    if (!pt) return;

    const board = this.callbacks.getBoard();

    // Handle Booster Targeting Modes (UX-04): Rocket supports Press-Slide-to-Aim + Release-to-Fire!
    if (this.inputMode === 'TARGET_ROCKET') {
      const r = Math.floor(pt.y);
      const c = Math.floor(pt.x);
      if (r < 0 || r >= board.rows || c < 0 || c >= board.cols) {
        this.setInputMode('DRAG');
        return;
      }
      this.targetingPointerId = e.pointerId;
      try {
        this.canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore in synthetic test dispatch
      }
      this.hoverRow = r;
      this.hoverCol = c;
      this.hoverBlockId = null;
      this.emitHoverState();
      return;
    }
    if (this.inputMode !== 'DRAG') {
      this.handleBoosterTargetTap(board, pt.x, pt.y);
      return;
    }

    const picked = pickBlockAtBoardPoint(board, pt.x, pt.y);
    if (!picked) {
      const sealedVault = getSealedVaultAtCell(board, Math.floor(pt.y), Math.floor(pt.x));
      if (sealedVault) {
        this.callbacks.sound?.playWallClack();
        this.callbacks.onLockedVaultTap?.(sealedVault);
      }
      return;
    }

    // Immobile Block Shake Feedback (Stone, Frozen, Chained, Roped)
    if (!isBlockMovable(board, picked.id)) {
      const group = getMovedGroupBlocks(board, picked.id);
      const targets = group.length > 0 ? group : [picked];
      for (const b of targets) {
        b.shredGateIndex = -1;
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
    this.dragBoardRef = board;

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
    this.dragLeftOrigin = false;
    const pickedShape = getShape(picked.shapeId);
    this.dragWaypoints = [{ x: picked.col + pickedShape.cols * 0.5, y: picked.row + pickedShape.rows * 0.5 }];
    const group = getMovedGroupBlocks(board, picked.id);
    for (const b of group) {
      this.groupStartCoords.set(b.id, { row: b.row, col: b.col });
      b.liftAlpha = 1;
      b.reboundTimerMs = 0;
    }

    this.callbacks.sound?.playPickup();
    this.emitHoverState();
    if (!this.callbacks.onHoverChanged) {
      this.callbacks.onBoardChanged?.();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const board = this.callbacks.getBoard();

    // Update hover or Rocket slide-aim preview when not actively dragging a block
    if (this.activePointerId === null || this.inputMode !== 'DRAG') {
      if (this.targetingPointerId !== null && e.pointerId !== this.targetingPointerId) {
        return;
      }
      const pt = this.clientToBoardCoords(e.clientX, e.clientY);
      if (pt) {
        const r = Math.floor(pt.y);
        const c = Math.floor(pt.x);
        const inBounds = r >= 0 && r < board.rows && c >= 0 && c < board.cols;
        const nextRow = inBounds ? r : -1;
        const nextCol = inBounds ? c : -1;
        const picked = inBounds ? pickBlockAtBoardPoint(board, pt.x, pt.y) : null;
        const nextBlockId = picked ? picked.id : null;

        if (nextRow !== this.hoverRow || nextCol !== this.hoverCol || nextBlockId !== this.hoverBlockId) {
          const lineChanged =
            this.inputMode === 'TARGET_ROCKET' &&
            this.targetingPointerId !== null &&
            inBounds &&
            (this.rocketAxis === 'ROW' ? nextRow !== this.hoverRow : nextCol !== this.hoverCol);
          this.hoverRow = nextRow;
          this.hoverCol = nextCol;
          this.hoverBlockId = nextBlockId;
          if (lineChanged) {
            this.callbacks.sound?.playSlideTick();
          }
          this.emitHoverState();
        }
      }
      return;
    }

    // UX-08: Ignore secondary fingers; abort if board instance changed mid-drag (MODE-ISOLATION-01)
    if (e.pointerId !== this.activePointerId || this.activeBlockId === null) return;
    if (this.dragBoardRef !== board) {
      this.cancelActiveDrag();
      return;
    }

    // PERF-02: Sample at most 3 coalesced events + final pointer position (deduplicated)
    const samples: Array<{ clientX: number; clientY: number }> = [];
    if (typeof e.getCoalescedEvents === 'function') {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 0) {
        const maxCoalesced = Math.min(3, coalesced.length);
        for (let i = 0; i < maxCoalesced; i++) {
          const idx = Math.floor(((i + 1) * coalesced.length) / (maxCoalesced + 1));
          const ce = coalesced[idx];
          if (
            ce &&
            (samples.length === 0 ||
              samples[samples.length - 1].clientX !== ce.clientX ||
              samples[samples.length - 1].clientY !== ce.clientY)
          ) {
            samples.push({ clientX: ce.clientX, clientY: ce.clientY });
          }
        }
      }
    }
    if (
      samples.length === 0 ||
      samples[samples.length - 1].clientX !== e.clientX ||
      samples[samples.length - 1].clientY !== e.clientY
    ) {
      samples.push({ clientX: e.clientX, clientY: e.clientY });
    }

    const blockId = this.activeBlockId;
    const leadBlockForAnchor = board.blocks.find((b) => b.id === blockId);
    const leadShape = leadBlockForAnchor ? getShape(leadBlockForAnchor.shapeId) : null;
    const anchorOff = leadShape ? { x: leadShape.cols * 0.5, y: leadShape.rows * 0.5 } : { x: 0.5, y: 0.5 };

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
          this.recordDragCellStep(cellR, cellC, anchorOff.x, anchorOff.y);

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

      const startLead = this.groupStartCoords.get(blockId);
      if (
        startLead &&
        (Math.round(sweepRes.leadX) !== startLead.col || Math.round(sweepRes.leadY) !== startLead.row)
      ) {
        this.dragLeftOrigin = true;
      }
      this.recordDragCellStep(
        Math.round(sweepRes.leadY),
        Math.round(sweepRes.leadX),
        anchorOff.x,
        anchorOff.y
      );

      // F-01: Immediate Mid-Drag Gate Capture
      if (sweepRes.capturedGateIndex >= 0) {
        this.finalizeDragMove(board, blockId, true);
        return;
      }
    }

    if (this.callbacks.onDragFrame) this.callbacks.onDragFrame();
    else this.callbacks.onBoardChanged?.();
  }

  /**
   * Records exact integer grid corridor steps with full cycle erasure:
   * - Eliminates sub-pixel finger jitter inside open rooms so path traces stay grid-centered.
   * - Automatically erases any exploratory detour or closed loop if the block revisits an earlier cell
   *   (including returning to its original starting spot), so the post-commit trace cleanly confirms
   *   the net corridor from Origin -> Final Destination / Shred Gate.
   */
  private recordDragCellStep(cellR: number, cellC: number, offX: number, offY: number): void {
    const wx = cellC + offX;
    const wy = cellR + offY;
    for (let i = 0; i < this.dragWaypoints.length; i++) {
      if (Math.abs(this.dragWaypoints[i].x - wx) < 0.05 && Math.abs(this.dragWaypoints[i].y - wy) < 0.05) {
        this.dragWaypoints.length = i + 1;
        return;
      }
    }
    const tail = this.dragWaypoints[this.dragWaypoints.length - 1];
    if (tail) {
      const prevC = Math.round(tail.x - offX);
      const prevR = Math.round(tail.y - offY);
      if (prevC !== cellC && prevR !== cellR) {
        // Orthogonalize a diagonal bevel jump across its shared corner cell
        this.dragWaypoints.push({ x: cellC + offX, y: prevR + offY });
      }
    }
    this.dragWaypoints.push({ x: wx, y: wy });
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.targetingPointerId !== null) {
      if (e.pointerId !== this.targetingPointerId) return;
      this.targetingPointerId = null;
      try {
        this.canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignore
      }
      const pt = this.clientToBoardCoords(e.clientX, e.clientY);
      const board = this.callbacks.getBoard();
      if (!pt) {
        this.setInputMode('DRAG');
        return;
      }
      const r = Math.floor(pt.y);
      const c = Math.floor(pt.x);
      if (r < 0 || r >= board.rows || c < 0 || c >= board.cols) {
        this.setInputMode('DRAG');
        return;
      }
      this.handleBoosterTargetTap(board, pt.x, pt.y);
      return;
    }

    if (this.activePointerId === null || e.pointerId !== this.activePointerId) return;

    const board = this.callbacks.getBoard();
    if (this.dragBoardRef !== board) {
      this.cancelActiveDrag();
      return;
    }
    const blockId = this.activeBlockId;
    this.activePointerId = null;

    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore
    }

    if (blockId !== null) {
      this.finalizeDragMove(board, blockId, false);
    } else {
      this.emitHoverState();
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.targetingPointerId !== null && e.pointerId === this.targetingPointerId) {
      this.targetingPointerId = null;
      this.hoverRow = -1;
      this.hoverCol = -1;
      this.emitHoverState();
      return;
    }
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

    const contLeadX = lead ? lead.x : 0;
    const contLeadY = lead ? lead.y : 0;

    // Use snapGroupToNearestGrid to determine the exact valid integer (snappedRow, snappedCol)
    snapGroupToNearestGrid(board, blockId);
    let snappedRow = lead ? lead.row : 0;
    let snappedCol = lead ? lead.col : 0;

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

    const preShapeId = lead ? lead.shapeId : '1x1';
    const preColor = lead ? getActiveColor(lead.colorStack, lead.colorCursor) : 1;
    const preStart = lead ? this.groupStartCoords.get(lead.id) : undefined;
    const savedWaypoints = this.dragWaypoints.slice();
    const wasDragLeftOrigin = this.dragLeftOrigin;

    this.activePointerId = null;
    this.activeBlockId = null;
    this.dragBoardRef = null;
    this.dragLeftOrigin = false;
    this.dragWaypoints.length = 0;
    this.hoverRow = -1;
    this.hoverCol = -1;
    this.hoverBlockId = null;
    this.groupStartCoords.clear();

    const effVelX = Math.hypot(this.lastVelX, this.lastVelY) > 1e-4 ? this.lastVelX : this.lastPullX;
    const effVelY = Math.hypot(this.lastVelX, this.lastVelY) > 1e-4 ? this.lastVelY : this.lastPullY;

    // If captured mid-drag across a wide gate span, ensure (snappedRow, snappedCol) is a gate-clearing
    // anchor if rounding landed on an adjacent non-clearing cell (`F-01`).
    if (lead && capturedMidDrag) {
      const baseDRow = snappedRow - lead.row;
      const baseDCol = snappedCol - lead.col;
      const clearsAtSnapped = group.some(
        (b) => findEligibleGateForBlockAt(board, b, b.row + baseDRow, b.col + baseDCol, effVelX, effVelY) >= 0
      );
      if (!clearsAtSnapped) {
        let bestDist = Infinity;
        for (let dr = baseDRow - 1; dr <= baseDRow + 1; dr++) {
          for (let dc = baseDCol - 1; dc <= baseDCol + 1; dc++) {
            if (!canGroupOccupyOffset(board, group, dr, dc)) continue;
            const clearsHere = group.some(
              (b) => findEligibleGateForBlockAt(board, b, b.row + dr, b.col + dc, effVelX, effVelY) >= 0
            );
            if (clearsHere) {
              const candRow = lead.row + dr;
              const candCol = lead.col + dc;
              const dist = Math.hypot(contLeadX - candCol, contLeadY - candRow);
              if (dist < bestDist) {
                bestDist = dist;
                snappedRow = candRow;
                snappedCol = candCol;
                changedFromStart = true;
              }
            }
          }
        }
      }
    }

    // If a boundary-aligned block was pulled outward toward an eligible gate without changing integer cells
    // (and was NOT deliberately returned to origin after leaving to cancel the move), allow commitBlockMove
    // to evaluate the outward exit (`DRAG-03`, `ORIGIN-GHOST-01`).
    if (!changedFromStart && !wasDragLeftOrigin && Math.hypot(this.lastPullX, this.lastPullY) >= 0.08) {
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
      if (preStart) {
        const afterLead = board.blocks.find((b) => b.id === blockId);
        const endR = afterLead ? afterLead.row : snappedRow;
        const endC = afterLead ? afterLead.col : snappedCol;
        const gateIdx = afterLead ? afterLead.shredGateIndex : -1;
        const wasShreddedOrPeeled =
          gateIdx >= 0 ||
          outcome.clearedBlockIds.includes(blockId) ||
          outcome.peeledBlockIds.includes(blockId);
        const movedToDifferentCell = endR !== preStart.row || endC !== preStart.col;
        if (wasShreddedOrPeeled || (outcome.moved && movedToDifferentCell)) {
          const trace = buildCommittedMoveTrace(
            board,
            preShapeId,
            preStart.row,
            preStart.col,
            endR,
            endC,
            preColor,
            gateIdx,
            savedWaypoints
          );
          if (trace) this.callbacks.onPathTrace?.(trace);
        }
      }
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
    const ptrToRelease = this.activePointerId ?? this.targetingPointerId;
    if (ptrToRelease !== null) {
      try {
        this.canvas.releasePointerCapture?.(ptrToRelease);
      } catch {
        // Ignore synthetic pointer events
      }
    }
    if (this.activeBlockId !== null) {
      const board = this.callbacks.getBoard();
      if (board === this.dragBoardRef) {
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
    }

    this.activePointerId = null;
    this.targetingPointerId = null;
    this.activeBlockId = null;
    this.dragBoardRef = null;
    this.dragLeftOrigin = false;
    this.dragWaypoints.length = 0;
    this.hoverRow = -1;
    this.hoverCol = -1;
    this.hoverBlockId = null;
    this.groupStartCoords.clear();
    this.emitHoverState();
    this.callbacks.onBoardChanged?.();
  }

  private handleBoosterTargetTap(board: BoardState, boardX: number, boardY: number): void {
    executeBoosterTargetTap(board, boardX, boardY, this.inputMode, this.rocketAxis, this.callbacks, (mode) =>
      this.setInputMode(mode)
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
      getHoverPos: () => ({ row: this.hoverRow, col: this.hoverCol }),
      setHoverPos: (row, col) => {
        this.hoverRow = row;
        this.hoverCol = col;
      },
      fireRocketAtHover: () => {
        const board = this.callbacks.getBoard();
        if (this.hoverRow >= 0 && this.hoverCol >= 0) {
          this.handleBoosterTargetTap(board, this.hoverCol + 0.5, this.hoverRow + 0.5);
        }
      },
      getSelectedBlockId: () => this.selectedBlockId,
      setSelectedBlockId: (id) => {
        this.selectedBlockId = id;
      },
      emitHoverState: () => this.emitHoverState(),
    });
  }
}
