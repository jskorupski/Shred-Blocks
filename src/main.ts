import './styles/main.css';
import { SoundEngine } from './audio/synth';
import {
  type CommitMoveOutcome,
  cloneBoardState,
  commitBlockMove,
  computeEarnedStars,
  createBoardState,
  isBoardFailed,
  isBoardWon,
} from './core/board';
import { getActiveColor } from './core/polyomino';
import type { BlockState, BoardState, BoosterType, PlayMode, SavePayloadV1 } from './core/types';
import {
  BoardInputController,
  type BoosterTargetPayload,
  buildCommittedMoveTrace,
  type HoverState,
} from './input/pointer-controller';
import { getLevelSpec } from './levels/catalog';
import { findNextHintMove } from './levels/solver';
import { Renderer3D } from './render/renderer-3d';
import { canSkipZenLevel, SaveManager } from './storage/save-manager';
import { activateBoosterImpl, executeTargetedBoosterImpl } from './ui/boosters-controller';
import {
  type AppViewContext,
  type BeforeInstallPromptEvent,
  BOOSTER_DEBUT_NOTES,
  type ModalId,
  type ShredBlocksDebugBridge,
} from './ui/catalog-meta';
import { ensureDialogsMounted, prewarmDialogsLayout } from './ui/dialogs-template';
import {
  bindDomEventsImpl,
  checkForPwaUpdateImpl,
  handleInstallActionImpl,
  isPwaInstalledImpl,
  markPwaInstalledImpl,
  setupPwaAndServiceWorkerImpl,
  syncInstallUiVisibilityImpl,
  syncPwaUpdateBannerImpl,
  syncViewportGeometryImpl,
} from './ui/dom-events-and-pwa';
import {
  buildRenderOptionsImpl,
  handleImmobileBlockTapImpl,
  handleLockedVaultTapImpl,
  isNewPlayerSaveImpl,
  stepSimulationImpl,
  syncAllUiFromSaveImpl,
  syncBoosterTargetingBannerImpl,
  syncInGameHudImpl,
  syncTimerPillOnlyImpl,
  syncTitleOverlayDomImpl,
} from './ui/hud-and-title-view';
import { mountLanDevTools } from './ui/lan-devtools';
import {
  autoSolveCurrentLevelImpl,
  checkUrlHashForSaveImportImpl,
  closeAllModalsImpl,
  confirmPendingSaveImportImpl,
  continueFailedLevelImpl,
  createDebugBridgeImpl,
  dismissTitleScreenImpl,
  isAnyModalOpenImpl,
  openModalImpl,
  openTitleScreenImpl,
  previewSaveImportImpl,
  setupDialogLightDismissImpl,
  showGameToastImpl,
  showUnlockNoteIfPresentImpl,
  switchPlayModeImpl,
  switchScreenImpl,
  updateTelemetryReadoutImpl,
  useZenBlessingContinueImpl,
} from './ui/modals-and-save-transfer';
import {
  handleLevelFailureImpl,
  notifyFinalTouchImpl,
  populateVictoryModalImpl,
  scheduleStuckBoardCheckImpl,
} from './ui/outcome-modals-view';
import { renderRoadmapImpl, renderThemesStudioImpl } from './ui/roadmap-and-themes-view';
import { prewarmVictoryModalFx, startVictoryModalFx, stopVictoryModalFx } from './ui/victory-modal-fx';

export * from './ui/catalog-meta';

declare const __SHREDBLOCKS_LAN_DEVTOOLS__: boolean;

declare global {
  interface Window {
    __SHREDBLOCKS_DEBUG__: ShredBlocksDebugBridge;
  }
}

export class ShredBlocksApp implements AppViewContext {
  public readonly saveManager: SaveManager;
  public readonly sound: SoundEngine;
  public readonly renderer: Renderer3D;
  public readonly inputController: BoardInputController;

