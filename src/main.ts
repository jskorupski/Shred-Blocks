import './styles/main.css';
import { SoundEngine } from './audio/synth';
import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  type CommitMoveOutcome,
  cloneBoardState,
  commitBlockMove,
  computeEarnedStars,
  createBoardState,
  isBoardFailed,
  isBoardWon,
} from './core/board';
import { getShape } from './core/polyomino';
import type { BlockState, BoardState, BoosterType, InputMode, SavePayloadV1 } from './core/types';
import { BoardInputController, type BoosterTargetPayload, type HoverState } from './input/pointer-controller';
import { getLevelSpec } from './levels/catalog';
import { findNextHintMove } from './levels/solver';
import { Renderer3D } from './render/renderer-3d';
import { BOOSTER_RARITY, BOOSTER_UNLOCK_LEVEL, isBoosterUnlocked, SaveManager } from './storage/save-manager';
import {
  type AppViewContext,
  type BeforeInstallPromptEvent,
  BOOSTER_DEBUT_NOTES,
  BOOSTER_DISPLAY_NAMES,
  type ModalId,
  type ShredBlocksDebugBridge,
  UI_BOOSTER_PRICES,
} from './ui/catalog-meta';
import { ensureDialogsMounted } from './ui/dialogs-template';
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
  handleLevelFailureImpl,
  handleLockedVaultTapImpl,
  isNewPlayerSaveImpl,
  populateVictoryModalImpl,
  stepSimulationImpl,
  syncAllUiFromSaveImpl,
  syncBoosterTargetingBannerImpl,
  syncInGameHudImpl,
  syncTimerPillOnlyImpl,
  syncTitleOverlayDomImpl,
} from './ui/hud-and-title-view';
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
  switchScreenImpl,
  updateTelemetryReadoutImpl,
} from './ui/modals-and-save-transfer';
import { renderRoadmapImpl, renderThemesStudioImpl } from './ui/roadmap-and-themes-view';