  public board: BoardState;
  public boardPlayMode: PlayMode = 'CHALLENGE';
  public activeScreen: 'home' | 'game' | 'themes' = 'home';
  public titleOverlayOpen = true;
  public blueprintMix = 1.0;
  public activeRoadmapRange = 'all';
  public expandedEndlessRanges: Array<[number, number]> = [];
  public undoStack: BoardState[] = [];
  public preRestartSnapshot: BoardState | null = null;
  public preRestartUndoStack: BoardState[] = [];
  public preRestartFreeUndos = 3;
  public freeUndosRemaining = 3;
  public levelOutcomeHandled = false;
  public runTouchedZen = false;
  public bombTickAccumulatorSec = 0;
  public frozenTimeSec: number | null = null;
  private lastRafMs = performance.now();
  public toastTimerId: ReturnType<typeof setTimeout> | null = null;
  public unlockToastTimerId: ReturnType<typeof setTimeout> | null = null;
  public cachedAutoGuideMove: { blockId: number; targetRow: number; targetCol: number } | null = null;
  public lastPointerActivityMs = performance.now();
  public currentLevelHasUnlockNote = false;
  public pendingImportPayload: SavePayloadV1 | null = null;
  public pendingImportRawCode: string | null = null;
  public deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  public pwaInstalledDetected = false;
  public swRegistration: ServiceWorkerRegistration | null = null;
  public waitingServiceWorker: ServiceWorker | null = null;
  public pwaUpdateAvailable = false;
  public pwaUpdateDismissedInSession = false;
  public lastSwUpdateCheckMs = 0;
  public lastBackgroundedAtMs = 0;
  public hasUserInteracted = false;
  public isApplyingPopstate = false;
  public historyInitialized = false;

  constructor() {
    ensureDialogsMounted();
    this.saveManager = new SaveManager();
    const initialSave = this.saveManager.getPayload();

    this.sound = new SoundEngine({
      sfxEnabled: initialSave.settings.sfxEnabled,
      musicEnabled: initialSave.settings.musicEnabled,
      hapticsEnabled: initialSave.settings.hapticsEnabled,
    });

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new Renderer3D(canvas);
    this.renderer.setQualityPreference(initialSave.settings.qualityTier);

    const startLevelId = Math.max(1, initialSave.currentLevelId || 1);
    this.boardPlayMode = initialSave.settings.playMode;
    this.board = createBoardState(getLevelSpec(startLevelId));

    this.inputController = new BoardInputController(canvas, {
      getBoard: () => this.board,
      getPlayMode: () => this.saveManager.getPayload().settings.playMode,
      sound: this.sound,
      screenToBoard: (clientX, clientY) => {
        const pt = this.renderer.screenToBoard(clientX, clientY, this.board.rows, this.board.cols);
        return { x: pt.boardX, y: pt.boardY };
      },
      onBeforeMoveCommit: (boardSnapshot) => {
        this.pushUndoSnapshot(boardSnapshot);
      },
      onMoveCommitted: (outcome) => {
        this.handleMoveCommitted(outcome);
      },
      onPathTrace: (trace) => {
        if (this.saveManager.getPayload().settings.reducedMotion) return;
        const first = trace.waypoints[0];
        const r = Math.max(0, Math.min(this.board.rows - 1, Math.floor(first?.y ?? 0)));
        const c = Math.max(0, Math.min(this.board.cols - 1, Math.floor(first?.x ?? 0)));
        const roomVis = this.renderer.getRoomVisualState(
          this.board,
          this.board.roomMap[r * this.board.cols + c] ?? 0
        );
        this.renderer.spawnPathTrace(
          trace.waypoints,
          trace.colorId,
          roomVis.zOffset,
          trace.spanCols,
          trace.spanRows,
          trace.intoGate,
          trace.cellMask
        );
      },
      onImmobileBlockTap: (block) => {
        this.handleImmobileBlockTap(block);
      },
      onLockedVaultTap: (vault) => {
        handleLockedVaultTapImpl(this, vault);
      },
      onExecuteBooster: (type, target) => {
        return this.executeTargetedBooster(type, target);
      },
      isBoardInteractive: () => {
        return this.activeScreen === 'game' && !this.titleOverlayOpen && !this.isAnyModalOpen();
      },
      onShortcutAction: (action) => {
        if (this.activeScreen !== 'game' || this.titleOverlayOpen) return;
        if (action === 'RESTART') {
          this.restartCurrentLevel();
        } else {
          this.activateBooster(action);
        }
      },
      onHoverChanged: (hoverState) => {
        this.lastPointerActivityMs = performance.now();
        this.syncBoosterTargetingBanner(hoverState);
        this.renderNow();
      },
      onDragFrame: () => {
        this.lastPointerActivityMs = performance.now();
        this.renderNow();
      },
      onBoardChanged: () => {
        this.lastPointerActivityMs = performance.now();
        this.syncInGameHud();
        this.renderNow();
      },
    });

    canvas.addEventListener(
      'pointerdown',
      () => {
        this.lastPointerActivityMs = performance.now();
      },
      { passive: true }
    );

    this.bindDomEvents();
    if (typeof __SHREDBLOCKS_LAN_DEVTOOLS__ !== 'undefined' && __SHREDBLOCKS_LAN_DEVTOOLS__) {
      mountLanDevTools(this);
    }
    this.setupDialogLightDismiss();
    this.setupPwaAndServiceWorker();

    this.saveManager.onChange(() => {
      this.syncAllUiFromSave();
    });

    const bootWriteSeq = initialSave.writeSeq;
    this.syncAllUiFromSave();
    this.renderRoadmap();
    this.renderThemesStudio();
    this.loadLevel(startLevelId, false, false);
    this.openTitleScreen();

    void this.saveManager.init().then((reconciled) => {
      const reconciledLadder = reconciled.modeState[reconciled.settings.playMode];
      const reconciledLevelId = Math.max(
        1,
        Math.min(reconciledLadder.highestUnlocked, reconciledLadder.currentLevelId || 1)
      );
      if (reconciled.writeSeq > bootWriteSeq) {
        this.activeRoadmapRange = 'all';
        this.expandedEndlessRanges = [];
        if (
          (this.activeScreen === 'home' || this.titleOverlayOpen) &&
          (reconciledLevelId !== this.board.levelId || reconciled.settings.playMode !== this.boardPlayMode)
        ) {
          this.loadLevel(reconciledLevelId, false, false);
        }
        this.renderRoadmap();
        this.renderThemesStudio();
      }
      this.syncAllUiFromSave();
      this.syncTitleOverlayDom();
      this.checkUrlHashForSaveImport();
    });

    this.startAnimationLoop();
    this.scheduleIdleUiPrewarm();
  }