export * from './ui/catalog-meta';

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
  public activeScreen: 'home' | 'game' | 'themes' = 'home';
  public titleOverlayOpen = true;
  public blueprintMix = 1.0;
  public activeRoadmapRange = 'all';
  private undoStack: BoardState[] = [];
  private preRestartSnapshot: BoardState | null = null;
  private preRestartUndoStack: BoardState[] = [];
  private preRestartFreeUndos = 3;
  public freeUndosRemaining = 3;
  public levelOutcomeHandled = false;
  public bombSecondAccumulator = 0;
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
      if (
        reconciled.writeSeq > bootWriteSeq &&
        (this.activeScreen === 'home' || this.titleOverlayOpen) &&
        reconciled.currentLevelId !== this.board.levelId
      ) {
        this.loadLevel(reconciled.currentLevelId, false, false);
      }
      this.syncAllUiFromSave();
      this.syncTitleOverlayDom();
      this.checkUrlHashForSaveImport();
    });

    this.startAnimationLoop();
  }

  // ===========================================================================
  // CORE GAMEPLAY & LEVEL CONTROLLER
  // ===========================================================================

  public loadLevel(levelId: number, switchToGameScreen = true, persistLevel = true): void {
    const cleanId = Math.max(1, Math.floor(levelId));
    const spec = getLevelSpec(cleanId);
    this.board = createBoardState(spec);
    this.currentLevelHasUnlockNote = Boolean(spec.unlockNote);
    this.lastPointerActivityMs = performance.now();
    this.undoStack = [];
    this.preRestartSnapshot = null;
    this.preRestartUndoStack = [];
    this.preRestartFreeUndos = 3;
    this.freeUndosRemaining = 3;
    this.levelOutcomeHandled = false;
    this.bombSecondAccumulator = 0;

    this.inputController.cancelTargeting();
    if (this.toastTimerId !== null) {
      clearTimeout(this.toastTimerId);
      this.toastTimerId = null;
    }
    const gameToast = document.getElementById('game-toast');
    if (gameToast) gameToast.hidden = true;
    this.refreshAutoGuideMove();

    const save = this.saveManager.getPayload();
    if (persistLevel && cleanId !== save.currentLevelId) {
      this.saveManager.setCurrentLevel(cleanId);
    }

    if (switchToGameScreen) {
      this.closeAllModals();
      this.switchScreen('game');
    }

    this.showUnlockNoteIfPresent(spec.unlockNote ?? BOOSTER_DEBUT_NOTES[cleanId]);
    this.syncAllUiFromSave();
    this.syncInGameHud();
    this.renderer.resize();
    this.renderNow();
  }

  private refreshAutoGuideMove(): void {
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
    this.sound.playButtonTap();
    if (this.board.movesCommitted > 0 || this.undoStack.length > 0) {
      this.preRestartSnapshot = cloneBoardState(this.board);
      this.preRestartUndoStack = this.undoStack.slice();
      this.preRestartFreeUndos = this.freeUndosRemaining;
      this.showGameToast('🔄 Level restarted — tap Undo to restore!');
    }
    const spec = getLevelSpec(this.board.levelId);
    this.board = createBoardState(spec);
    this.currentLevelHasUnlockNote = Boolean(spec.unlockNote);
    this.lastPointerActivityMs = performance.now();
    this.undoStack = [];
    this.freeUndosRemaining = 3;
    this.levelOutcomeHandled = false;
    this.bombSecondAccumulator = 0;
    this.inputController.cancelTargeting();
    this.refreshAutoGuideMove();
    this.syncInGameHud();
    this.renderNow();
  }

  public skipCurrentLevel(): void {
    this.sound.playButtonTap();
    const currentId = this.board.levelId;
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
    this.preRestartSnapshot = null;
    this.preRestartUndoStack = [];
  }

  public commitMove(blockId: number, targetRow: number, targetCol: number): CommitMoveOutcome {
    this.pushUndoSnapshot(this.board);
    const playMode = this.saveManager.getPayload().settings.playMode;
    const outcome = commitBlockMove(
      this.board,
      blockId,
      targetRow,
      targetCol,
      playMode,
      targetCol,
      targetRow
    );
    if (!outcome.moved) {
      this.undoStack.pop();
    } else {
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
      return;
    }
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
    const earnedStars = computeEarnedStars(this.board, playMode);
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
      this.board.difficulty
    );

    populateVictoryModalImpl(this, summary);
    this.openModal('victory');
    this.renderRoadmap();
  }

  private handleLevelFailure(reason: 'TIME_OUT' | 'BOMB_EXPLODED'): void {
    handleLevelFailureImpl(this, reason);
  }

  public continueFailedLevel(): void {
    continueFailedLevelImpl(this);
  }

  private handleImmobileBlockTap(block: BlockState): void {
    handleImmobileBlockTapImpl(this, block);
  }

  public autoSolveCurrentLevel(): boolean {
    return autoSolveCurrentLevelImpl(this);
  }

  // ===========================================================================
  // BOOSTERS & TARGETING (UX-04, UX-11)
  // ===========================================================================

  private canAffordBooster(type: BoosterType): boolean {
    if (this.saveManager.getBoosterCount(type) > 0) {
      return true;
    }
    const price = UI_BOOSTER_PRICES[type];
    if (this.saveManager.getPayload().coins >= price) {
      return true;
    }
    this.showGameToast(`Need ${price} Coins for ${type} booster!`);
    return false;
  }

  private ensureBoosterAvailable(type: BoosterType): boolean {
    if (this.saveManager.getBoosterCount(type) > 0) {
      return true;
    }
    const price = UI_BOOSTER_PRICES[type];
    if (this.saveManager.buyBoosterWithCoins(type, price)) {
      this.showGameToast(`Purchased ${type} booster for ${price} Coins!`);
      return true;
    }
    this.showGameToast(`Need ${price} Coins for ${type} booster!`);
    return false;
  }

  private isBoosterAvailableAtCurrentProgress(type: BoosterType): boolean {
    const save = this.saveManager.getPayload();
    const effectiveLevel = Math.max(this.board.levelId, save.highestLevelUnlocked);
    return isBoosterUnlocked(type, effectiveLevel);
  }

  public activateBooster(type: BoosterType): void {
    if (!this.isBoosterAvailableAtCurrentProgress(type)) {
      this.sound.playWallClack();
      const unlockLvl = BOOSTER_UNLOCK_LEVEL[type];
      const rarity = BOOSTER_RARITY[type];
      const displayName = BOOSTER_DISPLAY_NAMES[type];
      this.showGameToast(`🔒 ${displayName} (${rarity}) unlocks at Level ${unlockLvl}!`);
      return;
    }

    if (type === 'UNDO') {
      this.executeUndoBooster();
      return;
    }

    if (type === 'FREEZE') {
      this.executeHintOrFreezeBooster();
      return;
    }

    const modeMap: Record<'HAMMER' | 'ROCKET' | 'VACUUM', InputMode> = {
      HAMMER: 'TARGET_HAMMER',
      ROCKET: 'TARGET_ROCKET',
      VACUUM: 'TARGET_VACUUM',
    };
    const targetMode = modeMap[type];

    // Toggle off if already targeting this booster
    if (this.inputController.getInputMode() === targetMode) {
      this.inputController.cancelTargeting();
      return;
    }

    if (!this.canAffordBooster(type)) {
      return;
    }

    this.sound.playButtonTap();
    this.inputController.setInputMode(targetMode);
    this.syncBoosterTargetingBanner(this.inputController.getHoverState());
    this.renderNow();
  }

  private executeUndoBooster(): void {
    // UX-11: Check if undoing an accidental level restart first
    if (this.undoStack.length === 0 && this.preRestartSnapshot) {
      this.board = cloneBoardState(this.preRestartSnapshot);
      this.undoStack = this.preRestartUndoStack;
      this.freeUndosRemaining = this.preRestartFreeUndos;
      this.preRestartSnapshot = null;
      this.preRestartUndoStack = [];
      this.levelOutcomeHandled = false;
      this.sound.playBooster('UNDO');
      this.showGameToast('↩️ Restored board before restart!');
      this.syncInGameHud();
      this.renderNow();
      return;
    }

    if (this.undoStack.length === 0) {
      this.showGameToast('↩️ No moves to undo yet');
      return;
    }

    if (this.freeUndosRemaining > 0) {
      this.freeUndosRemaining--;
    } else {
      if (!this.ensureBoosterAvailable('UNDO')) return;
      this.saveManager.spendBooster('UNDO');
    }

    const previous = this.undoStack.pop();
    if (!previous) return;
    this.board = previous;
    this.levelOutcomeHandled = false;
    this.lastPointerActivityMs = performance.now();
    this.refreshAutoGuideMove();
    this.sound.playBooster('UNDO');
    this.syncInGameHud();
    this.renderNow();
  }

  private executeHintOrFreezeBooster(): void {
    const playMode = this.saveManager.getPayload().settings.playMode;

    if (!this.canAffordBooster('FREEZE')) {
      return;
    }

    if (playMode === 'ZEN') {
      const hint = findNextHintMove(this.board);
      if (!hint) {
        this.showGameToast('💡 No hint needed right now!');
        return;
      }
      if (!this.ensureBoosterAvailable('FREEZE')) return;
      this.saveManager.spendBooster('FREEZE');
      this.board.hintMove = hint;
      this.sound.playBooster('FREEZE');
      this.showGameToast('💡 Optimal next move highlighted on the board!');
    } else {
      if (!this.ensureBoosterAvailable('FREEZE')) return;
      this.saveManager.spendBooster('FREEZE');
      this.board.freezeRemainingSec = Math.max(0, this.board.freezeRemainingSec) + 10;
      const hint = findNextHintMove(this.board);
      if (hint) {
        this.board.hintMove = hint;
      }
      this.sound.playBooster('FREEZE');
      this.showGameToast('❄️ Timer & Bombs Frozen for +10s!');
    }

    this.syncInGameHud();
    this.renderNow();
  }

  private executeTargetedBooster(type: BoosterType, target: BoosterTargetPayload): boolean {
    if (!this.canAffordBooster(type)) return false;

    const closedBefore = new Set(this.board.barriers.filter((b) => !b.open).map((b) => b.id));
    let applied = false;

    if (type === 'HAMMER') {
      const pickedBlock =
        target.blockId !== null
          ? this.board.blocks.find((b) => b.id === target.blockId && b.status === 'ACTIVE')
          : null;
      const firstCell = pickedBlock ? getShape(pickedBlock.shapeId).cells[0] : null;
      const r = pickedBlock && firstCell ? pickedBlock.row + firstCell[0] : target.row;
      const c = pickedBlock && firstCell ? pickedBlock.col + firstCell[1] : target.col;
      applied = (applyBoosterHammer as (b: BoardState, r: number, c: number, id?: number | null) => boolean)(
        this.board,
        r,
        c,
        pickedBlock ? pickedBlock.id : null
      );
    } else if (type === 'ROCKET') {
      applied = applyBoosterRocket(this.board, target.row, target.col, target.axis);
    } else if (type === 'VACUUM') {
      if (target.color && target.color > 0) {
        applied = applyBoosterVacuum(this.board, target.color);
      }
    }

    if (!applied) {
      this.sound.playWallClack();
      this.showGameToast('Tap a valid colored block or crate target!');
      return false;
    }

    if (!this.ensureBoosterAvailable(type)) return false;
    // F-08 / MECH-10: Destructive boosters clear the undo stack so consumed boosters cannot be refunded
    this.undoStack = [];
    this.preRestartSnapshot = null;
    this.preRestartUndoStack = [];
    this.saveManager.spendBooster(type);
    const newlyOpened = this.board.barriers.filter((b) => b.open && closedBefore.has(b.id));
    if (newlyOpened.length > 0) {
      const openedVault = newlyOpened.some((b) => b.isVault);
      this.showGameToast(
        openedVault
          ? '🔓 Mystery Vault Unlocked! Hidden blocks revealed!'
          : '⛩️ Portcullis Opened! New chamber unlocked!'
      );
    }
    this.syncInGameHud();
    this.checkWinOrLossAfterAction();
    return true;
  }

  public syncBoosterTargetingBanner(hoverState: HoverState): void {
    syncBoosterTargetingBannerImpl(hoverState);
  }

  // ===========================================================================
  // RENDER LOOP & 60Hz/120Hz TELEMETRY
  // ===========================================================================

  private startAnimationLoop(): void {
    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - this.lastRafMs) / 1000));
      this.lastRafMs = nowMs;

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
    this.renderer.render(this.board, buildRenderOptionsImpl(this, dtSec, timeSec));
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
  public dismissTitleScreen(targetScreen: 'game' | 'home' | 'themes' = 'game'): void {
    dismissTitleScreenImpl(this, targetScreen);
  }
  public switchScreen(screen: 'home' | 'game' | 'themes'): void {
    switchScreenImpl(this, screen);
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
  public renderRoadmap(): void {
    renderRoadmapImpl(this);
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