  /**
   * Primes closed modal Top-Layer layout and the Victory 2D FX canvas during post-boot idle
   * so opening Victory, Failure, or Settings for the first time hits zero cold layout/surface stalls.
   */
  private scheduleIdleUiPrewarm(): void {
    if (typeof window === 'undefined') return;
    const runWarmup = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      prewarmDialogsLayout();
      prewarmVictoryModalFx();
    };
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(runWarmup, { timeout: 600 });
      } else {
        window.requestAnimationFrame(runWarmup);
      }
    }, 220);
  }

  // ===========================================================================
  // CORE GAMEPLAY & LEVEL CONTROLLER
  // ===========================================================================

  public loadLevel(levelId: number, switchToGameScreen = true, persistLevel = true): void {
    const cleanId = Math.max(1, Math.floor(levelId));
    this.inputController.cancelTargeting();
    const spec = getLevelSpec(cleanId);
    const save = this.saveManager.getPayload();
    this.board = createBoardState(spec);
    this.boardPlayMode = save.settings.playMode;
    this.currentLevelHasUnlockNote = Boolean(spec.unlockNote);
    this.lastPointerActivityMs = performance.now();
    this.undoStack = [];
    this.preRestartSnapshot = null;
    this.preRestartUndoStack = [];
    this.preRestartFreeUndos = 3;
    this.freeUndosRemaining = 3;
    this.levelOutcomeHandled = false;
    this.runTouchedZen = this.boardPlayMode === 'ZEN';
    this.board.bombsInert = this.runTouchedZen; // ZEN-CALM-01: bombs never tick or detonate in Zen
    this.bombTickAccumulatorSec = 0;

    if (this.toastTimerId !== null) {
      clearTimeout(this.toastTimerId);
      this.toastTimerId = null;
    }
    const gameToast = document.getElementById('game-toast');
    if (gameToast) gameToast.hidden = true;
    this.refreshAutoGuideMove();

    const activeLadder = save.modeState[save.settings.playMode];
    if (persistLevel && (cleanId !== save.currentLevelId || cleanId !== activeLadder.currentLevelId)) {
      this.saveManager.setCurrentLevel(cleanId);
    }

    if (switchToGameScreen) {
      this.blueprintMix = 0;
      this.closeAllModals();
      this.switchScreen('game');
    }

    this.showUnlockNoteIfPresent(spec.unlockNote ?? BOOSTER_DEBUT_NOTES[cleanId]);
    this.syncAllUiFromSave();
    this.syncInGameHud();
    this.renderer.resize();
    this.renderNow();
  }

  public refreshAutoGuideMove(): void {
    if (this.board.levelId <= 30 || this.currentLevelHasUnlockNote) {
      const hint = findNextHintMove(this.board, 600);
      this.cachedAutoGuideMove = hint
        ? { blockId: hint.blockId, targetRow: hint.targetRow, targetCol: hint.targetCol }
        : null;
    } else {
      this.cachedAutoGuideMove = null;
    }
  }

  public restartCurrentLevel(): void {
    if (this.activeScreen !== 'game' || this.titleOverlayOpen) return;
    this.sound.playButtonTap();
    this.inputController.cancelTargeting();
    if (this.board.movesCommitted > 0 || this.undoStack.length > 0) {
      this.preRestartSnapshot = cloneBoardState(this.board);
      this.preRestartUndoStack = this.undoStack.slice();
      this.preRestartFreeUndos = this.freeUndosRemaining;
      this.showGameToast('🔄 Level restarted — tap Undo to restore!');
    }
    const spec = getLevelSpec(this.board.levelId);
    const activeMode = this.saveManager.getPayload().settings.playMode;
    this.board = createBoardState(spec);
    this.boardPlayMode = activeMode;
    this.currentLevelHasUnlockNote = Boolean(spec.unlockNote);
    this.lastPointerActivityMs = performance.now();
    this.undoStack = [];
    this.freeUndosRemaining = 3;
    this.levelOutcomeHandled = false;
    this.runTouchedZen = activeMode === 'ZEN';
    this.board.bombsInert = this.runTouchedZen; // ZEN-CALM-01: bombs never tick or detonate in Zen
    this.bombTickAccumulatorSec = 0;
    this.renderer.clearPathTraces();
    this.refreshAutoGuideMove();
    this.syncInGameHud();
    this.renderNow();
  }

  public skipCurrentLevel(): void {
    if (this.activeScreen !== 'game' || this.titleOverlayOpen) return;
    const save = this.saveManager.getPayload();
    if (save.settings.playMode !== 'ZEN') {
      return;
    }
    const currentId = this.board.levelId;
    if (!canSkipZenLevel(save, currentId)) {
      this.sound.playWallClack();
      this.showGameToast('🌿 Clear a stage first to unlock more free skips (max 3 skipped in a row)!');
      return;
    }
    this.sound.playButtonTap();
    this.saveManager.recordLevelSkip(currentId);
    this.closeAllModals();
    this.loadLevel(currentId + 1, true);
    this.showGameToast(`⏭️ Skipped Level ${currentId} — Level ${currentId + 1} Ready!`);
  }

  public pushUndoSnapshot(boardState: BoardState): void {
    this.undoStack.push(cloneBoardState(boardState));
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
  }

  public commitMove(blockId: number, targetRow: number, targetCol: number): CommitMoveOutcome {
    const preBlock = this.board.blocks.find((b) => b.id === blockId);
    const preRow = preBlock ? preBlock.row : targetRow;
    const preCol = preBlock ? preBlock.col : targetCol;
    const preShapeId = preBlock ? preBlock.shapeId : '1x1';
    const preColor = preBlock ? getActiveColor(preBlock.colorStack, preBlock.colorCursor) : 1;
    this.pushUndoSnapshot(this.board);
    const playMode = this.saveManager.getPayload().settings.playMode;
    // Zero velocity: programmatic/auto-solve moves must not bias corner gate selection toward RIGHT/BOTTOM
    const outcome = commitBlockMove(this.board, blockId, targetRow, targetCol, playMode, 0, 0);
    if (!outcome.moved) {
      this.undoStack.pop();
    } else {
      if (!this.saveManager.getPayload().settings.reducedMotion && preBlock) {
        const afterBlk = this.board.blocks.find((b) => b.id === blockId);
        const endR = afterBlk ? afterBlk.row : targetRow;
        const endC = afterBlk ? afterBlk.col : targetCol;
        const gateIdx = afterBlk ? afterBlk.shredGateIndex : -1;
        const trace = buildCommittedMoveTrace(
          this.board,
          preShapeId,
          preRow,
          preCol,
          endR,
          endC,
          preColor,
          gateIdx
        );
        if (trace) {
          const roomVis = this.renderer.getRoomVisualState(
            this.board,
            this.board.roomMap[preRow * this.board.cols + preCol] ?? 0
          );
          this.renderer.spawnPathTrace(
            trace.waypoints,
            trace.colorId,
            roomVis.zOffset,
            trace.spanCols,
            trace.spanRows,
            trace.intoGate,
            trace.cellMask
          );
        }
      }
      if (outcome.clearedBlockIds.length > 0) {
        this.sound.playShred(0);
      } else if (outcome.peeledBlockIds.length > 0) {
        this.sound.playLayerPeel();
      } else {
        this.sound.playSnap();
      }
      this.handleMoveCommitted(outcome);
    }
    this.syncInGameHud();
    this.renderNow();
    return outcome;
  }

  private handleMoveCommitted(outcome: CommitMoveOutcome): void {
    if (!outcome.moved && outcome.clearedBlockIds.length === 0 && outcome.peeledBlockIds.length === 0) {
      this.undoStack.pop();
      notifyFinalTouchImpl(this, false);
      return;
    }
    if (outcome.coalesced && this.undoStack.length >= 2) {
      this.undoStack.pop();
    }
    // UX-11: only a real committed move forfeits accidental-restart recovery (rejected bumps keep it)
    this.preRestartSnapshot = null;
    this.preRestartUndoStack = [];
    const unlockToast = document.getElementById('unlock-toast');
    if (unlockToast && !unlockToast.hidden) {
      unlockToast.hidden = true;
    }
    if (outcome.unlockedBarrierIds && outcome.unlockedBarrierIds.length > 0) {
      const openedVault = this.board.barriers.some(
        (b) => b.isVault && outcome.unlockedBarrierIds.includes(b.id)
      );
      this.showGameToast(
        openedVault
          ? '🔓 Mystery Vault Unlocked! Hidden blocks revealed!'
          : '⛩️ Portcullis Opened! New chamber unlocked!'
      );
    }
    this.lastPointerActivityMs = performance.now();
    this.syncInGameHud();
    this.checkWinOrLossAfterAction();
    if (!this.levelOutcomeHandled) {
      notifyFinalTouchImpl(this, true);
      scheduleStuckBoardCheckImpl(this);
      this.refreshAutoGuideMove();
    }
  }

  public checkWinOrLossAfterAction(): void {
    if (this.levelOutcomeHandled) return;

    if (isBoardWon(this.board)) {
      this.levelOutcomeHandled = true;
      this.board.timerRunning = false;
      this.handleLevelVictory();
      return;
    }

    const playMode = this.saveManager.getPayload().settings.playMode;
    const failStatus = isBoardFailed(this.board, playMode);
    if (failStatus.failed && failStatus.reason) {
      this.levelOutcomeHandled = true;
      this.board.timerRunning = false;
      this.handleLevelFailure(failStatus.reason);
    }
  }

  private handleLevelVictory(): void {
    const playMode = this.saveManager.getPayload().settings.playMode;
    const zenClear = playMode === 'ZEN' || this.runTouchedZen;
    const pureBoosterFreeRun =
      !zenClear && (this.board.powerUpsUsed ?? 0) === 0 && (this.board.continuesUsed ?? 0) === 0;
    const earnedStars = computeEarnedStars(this.board, playMode, this.runTouchedZen);
    this.sound.playWinFanfare(earnedStars);
    this.renderer.spawnVictoryCelebrationBurst(this.board);
    const elapsedSec = Math.max(1, Math.round(this.board.timeLimitSec - this.board.timeRemainingSec));
    const summary = this.saveManager.recordLevelWin(
      this.board.levelId,
      this.board.movesCommitted,
      elapsedSec,
      Math.max(1, this.board.sessionBlocksShredded),
      earnedStars,
      this.board.parMoves,
      this.board.difficulty,
      zenClear,
      pureBoosterFreeRun
    );
    if (summary.underPar) {
      this.sound.playUnderParOracleChime();
    }

    populateVictoryModalImpl(this, summary);
    this.openModal('victory');
    const postSave = this.saveManager.getPayload();
    startVictoryModalFx({
      isUnderPar: Boolean(summary.underPar),
      earnedStars,
      equippedParticle: postSave.equippedParticle,
      reducedMotion: postSave.settings.reducedMotion,
      frozen: this.frozenTimeSec !== null,
    });
  }

  private handleLevelFailure(reason: 'TIME_OUT' | 'BOMB_EXPLODED' | 'OUT_OF_MOVES'): void {
    handleLevelFailureImpl(this, reason);
  }

  public continueFailedLevel(): void {
    continueFailedLevelImpl(this);
  }

  public useZenBlessingContinue(): void {
    useZenBlessingContinueImpl(this);
  }

  private handleImmobileBlockTap(block: BlockState): void {
    handleImmobileBlockTapImpl(this, block);
  }

  public autoSolveCurrentLevel(): boolean {
    return autoSolveCurrentLevelImpl(this);
  }

  // ===========================================================================
  // BOOSTERS & TARGETING (UX-04, UX-11) — implemented in src/ui/boosters-controller.ts
  // ===========================================================================

  public activateBooster(type: BoosterType): void {
    activateBoosterImpl(this, type);
  }

  private executeTargetedBooster(type: BoosterType, target: BoosterTargetPayload): boolean {
    return executeTargetedBoosterImpl(this, type, target);
  }

  public syncBoosterTargetingBanner(hoverState: HoverState): void {
    syncBoosterTargetingBannerImpl(hoverState);
  }

  // ===========================================================================
  // RENDER LOOP & 60Hz/120Hz TELEMETRY
  // ===========================================================================

  private startAnimationLoop(): void {
    const tick = (nowMs: number) => {
      const rawDt = Math.min(0.1, Math.max(0.001, (nowMs - this.lastRafMs) / 1000));
      // PERF-TRANSITION-01: prevent first-frame dtSec jump if mobile touch/AudioContext unlock took >16ms
      const dtSec = !this.titleOverlayOpen && this.blueprintMix > 0.98 ? Math.min(1 / 60, rawDt) : rawDt;
      this.lastRafMs = nowMs;
      if (this.frozenTimeSec !== null) {
        requestAnimationFrame(tick); // VISUAL-GOLDEN-01: time frozen for deterministic golden captures
        return;
      }

      stepSimulationImpl(this, dtSec);
      if (this.activeScreen === 'game' || this.titleOverlayOpen) {
        this.renderNow(dtSec, nowMs * 0.001);
      }

      const pauseDialog = document.getElementById('dialog-pause') as HTMLDialogElement | null;
      if (pauseDialog?.open) {
        updateTelemetryReadoutImpl(this);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  public renderNow(dtSec = 1 / 60, timeSec?: number): void {
    const t = timeSec ?? (this.frozenTimeSec !== null ? this.frozenTimeSec : undefined);
    this.renderer.render(this.board, buildRenderOptionsImpl(this, dtSec, t));
  }

  /** VISUAL-GOLDEN-01: freeze the live rAF loop at a fixed shader time (or resume with `null`) */
  public freezeTime(timeSec: number | null): void {
    this.frozenTimeSec = timeSec;
    if (timeSec !== null) {
      stopVictoryModalFx();
      this.renderer.resetTransientFx();
      this.renderNow(0, timeSec);
    }
  }

  /** VISUAL-GOLDEN-01: deterministic fixed-step frames while frozen (simulation + particles + render) */
  public advanceFrozenFrames(frames: number, dtSec = 1 / 60): void {
    if (this.frozenTimeSec === null) return;
    for (let i = 0; i < frames; i++) {
      this.frozenTimeSec += dtSec;
      stepSimulationImpl(this, dtSec);
      this.renderNow(dtSec, this.frozenTimeSec);
    }
  }

  public isNewPlayerSave(save: SavePayloadV1 = this.saveManager.getPayload()): boolean {
    return isNewPlayerSaveImpl(this, save);
  }
  public syncTitleOverlayDom(): void {
    syncTitleOverlayDomImpl(this);
  }

  public openTitleScreen(): void {
    openTitleScreenImpl(this);
  }
  public dismissTitleScreen(
    targetScreen: 'game' | 'home' | 'themes' = 'game',
    animateAwakening = true
  ): void {
    dismissTitleScreenImpl(this, targetScreen, animateAwakening);
  }
  public switchScreen(screen: 'home' | 'game' | 'themes'): void {
    switchScreenImpl(this, screen);
  }
  public switchPlayMode(nextMode: PlayMode, silent = false): void {
    switchPlayModeImpl(this, nextMode, silent);
  }

  public syncAllUiFromSave(): void {
    syncAllUiFromSaveImpl(this);
  }
  public syncInGameHud(): void {
    syncInGameHudImpl(this);
  }
  public syncTimerPillOnly(): void {
    syncTimerPillOnlyImpl(this);
  }
  public renderRoadmap(focusStageId?: number): void {
    renderRoadmapImpl(this, focusStageId);
  }
  public renderThemesStudio(): void {
    renderThemesStudioImpl(this);
  }
  public isAnyModalOpen(): boolean {
    return isAnyModalOpenImpl();
  }
  public openModal(id: ModalId): void {
    openModalImpl(this, id);
  }
  public closeAllModals(): void {
    stopVictoryModalFx();
    closeAllModalsImpl();
  }
  private setupDialogLightDismiss(): void {
    setupDialogLightDismissImpl();
  }
  public previewSaveImport(rawInput: string): boolean {
    return previewSaveImportImpl(this, rawInput);
  }
  public confirmPendingSaveImport(): void {
    confirmPendingSaveImportImpl(this);
  }
  public checkUrlHashForSaveImport(): void {
    checkUrlHashForSaveImportImpl(this);
  }

  public showGameToast(message: string, durationMs = 2600): void {
    showGameToastImpl(this, message, durationMs);
  }
  public showUnlockNoteIfPresent(note?: string): void {
    showUnlockNoteIfPresentImpl(this, note);
  }

  private bindDomEvents(): void {
    bindDomEventsImpl(this);
  }
  public isPwaInstalled(): boolean {
    return isPwaInstalledImpl(this);
  }
  public markPwaInstalled(): void {
    markPwaInstalledImpl(this);
  }
  public syncInstallUiVisibility(): void {
    syncInstallUiVisibilityImpl(this);
  }
  public syncViewportGeometry(): void {
    syncViewportGeometryImpl(this);
  }
  public syncPwaUpdateBanner(): void {
    syncPwaUpdateBannerImpl(this);
  }
  public checkForPwaUpdate(force = false): void {
    checkForPwaUpdateImpl(this, force);
  }
  public handleInstallAction(): Promise<void> {
    return handleInstallActionImpl(this);
  }
  private setupPwaAndServiceWorker(): void {
    setupPwaAndServiceWorkerImpl(this);
  }

  // ===========================================================================
  // AUTOMATION & E2E VERIFICATION BRIDGE (window.__SHREDBLOCKS_DEBUG__)
  // ===========================================================================

  public createDebugBridge(): ShredBlocksDebugBridge {
    return createDebugBridgeImpl(this);
  }
}

function bootstrap(): void {
  const app = new ShredBlocksApp();
  window.__SHREDBLOCKS_DEBUG__ = app.createDebugBridge();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
