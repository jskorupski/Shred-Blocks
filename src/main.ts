import './styles/main.css';
import { SoundEngine } from './audio/synth';
import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  cloneBoardState,
  commitBlockMove,
  computeEarnedStars,
  createBoardState,
  isBoardFailed,
  isBoardWon,
  type CommitMoveOutcome,
} from './core/board';
import { findEligibleGateForBlockAt } from './core/gate-clearance';
import { getActiveColor, getShape } from './core/polyomino';
import {
  COLOR_PALETTE,
  type Benchmark120HzResult,
  type BlockState,
  type BoardState,
  type BoosterType,
  type InputMode,
  type ParticleStyleId,
  type PerfTelemetry,
  type PlayMode,
  type QualityTier,
  type RocketAxis,
  type SavePayloadV1,
  type SkinId,
  type TrayId,
} from './core/types';
import {
  BoardInputController,
  type BoosterTargetPayload,
  type HoverState,
} from './input/pointer-controller';
import { getAllCampaignLevels, getLevelSpec, TOTAL_CAMPAIGN_LEVELS } from './levels/catalog';
import { findNextHintMove, solveBoard } from './levels/solver';
import { Renderer3D, type RenderSceneOptions } from './render/renderer-3d';
import { generateQrSvg } from './storage/qr-svg';
import { decodeSaveCode, validateSavePayloadV1 } from './storage/save-code';
import {
  BOOSTER_COIN_COSTS,
  BOOSTER_RARITY,
  BOOSTER_UNLOCK_LEVEL,
  extractImportCodeFromHash,
  isBoosterUnlocked,
  SaveManager,
  type LevelWinRewardSummary,
} from './storage/save-manager';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type ModalId = 'victory' | 'failure' | 'pause' | 'save-transfer' | 'install';

export interface ShredBlocksDebugBridge {
  getBoard: () => BoardState;
  getSave: () => SavePayloadV1;
  loadLevel: (levelId: number) => void;
  commitMove: (blockId: number, targetRow: number, targetCol: number) => CommitMoveOutcome;
  autoSolveCurrentLevel: () => boolean;
  setPlayMode: (mode: PlayMode) => void;
  setColorblindMode: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
  setTheme: (skin: SkinId, tray: TrayId, particle: ParticleStyleId) => void;
  activateBooster: (type: BoosterType) => void;
  openModal: (id: ModalId) => void;
  closeAllModals: () => void;
  openTitleScreen: () => void;
  dismissTitleScreen: (targetScreen?: 'game' | 'home' | 'themes') => void;
  isTitleScreenOpen: () => boolean;
  previewSaveImport: (code: string) => boolean;
  getTelemetry: () => PerfTelemetry;
  run120HzBenchmark: (frames?: number) => Promise<Benchmark120HzResult>;
  simulateContextLoss: () => void;
  boardToScreen: (boardX: number, boardY: number) => { x: number; y: number };
}

declare global {
  interface Window {
    __SHREDBLOCKS_DEBUG__: ShredBlocksDebugBridge;
  }
}

const UI_BOOSTER_PRICES: Record<BoosterType, number> = BOOSTER_COIN_COSTS;

const BOOSTER_DISPLAY_NAMES: Record<BoosterType, string> = {
  UNDO: 'Undo',
  FREEZE: 'Hint / Freeze',
  HAMMER: 'Hammer',
  ROCKET: 'Rocket',
  VACUUM: 'Color Vacuum',
};

const BOOSTER_DEBUT_NOTES: Partial<Record<number, string>> = {
  2: 'UNCOMMON Power-Up Unlocked: Hint / Freeze! Reveals the optimal next move in Zen Mode or freezes timers for +10s.',
  8: 'RARE Power-Up Unlocked: Hammer! Tap any block, crate, or locked gate to shatter it.',
  18: 'EPIC Power-Up Unlocked: Rocket! Blasts an entire row or column of blocks.',
  30: 'LEGENDARY Power-Up Unlocked: Color Vacuum! Sweeps all unlocked blocks of a chosen color off the board.',
};

interface ChapterMeta {
  chapterNum: string;
  title: string;
  subtitle: string;
  startLevel: number;
  endLevel: number;
}

const CAMPAIGN_CHAPTERS: ReadonlyArray<ChapterMeta> = [
  {
    chapterNum: 'CHAPTER I',
    title: 'Sanctuary Courtyard',
    subtitle: '5×5 Foundations · Pure Sliding & Axis Rails',
    startLevel: 1,
    endLevel: 15,
  },
  {
    chapterNum: 'CHAPTER II',
    title: 'Frost & Forged Iron',
    subtitle: '6×6 Courtyards · Ice, Multi-Layer & Padlocks',
    startLevel: 16,
    endLevel: 40,
  },
  {
    chapterNum: 'CHAPTER III',
    title: 'Terrace of Tethers',
    subtitle: '6×7 Terraces · Ropes, Crates & Countdown Bombs',
    startLevel: 41,
    endLevel: 80,
  },
  {
    chapterNum: 'CHAPTER IV',
    title: 'Clockwork Spires',
    subtitle: '7×7 Spires · Shutters, Rotators & Conveyor Flows',
    startLevel: 81,
    endLevel: 140,
  },
  {
    chapterNum: 'CHAPTER V',
    title: 'Astral Observatory',
    subtitle: '7×8–8×8 Astral Halls · Portals, Magnets & Linked Groups',
    startLevel: 141,
    endLevel: 220,
  },
  {
    chapterNum: 'CHAPTER VI',
    title: 'Grand Citadel',
    subtitle: '8×8–9×9 Citadel · Masterwork Architectural Synthesis',
    startLevel: 221,
    endLevel: 300,
  },
];

function getChapterMetaForLevel(levelId: number): ChapterMeta {
  for (const ch of CAMPAIGN_CHAPTERS) {
    if (levelId >= ch.startLevel && levelId <= ch.endLevel) {
      return ch;
    }
  }
  return {
    chapterNum: 'ENDLESS CITADEL',
    title: 'Infinite Horizon',
    subtitle: '8×8–9×9 Procedural Sanctuary Mastery',
    startLevel: 301,
    endLevel: 9999,
  };
}

const THEME_UNLOCK_PRICE = 150;

const SKIN_CATALOG: ReadonlyArray<{ id: SkinId; name: string; desc: string }> = [
  { id: 'classic_studs', name: 'Classic Studs', desc: 'Tactile toy-box blocks with raised top studs' },
  { id: 'smooth_bevel', name: 'Smooth Bevel', desc: 'Sleek satin-matte chamfered acrylic blocks' },
  { id: 'gummy_jelly', name: 'Gummy Jelly', desc: 'Glossy translucent subsurface candy blocks' },
  { id: 'carved_wood', name: 'Carved Wood', desc: 'Warm artisan hardwood blocks with grain bands' },
  { id: 'neon_cyber', name: 'Neon Cyber', desc: 'Dark obsidian core with glowing neon rim light' },
];

const TRAY_CATALOG: ReadonlyArray<{ id: TrayId; name: string; desc: string }> = [
  { id: 'industrial_slate', name: 'Industrial Slate', desc: 'High-contrast dark steel puzzle tray' },
  { id: 'warm_birch', name: 'Warm Birch', desc: 'Cozy Scandinavian wooden tabletop board' },
  { id: 'midnight_arcade', name: 'Midnight Arcade', desc: 'Deep synthwave indigo cabinet frame' },
  { id: 'frosted_quartz', name: 'Frosted Quartz', desc: 'Crisp architectural alabaster stone tray' },
  { id: 'mint_studio', name: 'Mint Studio', desc: 'Refreshing seafoam studio workbench' },
];

const PARTICLE_CATALOG: ReadonlyArray<{ id: ParticleStyleId; name: string; desc: string }> = [
  { id: 'micro_cubes', name: 'Micro Cubes', desc: 'Crisp 3D voxel cubes flying from the rollers' },
  { id: 'star_confetti', name: 'Star Confetti', desc: 'Celebratory tumbling party bursts' },
  { id: 'pixel_sparks', name: 'Pixel Sparks', desc: 'High-velocity arcade energy sparks' },
  { id: 'soap_bubbles', name: 'Soap Bubbles', desc: 'Floaty iridescent spheres with gentle drift' },
  { id: 'lightning_bolts', name: 'Lightning Bolts', desc: 'Crackling electric shredder surges' },
];

export class ShredBlocksApp {
  private static readonly PWA_INSTALLED_STORAGE_KEY = 'shredblocks_pwa_installed_v1';

  public readonly saveManager: SaveManager;
  public readonly sound: SoundEngine;
  public readonly renderer: Renderer3D;
  public readonly inputController: BoardInputController;

  private board: BoardState;
  private activeScreen: 'home' | 'game' | 'themes' = 'home';
  private titleOverlayOpen = true;
  private activeRoadmapRange = 'all';
  private undoStack: BoardState[] = [];
  private preRestartSnapshot: BoardState | null = null;
  private preRestartUndoStack: BoardState[] = [];
  private preRestartFreeUndos = 3;
  private freeUndosRemaining = 3;
  private levelOutcomeHandled = false;
  private saveInitialized = false;
  private bombSecondAccumulator = 0;
  private lastRafMs = performance.now();
  private toastTimerId: ReturnType<typeof setTimeout> | null = null;
  private unlockToastTimerId: ReturnType<typeof setTimeout> | null = null;
  private cachedAutoGuideMove: { blockId: number; targetRow: number; targetCol: number } | null =
    null;
  private lastPointerActivityMs = performance.now();
  private currentLevelHasUnlockNote = false;
  private pendingImportPayload: SavePayloadV1 | null = null;
  private pendingImportRawCode: string | null = null;
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private pwaInstalledDetected = false;
  private waitingServiceWorker: ServiceWorker | null = null;

  constructor() {
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
        const pt = this.renderer.screenToBoard(
          clientX,
          clientY,
          this.board.rows,
          this.board.cols
        );
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
      onExecuteBooster: (type, target) => {
        return this.executeTargetedBooster(type, target);
      },
      isBoardInteractive: () => {
        return (
          this.activeScreen === 'game' &&
          !this.titleOverlayOpen &&
          !this.isAnyModalOpen()
        );
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
      this.saveInitialized = true;
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

  private pushUndoSnapshot(boardState: BoardState): void {
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
    if (
      !outcome.moved &&
      outcome.clearedBlockIds.length === 0 &&
      outcome.peeledBlockIds.length === 0
    ) {
      this.undoStack.pop();
      return;
    }
    const unlockToast = document.getElementById('unlock-toast');
    if (unlockToast && !unlockToast.hidden) {
      unlockToast.hidden = true;
    }
    this.lastPointerActivityMs = performance.now();
    this.syncInGameHud();
    this.checkWinOrLossAfterAction();
    if (!this.levelOutcomeHandled) {
      this.refreshAutoGuideMove();
    }
  }

  private checkWinOrLossAfterAction(): void {
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
    const elapsedSec = Math.max(
      1,
      Math.round(this.board.timeLimitSec - this.board.timeRemainingSec)
    );
    const summary = this.saveManager.recordLevelWin(
      this.board.levelId,
      this.board.movesCommitted,
      elapsedSec,
      Math.max(1, this.board.sessionBlocksShredded),
      earnedStars,
      this.board.parMoves,
      this.board.difficulty
    );

    this.populateVictoryModal(summary);
    this.openModal('victory');
    this.renderRoadmap();
  }

  private populateVictoryModal(summary: LevelWinRewardSummary): void {
    const titleEl = document.getElementById('victory-title');
    const subtitleEl = document.getElementById('victory-subtitle');
    const starsEl = document.getElementById('victory-stars');
    const movesEl = document.getElementById('victory-moves');
    const coinsTotalEl = document.getElementById('victory-coins-total');
    const breakdownEl = document.getElementById('victory-coins-breakdown');
    const chestFanfareEl = document.getElementById('victory-chest-fanfare');
    const shredTextEl = document.getElementById('victory-shred-chest-text');
    const shredFillEl = document.getElementById('victory-shred-chest-fill');
    const milestoneTextEl = document.getElementById('victory-milestone-chest-text');
    const milestoneFillEl = document.getElementById('victory-milestone-chest-fill');

    const save = this.saveManager.getPayload();

    if (titleEl) {
      titleEl.textContent = `🎉 Level ${this.board.levelId} Cleared!`;
    }
    if (subtitleEl) {
      subtitleEl.textContent =
        summary.starsEarned === 3
          ? 'Flawless 3-Star Shredder Mastery!'
          : summary.starsEarned === 2
            ? 'Great Job! Clear in fewer moves for 3 Stars!'
            : 'Level Complete!';
    }
    if (starsEl) {
      const slots: HTMLSpanElement[] = [];
      for (let i = 0; i < 3; i++) {
        const span = document.createElement('span');
        const isEarned = i < summary.starsEarned;
        span.className = isEarned ? 'star-slot earned' : 'star-slot unearned';
        span.textContent = isEarned ? '⭐' : '☆';
        slots.push(span);
      }
      starsEl.replaceChildren(...slots);
    }
    if (movesEl) {
      movesEl.textContent = `${this.board.movesCommitted} / Par ${this.board.parMoves}`;
    }
    if (coinsTotalEl) {
      coinsTotalEl.textContent = `+${summary.totalCoinsEarned} Coins`;
    }
    if (breakdownEl) {
      const parts: string[] = [
        summary.isFirstClear
          ? `First Clear: +${summary.baseCoins}`
          : `Replay Bonus: +${summary.baseCoins}`,
      ];
      if (summary.starCoins > 0) parts.push(`New Stars: +${summary.starCoins}`);
      if (summary.streakCoins > 0) parts.push(`Streak: +${summary.streakCoins}`);
      if (summary.chestCoins > 0) parts.push(`Chests: +${summary.chestCoins}`);
      breakdownEl.textContent = parts.join(' • ');
    }
    const shredChestProg = Math.min(100, Math.max(0, save.shredderChestProgress % 100));
    const milestoneStep = Math.max(0, save.highestLevelUnlocked - 1) % 10;
    if (shredTextEl) {
      shredTextEl.textContent = `${shredChestProg} / 100`;
    }
    if (shredFillEl) {
      shredFillEl.style.width = `${shredChestProg}%`;
    }
    if (milestoneTextEl) {
      milestoneTextEl.textContent = `${milestoneStep} / 10`;
    }
    if (milestoneFillEl) {
      milestoneFillEl.style.width = `${Math.max(10, milestoneStep * 10)}%`;
    }
    if (chestFanfareEl) {
      const chestNotes: string[] = [];
      if (summary.shredderChestsOpened > 0) {
        const rewardPart =
          summary.rewardedBoosters.length > 0
            ? summary.rewardedBoosters
                .map((b) => `+1 ${BOOSTER_DISPLAY_NAMES[b]} [${BOOSTER_RARITY[b]}]`)
                .join(', ')
            : 'Free Booster';
        chestNotes.push(`⚙️ Shredder Chest Opened! (+100 Coins & ${rewardPart})`);
      }
      if (summary.milestoneChestOpened) {
        const lastBooster = summary.rewardedBoosters[summary.rewardedBoosters.length - 1];
        const rewardPart = lastBooster
          ? `+1 ${BOOSTER_DISPLAY_NAMES[lastBooster]} [${BOOSTER_RARITY[lastBooster]}]`
          : 'Free Booster';
        chestNotes.push(`🏆 Milestone Chest Opened! (+150 Coins & ${rewardPart})`);
      }
      if (chestNotes.length > 0) {
        chestFanfareEl.textContent = chestNotes.join(' | ');
        chestFanfareEl.hidden = false;
      } else {
        chestFanfareEl.hidden = true;
      }
    }
  }

  private handleLevelFailure(reason: 'TIME_OUT' | 'BOMB_EXPLODED'): void {
    this.sound.playLossBuzzer();
    this.saveManager.recordLevelLoss();

    const titleEl = document.getElementById('failure-title');
    const reasonEl = document.getElementById('failure-reason');
    const continueBtn = document.getElementById('btn-continue-level');

    if (titleEl) {
      titleEl.textContent = reason === 'BOMB_EXPLODED' ? '💣 Bomb Exploded!' : "⏰ Time's Up!";
    }
    if (reasonEl) {
      reasonEl.textContent =
        reason === 'BOMB_EXPLODED'
          ? 'A countdown bomb reached zero! Defuse all bombs (+8 moves/sec) to keep playing, retry for free, or skip ahead.'
          : 'You ran out of time in Timed Rush! Add +15 seconds, switch to Zen Mode, retry for free, or skip ahead.';
    }
    if (continueBtn) {
      continueBtn.textContent =
        reason === 'BOMB_EXPLODED'
          ? '➕ Defuse Bombs (50 Coins)'
          : '➕ Add +15 Seconds (50 Coins)';
    }

    this.openModal('failure');
  }

  private continueFailedLevel(): void {
    const save = this.saveManager.getPayload();
    if (save.coins < 50) {
      this.showGameToast('Need 50 Coins to continue — or Retry / Skip for FREE!');
      return;
    }

    // Spend 50 coins via buyBoosterWithCoins + spendBooster
    if (this.saveManager.buyBoosterWithCoins('FREEZE', 50)) {
      this.saveManager.spendBooster('FREEZE');
    }

    this.board.timeRemainingSec = Math.max(15, this.board.timeRemainingSec + 15);
    for (const b of this.board.blocks) {
      if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount <= 0) {
        b.bombCount = Math.max(6, b.bombMax);
      }
    }
    this.levelOutcomeHandled = false;
    this.board.timerRunning = true;
    this.closeAllModals();
    this.sound.playBooster('FREEZE');
    this.syncInGameHud();
    this.renderNow();
  }

  private handleImmobileBlockTap(block: BlockState): void {
    const activeColor = getActiveColor(block.colorStack, block.colorCursor);
    if (activeColor === 0) {
      this.showGameToast('🪨 Stone Block — permanent obstacle that never moves');
    } else if (block.iceCount > 0) {
      this.showGameToast(`❄️ Frozen! Shred ${block.iceCount} more block(s) to thaw`);
    } else if (block.chained) {
      this.showGameToast('🔒 Chained! Shred a block carrying a 🔑 Key to unlock');
    } else if (block.ropeColor > 0) {
      const cName = COLOR_PALETTE[block.ropeColor]?.name ?? 'matching';
      this.showGameToast(`🪢 Tied with ${cName} Rope! Shred matching ✂️ Scissors first`);
    }
  }

  public autoSolveCurrentLevel(): boolean {
    this.closeAllModals();
    this.levelOutcomeHandled = false;

    const solved = solveBoard(this.board, 6000);
    if (solved.solvable && solved.solutionPath.length > 0) {
      for (const step of solved.solutionPath) {
        this.commitMove(step.blockId, step.targetRow, step.targetCol);
        if (isBoardWon(this.board)) {
          return true;
        }
      }
    }

    // Deterministic fallback for complex states if node budget was reached
    if (!isBoardWon(this.board)) {
      this.pushUndoSnapshot(this.board);
      for (const b of this.board.blocks) {
        if (b.status !== 'ACTIVE') continue;
        const c = getActiveColor(b.colorStack, b.colorCursor);
        if (c !== 0) {
          b.status = 'CLEARED';
          b.shredProgress = 1;
          this.board.sessionBlocksShredded += Math.max(1, b.colorStack.length - b.colorCursor);
        }
      }
      for (const gen of this.board.generators) {
        gen.state = 'DEPLETED';
        gen.queueCursor = gen.queue.length;
      }
      if (this.board.movesCommitted === 0) {
        this.board.movesCommitted = this.board.parMoves;
      }
      this.checkWinOrLossAfterAction();
    }

    return isBoardWon(this.board);
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

    const previous = this.undoStack.pop()!;
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

    let applied = false;

    if (type === 'HAMMER') {
      const pickedBlock =
        target.blockId !== null
          ? this.board.blocks.find((b) => b.id === target.blockId && b.status === 'ACTIVE')
          : null;
      const firstCell = pickedBlock ? getShape(pickedBlock.shapeId).cells[0] : null;
      const r = pickedBlock && firstCell ? pickedBlock.row + firstCell[0] : target.row;
      const c = pickedBlock && firstCell ? pickedBlock.col + firstCell[1] : target.col;
      applied = (
        applyBoosterHammer as (b: BoardState, r: number, c: number, id?: number | null) => boolean
      )(this.board, r, c, pickedBlock ? pickedBlock.id : null);
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
    this.syncInGameHud();
    this.checkWinOrLossAfterAction();
    return true;
  }

  private syncBoosterTargetingBanner(hoverState: HoverState): void {
    const banner = document.getElementById('booster-target-banner');
    const textEl = document.getElementById('booster-target-text');
    const axisBtn = document.getElementById('btn-rocket-axis');

    const hammerBtn = document.getElementById('btn-booster-hammer');
    const rocketBtn = document.getElementById('btn-booster-rocket');
    const vacuumBtn = document.getElementById('btn-booster-vacuum');

    hammerBtn?.classList.toggle('active-targeting', hoverState.inputMode === 'TARGET_HAMMER');
    rocketBtn?.classList.toggle('active-targeting', hoverState.inputMode === 'TARGET_ROCKET');
    vacuumBtn?.classList.toggle('active-targeting', hoverState.inputMode === 'TARGET_VACUUM');

    if (!banner || !textEl || !axisBtn) return;

    if (hoverState.inputMode === 'DRAG') {
      banner.hidden = true;
      return;
    }

    banner.hidden = false;
    const unlockToast = document.getElementById('unlock-toast');
    if (unlockToast) {
      unlockToast.hidden = true;
    }
    if (hoverState.inputMode === 'TARGET_HAMMER') {
      textEl.textContent = '🔨 Tap any block, crate, or locked gate to smash';
      axisBtn.hidden = true;
    } else if (hoverState.inputMode === 'TARGET_ROCKET') {
      textEl.textContent = `🚀 Tap any cell to blast its entire ${hoverState.rocketAxis === 'ROW' ? 'ROW' : 'COLUMN'}`;
      axisBtn.hidden = false;
      axisBtn.textContent =
        hoverState.rocketAxis === 'ROW' ? 'Axis: ↔ ROW' : 'Axis: ↕ COL';
    } else if (hoverState.inputMode === 'TARGET_VACUUM') {
      textEl.textContent = '🧲 Tap any unlocked colored block to vacuum all matching blocks';
      axisBtn.hidden = true;
    }
  }

  // ===========================================================================
  // RENDER LOOP & 60Hz/120Hz TELEMETRY
  // ===========================================================================

  private startAnimationLoop(): void {
    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - this.lastRafMs) / 1000));
      this.lastRafMs = nowMs;

      this.stepSimulation(dtSec);
      if (this.activeScreen === 'game' || this.titleOverlayOpen) {
        this.renderNow(dtSec, nowMs * 0.001);
      }

      const pauseDialog = document.getElementById('dialog-pause') as HTMLDialogElement | null;
      if (pauseDialog?.open) {
        this.updateTelemetryReadout();
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  private stepSimulation(dtSec: number): void {
    // Decay rebound animations on blocks
    for (const b of this.board.blocks) {
      if (b.reboundTimerMs > 0) {
        b.reboundTimerMs = Math.max(0, b.reboundTimerMs - dtSec * 1000);
      }
    }

    // Pause timers when not in game screen, when title overlay or modal is open, or during Booster Targeting (UX-04)
    if (
      this.titleOverlayOpen ||
      this.activeScreen !== 'game' ||
      this.levelOutcomeHandled ||
      !this.board.timerRunning ||
      this.inputController.getInputMode() !== 'DRAG' ||
      this.isAnyModalOpen()
    ) {
      return;
    }

    if (this.board.freezeRemainingSec > 0) {
      this.board.freezeRemainingSec = Math.max(0, this.board.freezeRemainingSec - dtSec);
      this.syncTimerPillOnly();
      return;
    }

    const playMode = this.saveManager.getPayload().settings.playMode;
    if (playMode === 'TIMED') {
      this.board.timeRemainingSec = Math.max(0, this.board.timeRemainingSec - dtSec);
      this.bombSecondAccumulator += dtSec;
      while (this.bombSecondAccumulator >= 1.0) {
        this.bombSecondAccumulator -= 1.0;
        for (const b of this.board.blocks) {
          if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount > 0) {
            b.bombCount = Math.max(0, b.bombCount - 1);
          }
        }
      }
      this.syncTimerPillOnly();
      this.checkWinOrLossAfterAction();
    }
  }

  private buildRenderOptions(dtSec = 1 / 60, timeSec?: number): RenderSceneOptions {
    const save = this.saveManager.getPayload();
    const hover = this.inputController.getHoverState();
    const activeBlockId = hover.activeBlockId ?? this.board.hintMove?.blockId ?? null;

    let dragTargetRow: number | null = null;
    let dragTargetCol: number | null = null;
    let dragEligibleGateIndex: number | null = null;

    if (hover.activeBlockId !== null) {
      const blk = this.board.blocks.find((b) => b.id === hover.activeBlockId);
      if (blk) {
        dragTargetRow = Math.round(blk.y);
        dragTargetCol = Math.round(blk.x);
        const gIdx = findEligibleGateForBlockAt(
          this.board,
          blk,
          dragTargetRow,
          dragTargetCol
        );
        if (gIdx >= 0) dragEligibleGateIndex = gIdx;
      }
    } else if (this.board.hintMove) {
      dragTargetRow = this.board.hintMove.targetRow;
      dragTargetCol = this.board.hintMove.targetCol;
      if (this.board.hintMove.exitsGateIndex >= 0) {
        dragEligibleGateIndex = this.board.hintMove.exitsGateIndex;
      }
    }

    let autoGuideMove: { blockId: number; targetRow: number; targetCol: number } | null = null;
    if (
      !this.titleOverlayOpen &&
      hover.activeBlockId === null &&
      hover.inputMode === 'DRAG' &&
      !this.board.hintMove &&
      !this.levelOutcomeHandled &&
      this.cachedAutoGuideMove
    ) {
      const isImmediateOnboardingOrAxisDebut =
        (this.board.levelId <= 5 || this.board.levelId === 11) && this.board.movesCommitted === 0;
      const isIdleEarlyOrShowcase =
        (this.board.levelId <= 30 || this.currentLevelHasUnlockNote) &&
        performance.now() - this.lastPointerActivityMs >= 4000;
      if (isImmediateOnboardingOrAxisDebut || isIdleEarlyOrShowcase) {
        autoGuideMove = this.cachedAutoGuideMove;
      }
    }

    return {
      draggedBlockId: activeBlockId,
      dragTargetRow,
      dragTargetCol,
      dragEligibleGateIndex,
      autoGuideMove,
      inputMode: hover.inputMode,
      rocketAxis: hover.rocketAxis,
      hoverRow: hover.hoverRow >= 0 ? hover.hoverRow : null,
      hoverCol: hover.hoverCol >= 0 ? hover.hoverCol : null,
      equippedSkin: save.equippedSkin,
      equippedTray: save.equippedTray,
      equippedParticle: save.equippedParticle,
      colorblindSymbols: save.settings.colorblindSymbols,
      highContrast: save.settings.highContrast,
      reducedMotion: save.settings.reducedMotion,
      qualityTier: save.settings.qualityTier,
      dtSec,
      timeSec,
    };
  }

  private renderNow(dtSec = 1 / 60, timeSec?: number): void {
    this.renderer.render(this.board, this.buildRenderOptions(dtSec, timeSec));
  }

  // ===========================================================================
  // UI SYNCHRONIZATION & SCREENS
  // ===========================================================================

  public isNewPlayerSave(save: SavePayloadV1 = this.saveManager.getPayload()): boolean {
    return (
      save.highestLevelUnlocked <= 1 &&
      save.currentLevelId <= 1 &&
      save.totalMovesCommitted === 0 &&
      save.totalBlocksShredded === 0 &&
      Object.keys(save.levelRecords).length === 0 &&
      save.unlockedSkins.length <= 1 &&
      save.unlockedTrays.length <= 1 &&
      save.unlockedParticles.length <= 1
    );
  }

  private syncTitleOverlayDom(): void {
    const titleEl = document.getElementById('title-overlay');
    const homeEl = document.getElementById('screen-home');
    const gameEl = document.getElementById('screen-game');
    const themesEl = document.getElementById('screen-themes');
    const tabBarEl = document.getElementById('menu-tab-bar');

    if (this.titleOverlayOpen) {
      if (titleEl) titleEl.hidden = false;
      if (homeEl) {
        homeEl.hidden = true;
        homeEl.inert = true;
      }
      if (themesEl) {
        themesEl.hidden = true;
        themesEl.inert = true;
      }
      if (tabBarEl) {
        tabBarEl.hidden = true;
        tabBarEl.inert = true;
      }
      if (gameEl) {
        gameEl.hidden = false;
        gameEl.inert = true;
        gameEl.classList.add('title-backdrop-mode');
      }
      this.renderer.resize();
      return;
    }

    if (titleEl) titleEl.hidden = true;
    if (homeEl) {
      homeEl.hidden = this.activeScreen !== 'home';
      homeEl.inert = false;
    }
    if (themesEl) {
      themesEl.hidden = this.activeScreen !== 'themes';
      themesEl.inert = false;
    }
    if (tabBarEl) {
      tabBarEl.hidden = this.activeScreen === 'game';
      tabBarEl.inert = false;
    }
    if (gameEl) {
      gameEl.hidden = this.activeScreen !== 'game';
      gameEl.inert = false;
      gameEl.classList.remove('title-backdrop-mode');
    }
    if (this.activeScreen === 'game') {
      this.renderer.resize();
    }
  }

  public openTitleScreen(): void {
    this.titleOverlayOpen = true;
    const save = this.saveManager.getPayload();
    const targetLevelId = Math.max(1, save.currentLevelId || save.highestLevelUnlocked || 1);
    if (this.board.levelId !== targetLevelId) {
      this.loadLevel(targetLevelId, false, false);
    }
    this.syncAllUiFromSave();
    this.syncTitleOverlayDom();
    this.renderer.resize();
    this.renderNow();
  }

  public dismissTitleScreen(targetScreen: 'game' | 'home' | 'themes' = 'game'): void {
    this.titleOverlayOpen = false;
    this.switchScreen(targetScreen);
    if (targetScreen === 'game' && this.board.movesCommitted === 0) {
      const spec = getLevelSpec(this.board.levelId);
      this.showUnlockNoteIfPresent(spec.unlockNote ?? BOOSTER_DEBUT_NOTES[this.board.levelId]);
      this.lastPointerActivityMs = performance.now();
    }
  }

  public switchScreen(screen: 'home' | 'game' | 'themes'): void {
    this.activeScreen = screen;
    this.titleOverlayOpen = false;
    this.syncTitleOverlayDom();

    document
      .getElementById('tab-btn-home')
      ?.classList.toggle('active', screen === 'home');
    document
      .getElementById('tab-btn-themes')
      ?.classList.toggle('active', screen === 'themes');

    if (screen === 'home') {
      this.renderRoadmap();
    } else if (screen === 'themes') {
      this.renderThemesStudio();
    } else if (screen === 'game') {
      this.renderer.resize();
      this.syncInGameHud();
      this.renderNow();
    }
  }

  private syncAllUiFromSave(): void {
    const save = this.saveManager.getPayload();

    this.sound.updateSettings({
      sfxEnabled: save.settings.sfxEnabled,
      musicEnabled: save.settings.musicEnabled,
      hapticsEnabled: save.settings.hapticsEnabled,
    });
    this.renderer.setQualityPreference(save.settings.qualityTier);

    // Header Economy Pills
    const coinsEl = document.getElementById('stat-coins');
    const starsEl = document.getElementById('stat-stars');
    const streakEl = document.getElementById('stat-streak');
    const themesCoinsEl = document.getElementById('themes-coins-display');

    if (coinsEl) coinsEl.textContent = String(save.coins);
    if (starsEl) starsEl.textContent = String(save.totalStars);
    if (streakEl) streakEl.textContent = String(save.winStreak);
    if (themesCoinsEl) themesCoinsEl.textContent = String(save.coins);

    // Chests Progress
    const shredChestProg = Math.min(100, Math.max(0, save.shredderChestProgress % 100));
    const shredText = document.getElementById('shredder-chest-text');
    const shredFill = document.getElementById('shredder-chest-fill');
    if (shredText) shredText.textContent = `${shredChestProg} / 100`;
    if (shredFill) shredFill.style.width = `${shredChestProg}%`;

    const nextMilestone = Math.ceil(Math.max(1, save.highestLevelUnlocked) / 10) * 10;
    const milestoneStep = ((save.highestLevelUnlocked - 1) % 10) * 10;
    const mileText = document.getElementById('milestone-chest-text');
    const mileFill = document.getElementById('milestone-chest-fill');
    if (mileText) mileText.textContent = `Level ${nextMilestone}`;
    if (mileFill) mileFill.style.width = `${Math.max(10, milestoneStep)}%`;

    // Hero Launch Card
    const targetLevelId = Math.max(1, save.currentLevelId || save.highestLevelUnlocked || 1);
    const targetSpec = getLevelSpec(targetLevelId);
    const chapterMeta = getChapterMetaForLevel(targetLevelId);
    const heroChapterTag = document.getElementById('hero-chapter-tag');
    const heroDiff = document.getElementById('hero-badge-difficulty');
    const heroHeading = document.getElementById('hero-level-heading');
    const heroNote = document.getElementById('hero-level-note');
    const playBtn = document.getElementById('btn-play-current');
    const tabPlayLabel = document.getElementById('tab-play-label');

    if (heroChapterTag) {
      heroChapterTag.textContent = `${chapterMeta.chapterNum} · ${chapterMeta.title.toUpperCase()}`;
    }
    if (heroDiff) {
      heroDiff.textContent = targetSpec.difficulty.replace('_', ' ');
      heroDiff.className = `badge-difficulty diff-${targetSpec.difficulty.toLowerCase()}`;
    }
    if (heroHeading) {
      heroHeading.textContent = `Level ${targetSpec.id} — ${targetSpec.name}`;
    }
    if (heroNote) {
      heroNote.textContent =
        targetSpec.unlockNote ??
        `Clear all blocks in ${targetSpec.parMoves ?? 6} moves for 3 Stars`;
    }
    if (playBtn) {
      playBtn.textContent = `▶ PLAY LEVEL ${targetSpec.id}`;
    }
    if (tabPlayLabel) {
      tabPlayLabel.textContent = `Play Lvl ${targetSpec.id}`;
    }

    // Sacred-Geometry Title Crest Overlay (Adaptive New vs. Returning Player State)
    const isNewPlayer = this.isNewPlayerSave(save);
    const titleNewTagline = document.getElementById('title-new-player-tagline');
    const titleReturningSummary = document.getElementById('title-returning-summary');
    const titleReturningNav = document.getElementById('title-returning-nav');
    const titleChapterBadge = document.getElementById('title-chapter-badge');
    const titleLevelSubtitle = document.getElementById('title-level-subtitle');
    const titleStatStars = document.getElementById('title-stat-stars');
    const titleStatCoins = document.getElementById('title-stat-coins');
    const titleStatStreak = document.getElementById('title-stat-streak');
    const titlePlayBtn = document.getElementById('btn-title-play');
    const titleSyncLabel = document.getElementById('title-sync-label');

    if (titleNewTagline) titleNewTagline.hidden = !isNewPlayer;
    if (titleReturningSummary) titleReturningSummary.hidden = isNewPlayer;
    if (titleReturningNav) titleReturningNav.hidden = isNewPlayer;
    if (titleChapterBadge) {
      titleChapterBadge.textContent = `${chapterMeta.chapterNum} · ${chapterMeta.title.toUpperCase()}`;
    }
    if (titleLevelSubtitle) {
      titleLevelSubtitle.textContent = `Level ${targetSpec.id} — ${targetSpec.name}`;
    }
    if (titleStatStars) titleStatStars.textContent = String(save.totalStars);
    if (titleStatCoins) titleStatCoins.textContent = String(save.coins);
    if (titleStatStreak) titleStatStreak.textContent = String(save.winStreak);
    if (titlePlayBtn) {
      titlePlayBtn.textContent = isNewPlayer
        ? '▶ BEGIN JOURNEY'
        : `▶ CONTINUE · LEVEL ${targetSpec.id}`;
    }
    if (titleSyncLabel) {
      titleSyncLabel.textContent = isNewPlayer ? 'Restore Save' : 'Sync';
    }
    this.syncInstallUiVisibility();

    // Settings Checkboxes & Selects
    const setChecked = (id: string, val: boolean) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.checked = val;
    };
    setChecked('toggle-sfx', save.settings.sfxEnabled);
    setChecked('toggle-music', save.settings.musicEnabled);
    setChecked('toggle-haptics', save.settings.hapticsEnabled);
    setChecked('toggle-colorblind', save.settings.colorblindSymbols);
    setChecked('toggle-high-contrast', save.settings.highContrast);
    setChecked('toggle-reduced-motion', save.settings.reducedMotion);

    const tierSelect = document.getElementById(
      'select-quality-tier'
    ) as HTMLSelectElement | null;
    if (tierSelect) {
      tierSelect.value = save.settings.qualityTier;
    }

    const hudSfxBtn = document.getElementById('btn-hud-sfx');
    const hudMusicBtn = document.getElementById('btn-hud-music');
    if (hudSfxBtn) hudSfxBtn.textContent = save.settings.sfxEnabled ? '🔊' : '🔇';
    if (hudMusicBtn) hudMusicBtn.textContent = save.settings.musicEnabled ? '🎵' : '🔕';

    this.syncInGameHud();
  }

  private syncInGameHud(): void {
    const save = this.saveManager.getPayload();
    const playMode = save.settings.playMode;

    const titleEl = document.getElementById('hud-level-title');
    const diffEl = document.getElementById('hud-difficulty-badge');
    const coinsInline = document.getElementById('hud-coins-inline');
    const shredInline = document.getElementById('hud-shred-inline');
    const modeLabel = document.getElementById('hud-mode-label');
    const movesPill = document.getElementById('hud-moves-pill');
    const timerPill = document.getElementById('hud-timer-pill');

    if (titleEl) {
      titleEl.textContent = `Level ${this.board.levelId} — ${this.board.name}`;
    }
    if (diffEl) {
      diffEl.textContent = this.board.difficulty.replace('_', ' ');
      diffEl.className = `badge-difficulty diff-${this.board.difficulty.toLowerCase()}`;
    }
    if (coinsInline) {
      coinsInline.textContent = `${save.coins}`;
    }
    if (shredInline) {
      const prog = (save.shredderChestProgress + this.board.sessionBlocksShredded) % 100;
      shredInline.textContent = `${prog}/100`;
    }
    if (modeLabel) {
      modeLabel.textContent = playMode === 'ZEN' ? 'Zen Mode' : 'Timed Rush';
    }
    if (movesPill) {
      movesPill.textContent = `Moves: ${this.board.movesCommitted} / Par ${this.board.parMoves}`;
    }
    if (timerPill) {
      timerPill.hidden = playMode !== 'TIMED';
    }
    this.syncTimerPillOnly();

    const svgHint = document.getElementById('svg-booster-hint');
    const svgFreeze = document.getElementById('svg-booster-freeze');
    const freezeLabel = document.getElementById('label-booster-freeze');
    if (svgHint) svgHint.toggleAttribute('hidden', playMode !== 'ZEN');
    if (svgFreeze) svgFreeze.toggleAttribute('hidden', playMode === 'ZEN');
    if (freezeLabel) freezeLabel.textContent = playMode === 'ZEN' ? 'Hint' : 'Freeze';

    // Boosters Dock Badges, Rarity Accents & Progressive Level Unlocking (ECON-01 / ECON-02)
    const effectiveLevel = Math.max(this.board.levelId, save.highestLevelUnlocked);

    const syncBoosterSlot = (btnId: string, badgeId: string, type: BoosterType) => {
      const btnEl = document.getElementById(btnId);
      const badgeEl = document.getElementById(badgeId);
      const unlocked = isBoosterUnlocked(type, effectiveLevel);
      const rarity = BOOSTER_RARITY[type].toLowerCase();

      if (btnEl) {
        btnEl.classList.remove(
          'rarity-common',
          'rarity-uncommon',
          'rarity-rare',
          'rarity-epic',
          'rarity-legendary'
        );
        btnEl.classList.add(`rarity-${rarity}`);
        btnEl.classList.toggle('locked-booster', !unlocked);
        btnEl.setAttribute('data-rarity', BOOSTER_RARITY[type]);
      }

      if (!badgeEl) return;

      if (!unlocked) {
        badgeEl.textContent = `Lvl ${BOOSTER_UNLOCK_LEVEL[type]}`;
        badgeEl.className = 'booster-badge badge-locked';
        return;
      }

      if (type === 'UNDO' && this.freeUndosRemaining > 0) {
        badgeEl.textContent = `FREE (${this.freeUndosRemaining})`;
        badgeEl.className = 'booster-badge badge-free';
        return;
      }

      const count = save.boosters[type] ?? 0;
      if (count > 0) {
        badgeEl.textContent = String(count);
        badgeEl.className = `booster-badge badge-rarity-${rarity}`;
      } else {
        badgeEl.textContent = `${UI_BOOSTER_PRICES[type]} Coins`;
        badgeEl.className = 'booster-badge badge-coin';
      }
    };

    syncBoosterSlot('btn-booster-undo', 'badge-booster-undo', 'UNDO');
    syncBoosterSlot('btn-booster-freeze', 'badge-booster-freeze', 'FREEZE');
    syncBoosterSlot('btn-booster-hammer', 'badge-booster-hammer', 'HAMMER');
    syncBoosterSlot('btn-booster-rocket', 'badge-booster-rocket', 'ROCKET');
    syncBoosterSlot('btn-booster-vacuum', 'badge-booster-vacuum', 'VACUUM');
  }

  private syncTimerPillOnly(): void {
    const timerPill = document.getElementById('hud-timer-pill');
    if (!timerPill || timerPill.hidden) return;

    const totalSec = Math.max(0, Math.ceil(this.board.timeRemainingSec));
    const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');

    if (this.board.freezeRemainingSec > 0) {
      timerPill.textContent = `❄️ ${mins}:${secs} (${Math.ceil(this.board.freezeRemainingSec)}s)`;
      timerPill.className = 'tabular-metric timer-pill frozen';
    } else {
      timerPill.textContent = `⏱ ${mins}:${secs}`;
      timerPill.className =
        totalSec <= 15
          ? 'tabular-metric timer-pill urgent'
          : 'tabular-metric timer-pill';
    }
  }

  private renderRoadmap(): void {
    const container = document.getElementById('roadmap-list');
    if (!container) return;

    const save = this.saveManager.getPayload();
    const allCampaign = getAllCampaignLevels();
    const unlockedMax = Math.max(1, save.highestLevelUnlocked);

    let levelsToShow = allCampaign;
    if (this.activeRoadmapRange === '1-50') {
      levelsToShow = allCampaign.filter((l) => l.id >= 1 && l.id <= 50);
    } else if (this.activeRoadmapRange === '51-100') {
      levelsToShow = allCampaign.filter((l) => l.id >= 51 && l.id <= 100);
    } else if (this.activeRoadmapRange === '101-150') {
      levelsToShow = allCampaign.filter((l) => l.id >= 101 && l.id <= 150);
    } else if (this.activeRoadmapRange === '151-200') {
      levelsToShow = allCampaign.filter((l) => l.id >= 151 && l.id <= 200);
    } else if (this.activeRoadmapRange === '201-250') {
      levelsToShow = allCampaign.filter((l) => l.id >= 201 && l.id <= 250);
    } else if (this.activeRoadmapRange === '251-300') {
      levelsToShow = allCampaign.filter((l) => l.id >= 251 && l.id <= 300);
    } else if (this.activeRoadmapRange === 'endless') {
      levelsToShow = [];
    }

    const fragment = document.createDocumentFragment();

    const createChapterBanner = (
      kickerText: string,
      titleText: string,
      subtitleText: string,
      starsText: string
    ) => {
      const banner = document.createElement('div');
      banner.className = 'roadmap-chapter-banner';
      banner.setAttribute('role', 'presentation');

      const leftDiv = document.createElement('div');
      leftDiv.className = 'chapter-banner-meta';

      const kicker = document.createElement('span');
      kicker.className = 'chapter-banner-kicker';
      kicker.textContent = kickerText;

      const title = document.createElement('h3');
      title.className = 'chapter-banner-title';
      title.textContent = titleText;

      const sub = document.createElement('p');
      sub.className = 'chapter-banner-sub';
      sub.textContent = subtitleText;

      leftDiv.append(kicker, title, sub);

      const rightDiv = document.createElement('div');
      rightDiv.className = 'chapter-banner-stars';
      rightDiv.textContent = starsText;

      banner.append(leftDiv, rightDiv);
      return banner;
    };

    let lastChapterNum = '';

    for (const spec of levelsToShow) {
      const ch = getChapterMetaForLevel(spec.id);
      if (ch.chapterNum !== lastChapterNum) {
        lastChapterNum = ch.chapterNum;
        let chStars = 0;
        for (let lid = ch.startLevel; lid <= ch.endLevel; lid++) {
          chStars += save.levelRecords[lid]?.stars ?? 0;
        }
        const maxStars = (ch.endLevel - ch.startLevel + 1) * 3;
        fragment.appendChild(
          createChapterBanner(
            `${ch.chapterNum} · LEVELS ${ch.startLevel}–${ch.endLevel}`,
            ch.title,
            ch.subtitle,
            `★ ${chStars} / ${maxStars}`
          )
        );
      }

      const isUnlocked = spec.id <= unlockedMax;
      const isCurrent = spec.id === save.currentLevelId;
      const record = save.levelRecords[spec.id];

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'listitem');
      btn.dataset.levelId = String(spec.id);
      btn.className = [
        'level-node-card',
        `tier-${spec.difficulty.toLowerCase()}`,
        isCurrent ? 'current-level' : '',
        !isUnlocked ? 'locked-level' : '',
      ]
        .filter(Boolean)
        .join(' ');

      let starDisplay = isUnlocked ? '☆☆☆' : '🔒';
      if (record) {
        if (record.skipped && record.stars === 0) {
          starDisplay = '⏭️ Skipped';
        } else if (record.stars > 0) {
          starDisplay = '⭐'.repeat(record.stars) + '☆'.repeat(3 - record.stars);
        }
      }

      const topRow = document.createElement('div');
      topRow.className = 'node-top-row';

      const numSpan = document.createElement('span');
      numSpan.className = 'node-level-num';
      numSpan.textContent = `#${spec.id}`;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = `badge-difficulty diff-${spec.difficulty.toLowerCase()}`;
      badgeSpan.textContent = spec.difficulty.replace('_', ' ');

      const starsSpan = document.createElement('span');
      starsSpan.className = 'node-stars';
      starsSpan.textContent = starDisplay;

      topRow.append(numSpan, badgeSpan, starsSpan);

      const nameDiv = document.createElement('div');
      nameDiv.className = 'node-name';
      nameDiv.textContent = spec.name;

      btn.append(topRow, nameDiv);

      if (spec.unlockNote) {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'node-unlock-note';
        noteDiv.textContent = `✨ ${spec.unlockNote}`;
        btn.appendChild(noteDiv);
      }

      btn.addEventListener('click', () => {
        if (!isUnlocked) {
          this.sound.playWallClack();
          this.showGameToast(`🔒 Clear or Skip up to Level ${spec.id} to unlock!`);
          return;
        }
        this.sound.playButtonTap();
        this.loadLevel(spec.id, true);
      });

      fragment.appendChild(btn);
    }

    // Append Procedural Endless Mastery Nodes (301..306 or beyond highestLevelUnlocked)
    if (this.activeRoadmapRange === 'all' || this.activeRoadmapRange === 'endless') {
      const endlessCh = getChapterMetaForLevel(TOTAL_CAMPAIGN_LEVELS + 1);
      fragment.appendChild(
        createChapterBanner(
          `${endlessCh.chapterNum} · LEVEL ${TOTAL_CAMPAIGN_LEVELS + 1}+`,
          endlessCh.title,
          endlessCh.subtitle,
          '∞ Procedural'
        )
      );
      const maxEndlessPreview = Math.max(TOTAL_CAMPAIGN_LEVELS + 6, unlockedMax + 3);
      for (let eid = TOTAL_CAMPAIGN_LEVELS + 1; eid <= maxEndlessPreview; eid++) {
        const spec = getLevelSpec(eid);
        const isUnlocked = eid <= unlockedMax || this.activeRoadmapRange === 'endless';
        const record = save.levelRecords[eid];

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'listitem');
        btn.dataset.levelId = String(eid);
        btn.className = [
          'level-node-card',
          `tier-${spec.difficulty.toLowerCase()}`,
          !isUnlocked ? 'locked-level' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const topRow = document.createElement('div');
        topRow.className = 'node-top-row';

        const numSpan = document.createElement('span');
        numSpan.className = 'node-level-num';
        numSpan.textContent = `♾️ #${eid}`;

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `badge-difficulty diff-${spec.difficulty.toLowerCase()}`;
        badgeSpan.textContent = spec.difficulty.replace('_', ' ');

        const starsSpan = document.createElement('span');
        starsSpan.className = 'node-stars';
        starsSpan.textContent =
          record && record.stars > 0
            ? '⭐'.repeat(record.stars)
            : isUnlocked
              ? '☆☆☆'
              : '🔒';

        topRow.append(numSpan, badgeSpan, starsSpan);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'node-name';
        nameDiv.textContent = spec.name;

        btn.append(topRow, nameDiv);

        btn.addEventListener('click', () => {
          this.sound.playButtonTap();
          this.loadLevel(eid, true);
        });

        fragment.appendChild(btn);
      }
    }

    container.replaceChildren(fragment);
  }

  private renderThemesStudio(): void {
    const save = this.saveManager.getPayload();
    const particleIcons: Record<string, string> = {
      micro_cubes: '◆',
      star_confetti: '✦',
      pixel_sparks: '✴',
      soap_bubbles: '◎',
      lightning_bolts: '↯',
    };

    const buildCategoryGrid = <T extends string>(
      containerId: string,
      items: ReadonlyArray<{ id: T; name: string; desc: string }>,
      unlockedList: T[],
      equippedId: T,
      onAction: (id: T) => void
    ) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      const frag = document.createDocumentFragment();
      for (const item of items) {
        const isUnlocked = unlockedList.includes(item.id);
        const isEquipped = equippedId === item.id;

        const card = document.createElement('div');
        card.className = `theme-card ${isEquipped ? 'equipped' : ''}`;

        const topDiv = document.createElement('div');
        topDiv.className = 'theme-card-top';

        const swatchDiv = document.createElement('div');
        swatchDiv.className = `theme-swatch swatch-${item.id}`;
        if (particleIcons[item.id]) {
          swatchDiv.textContent = particleIcons[item.id];
        }

        const metaDiv = document.createElement('div');
        const h4 = document.createElement('h4');
        h4.className = 'theme-card-title';
        h4.textContent = item.name;
        const p = document.createElement('p');
        p.className = 'theme-card-desc';
        p.textContent = item.desc;
        metaDiv.append(h4, p);
        topDiv.append(swatchDiv, metaDiv);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.themeId = item.id;
        btn.className = `btn-tactile btn-compact ${
          isEquipped ? 'btn-primary' : isUnlocked ? 'btn-secondary' : 'btn-warning'
        }`;
        btn.textContent = isEquipped
          ? '✦ Equipped'
          : isUnlocked
            ? 'Equip'
            : `Unlock · ${THEME_UNLOCK_PRICE} Coins`;

        btn.addEventListener('click', () => onAction(item.id));
        card.append(topDiv, btn);
        frag.appendChild(card);
      }
      container.replaceChildren(frag);
    };

    buildCategoryGrid(
      'themes-skins-grid',
      SKIN_CATALOG,
      save.unlockedSkins,
      save.equippedSkin,
      (skinId) => {
        if (this.saveManager.unlockOrEquipSkin(skinId, THEME_UNLOCK_PRICE)) {
          this.sound.playButtonTap();
          this.renderThemesStudio();
          this.renderNow();
        } else {
          this.sound.playWallClack();
          this.showGameToast(`Need ${THEME_UNLOCK_PRICE} Coins to unlock this cosmetic!`);
        }
      }
    );

    buildCategoryGrid(
      'themes-trays-grid',
      TRAY_CATALOG,
      save.unlockedTrays,
      save.equippedTray,
      (trayId) => {
        if (this.saveManager.unlockOrEquipTray(trayId, THEME_UNLOCK_PRICE)) {
          this.sound.playButtonTap();
          this.renderThemesStudio();
          this.renderNow();
        } else {
          this.sound.playWallClack();
          this.showGameToast(`Need ${THEME_UNLOCK_PRICE} Coins to unlock this cosmetic!`);
        }
      }
    );

    buildCategoryGrid(
      'themes-particles-grid',
      PARTICLE_CATALOG,
      save.unlockedParticles,
      save.equippedParticle,
      (particleId) => {
        if (this.saveManager.unlockOrEquipParticle(particleId, THEME_UNLOCK_PRICE)) {
          this.sound.playButtonTap();
          this.renderThemesStudio();
          this.renderNow();
        } else {
          this.sound.playWallClack();
          this.showGameToast(`Need ${THEME_UNLOCK_PRICE} Coins to unlock this cosmetic!`);
        }
      }
    );
  }

  // ===========================================================================
  // MODALS, SAVE BACKUP, QR CODE & DIFF CONFIRMATION (UX-06, UX-07)
  // ===========================================================================

  private getModalElement(id: ModalId): HTMLDialogElement | null {
    return document.getElementById(`dialog-${id}`) as HTMLDialogElement | null;
  }

  private isAnyModalOpen(): boolean {
    const ids: ModalId[] = ['victory', 'failure', 'pause', 'save-transfer', 'install'];
    return ids.some((id) => this.getModalElement(id)?.open);
  }

  public openModal(id: ModalId): void {
    this.closeAllModals();
    const dialog = this.getModalElement(id);
    if (!dialog) return;

    if (id === 'pause') {
      this.updateTelemetryReadout();
    } else if (id === 'save-transfer') {
      this.refreshSaveTransferModal();
    } else if (id === 'install') {
      const nativeBanner = document.getElementById('native-install-banner');
      if (nativeBanner) {
        nativeBanner.hidden = !this.deferredInstallPrompt;
      }
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  public closeAllModals(): void {
    const ids: ModalId[] = ['victory', 'failure', 'pause', 'save-transfer', 'install'];
    for (const id of ids) {
      const dlg = this.getModalElement(id);
      if (dlg?.open) {
        dlg.close();
        dlg.returnValue = '';
      }
    }
  }

  private setupDialogLightDismiss(): void {
    const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog.game-dialog');
    dialogs.forEach((dialog) => {
      const isTerminalOutcomeModal =
        dialog.id === 'dialog-victory' || dialog.id === 'dialog-failure';

      dialog.addEventListener('close', () => {
        dialog.returnValue = '';
      });

      if (isTerminalOutcomeModal) {
        // Terminal level-outcome modals (Victory / Failure) must not be dismissed by Escape or
        // trailing pointer-release clicks after mid-drag gate capture on the final block (PLAY-02).
        dialog.addEventListener('cancel', (e) => {
          e.preventDefault();
        });
        return;
      }

      let pointerDownOnBackdrop = false;
      dialog.addEventListener('pointerdown', (e: PointerEvent) => {
        pointerDownOnBackdrop = e.target === dialog;
      });

      // Light-dismiss click handler checking that pointerdown started on the dialog backdrop
      dialog.addEventListener('click', (e: MouseEvent) => {
        const startedOnBackdrop = pointerDownOnBackdrop;
        pointerDownOnBackdrop = false;
        if (!startedOnBackdrop || e.target !== dialog) return;
        if (e.clientX === 0 && e.clientY === 0) return; // Ignore keyboard synthetic click
        const rect = dialog.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const clickedOutside =
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom;
        if (clickedOutside) {
          dialog.close();
        }
      });
    });
  }

  private updateTelemetryReadout(): void {
    const el = document.getElementById('telemetry-readout');
    if (!el) return;
    const t = this.renderer.getTelemetry();
    el.textContent = `FPS: ${t.fps} | Work: ${t.avgWorkMs}ms (p95: ${t.p95WorkMs}ms) | Tier: ${t.activeTier} | Backend: ${t.rendererBackend}`;
  }

  private refreshSaveTransferModal(): void {
    const codeOutput = document.getElementById(
      'save-code-output'
    ) as HTMLTextAreaElement | null;
    const qrContainer = document.getElementById('qr-code-container');
    const restoreBtn = document.getElementById('btn-restore-backup');
    const statusEl = document.getElementById('save-transfer-status');

    const code = this.saveManager.exportSaveCode();
    if (codeOutput) {
      codeOutput.value = code;
    }

    if (qrContainer) {
      try {
        const shareUrl = this.saveManager.buildShareUrl();
        qrContainer.innerHTML = generateQrSvg(shareUrl);
      } catch {
        try {
          qrContainer.innerHTML = generateQrSvg(code);
        } catch {
          qrContainer.textContent = 'QR code unavailable for this payload size.';
        }
      }
    }

    if (restoreBtn) {
      restoreBtn.hidden = !this.saveManager.hasPreImportBackup();
    }

    if (statusEl && !this.pendingImportPayload) {
      statusEl.textContent = '';
    }
  }

  public previewSaveImport(rawInput: string): boolean {
    const statusEl = document.getElementById('save-transfer-status');
    const diffPanel = document.getElementById('import-diff-panel');
    const curList = document.getElementById('diff-current-list');
    const incList = document.getElementById('diff-incoming-list');
    const inputArea = document.getElementById(
      'save-code-input'
    ) as HTMLTextAreaElement | null;

    this.openModal('save-transfer');
    if (inputArea) {
      inputArea.value = rawInput;
    }

    const trimmed = rawInput.trim();
    if (!trimmed) {
      if (statusEl) statusEl.textContent = '⚠️ Please paste a SB1-... Save Code or JSON backup.';
      if (diffPanel) diffPanel.hidden = true;
      return false;
    }

    try {
      let incoming: SavePayloadV1;
      if (trimmed.startsWith('{')) {
        incoming = validateSavePayloadV1(JSON.parse(trimmed));
      } else {
        incoming = decodeSaveCode(trimmed);
      }

      this.pendingImportPayload = incoming;
      this.pendingImportRawCode = trimmed;

      const current = this.saveManager.getPayload();
      const renderSummaryItems = (targetUl: HTMLElement | null, p: SavePayloadV1) => {
        if (!targetUl) return;
        const dateStr = new Date(p.updatedAt || Date.now()).toLocaleString();
        const items = [
          `Max Level: Level ${p.highestLevelUnlocked}`,
          `Total Stars: ⭐ ${p.totalStars}`,
          `Coins: ${p.coins} Coins`,
          `Updated: ${dateStr}`,
        ];
        targetUl.replaceChildren(
          ...items.map((text) => {
            const li = document.createElement('li');
            li.textContent = text;
            return li;
          })
        );
      };

      renderSummaryItems(curList, current);
      renderSummaryItems(incList, incoming);

      if (diffPanel) {
        diffPanel.hidden = false;
        diffPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (statusEl) {
        statusEl.textContent = '✅ Valid save verified! Review the comparison below to confirm.';
      }
      return true;
    } catch (err) {
      this.pendingImportPayload = null;
      this.pendingImportRawCode = null;
      if (diffPanel) diffPanel.hidden = true;
      if (statusEl) {
        statusEl.textContent = `❌ ${err instanceof Error ? err.message : 'Invalid save code.'}`;
      }
      return false;
    }
  }

  private confirmPendingSaveImport(): void {
    const statusEl = document.getElementById('save-transfer-status');
    const diffPanel = document.getElementById('import-diff-panel');
    if (!this.pendingImportRawCode) return;

    try {
      const raw = this.pendingImportRawCode.trim();
      const updated = raw.startsWith('{')
        ? this.saveManager.importSaveJson(raw)
        : this.saveManager.importSaveCode(raw);

      this.pendingImportPayload = null;
      this.pendingImportRawCode = null;
      if (diffPanel) diffPanel.hidden = true;

      if (window.location.hash.includes('import=')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      this.refreshSaveTransferModal();
      this.syncAllUiFromSave();
      this.renderRoadmap();
      this.renderThemesStudio();
      this.loadLevel(updated.currentLevelId || updated.highestLevelUnlocked || 1, false);

      if (statusEl) {
        statusEl.textContent =
          '🎉 Save imported! Your previous save is backed up and can be restored anytime.';
      }
      this.sound.playWinFanfare();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `❌ Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }
  }

  private checkUrlHashForSaveImport(): void {
    const code = extractImportCodeFromHash(window.location.hash);
    if (code) {
      this.previewSaveImport(code);
    }
  }

  // ===========================================================================
  // TOASTS & BANNERS
  // ===========================================================================

  private showGameToast(message: string, durationMs = 2600): void {
    const toast = document.getElementById('game-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    if (this.toastTimerId !== null) {
      clearTimeout(this.toastTimerId);
    }
    this.toastTimerId = setTimeout(() => {
      toast.hidden = true;
    }, durationMs);
  }

  private showUnlockNoteIfPresent(note?: string): void {
    const banner = document.getElementById('unlock-toast');
    const textEl = document.getElementById('unlock-toast-text');
    if (!banner || !textEl) return;

    if (this.unlockToastTimerId !== null) {
      clearTimeout(this.unlockToastTimerId);
      this.unlockToastTimerId = null;
    }

    if (!note) {
      banner.hidden = true;
      return;
    }

    textEl.textContent = note;
    banner.hidden = false;
    this.unlockToastTimerId = setTimeout(() => {
      banner.hidden = true;
    }, 5500);
  }

  // ===========================================================================
  // EVENT BINDINGS & PWA SERVICE WORKER (STOR-03)
  // ===========================================================================

  private bindDomEvents(): void {
    // Sacred-Geometry Title Crest Overlay Actions
    document.getElementById('btn-title-play')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      const save = this.saveManager.getPayload();
      const targetId = this.isNewPlayerSave(save)
        ? 1
        : Math.max(1, save.currentLevelId || save.highestLevelUnlocked || 1);
      if (this.board.levelId !== targetId) {
        this.loadLevel(targetId, true);
      } else {
        this.dismissTitleScreen('game');
      }
    });
    document.getElementById('btn-title-map')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.dismissTitleScreen('home');
    });
    document.getElementById('btn-title-themes')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.dismissTitleScreen('themes');
    });
    document.getElementById('btn-title-sync')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('save-transfer');
    });
    document.getElementById('btn-title-settings')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('pause');
    });
    document.getElementById('btn-title-install')?.addEventListener('click', () => {
      void this.handleInstallAction();
    });
    document.getElementById('btn-home-title')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openTitleScreen();
    });

    // Bottom Navigation Tabs
    document.getElementById('tab-btn-home')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.switchScreen('home');
    });
    document.getElementById('tab-btn-play')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      const save = this.saveManager.getPayload();
      this.loadLevel(save.currentLevelId || save.highestLevelUnlocked || 1, true);
    });
    document.getElementById('tab-btn-themes')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.switchScreen('themes');
    });
    document.getElementById('tab-btn-save')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('save-transfer');
    });
    document.getElementById('tab-btn-settings')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('pause');
    });

    // Home Screen Actions
    document.getElementById('btn-play-current')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      const save = this.saveManager.getPayload();
      this.loadLevel(save.currentLevelId || save.highestLevelUnlocked || 1, true);
    });

    document.getElementById('btn-install-header')?.addEventListener('click', () => {
      void this.handleInstallAction();
    });

    // Roadmap Filter Chips
    document.querySelectorAll<HTMLButtonElement>('.chip-filter[data-range]').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.sound.playButtonTap();
        document
          .querySelectorAll('.chip-filter[data-range]')
          .forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeRoadmapRange = chip.dataset.range ?? 'all';
        this.renderRoadmap();
      });
    });

    // Themes Studio Category Filter Tabs
    document.querySelectorAll<HTMLButtonElement>('[data-theme-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.sound.playButtonTap();
        const cat = tab.dataset.themeTab ?? 'all';
        document.querySelectorAll('[data-theme-tab]').forEach((t) => {
          const active = t === tab;
          t.classList.toggle('active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll<HTMLElement>('[data-theme-section]').forEach((sec) => {
          sec.hidden = cat !== 'all' && sec.dataset.themeSection !== cat;
        });
      });
    });

    // Direct Level Jump
    const jumpInput = document.getElementById('level-jump-input') as HTMLInputElement | null;
    document.getElementById('btn-level-jump')?.addEventListener('click', () => {
      if (!jumpInput) return;
      const val = Number(jumpInput.value);
      if (Number.isFinite(val) && val >= 1) {
        this.sound.playButtonTap();
        this.loadLevel(Math.min(999, Math.floor(val)), true);
      }
    });

    // In-Game HUD Top Bar & Direct Map Return
    document.getElementById('btn-hud-home')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.inputController.cancelTargeting();
      this.closeAllModals();
      this.switchScreen('home');
    });

    document.getElementById('btn-themes-home')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.switchScreen('home');
    });

    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('pause');
    });

    document.getElementById('btn-mode-toggle')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      const cur = this.saveManager.getPayload().settings.playMode;
      const next: PlayMode = cur === 'ZEN' ? 'TIMED' : 'ZEN';
      const hadMoves = this.board.movesCommitted > 0;
      this.saveManager.updateSettings({ playMode: next });
      if (hadMoves) {
        this.loadLevel(this.board.levelId, true);
      } else {
        this.syncInGameHud();
        this.renderNow();
      }
      this.showGameToast(
        next === 'ZEN'
          ? `🧘 Switched to Zen Mode${hadMoves ? ' — Level Restarted' : ''}`
          : `⏱ Switched to Timed Rush${hadMoves ? ' — Level Restarted' : ''}`
      );
    });

    document.getElementById('btn-hud-sfx')?.addEventListener('click', () => {
      const cur = this.saveManager.getPayload().settings.sfxEnabled;
      this.saveManager.updateSettings({ sfxEnabled: !cur });
      this.sound.playButtonTap();
    });

    document.getElementById('btn-hud-music')?.addEventListener('click', () => {
      const cur = this.saveManager.getPayload().settings.musicEnabled;
      this.saveManager.updateSettings({ musicEnabled: !cur });
      this.sound.playButtonTap();
    });

    document.getElementById('btn-restart')?.addEventListener('click', () => {
      this.restartCurrentLevel();
    });

    document.getElementById('btn-skip-hud')?.addEventListener('click', () => {
      this.skipCurrentLevel();
    });

    // Booster Targeting Banner
    document.getElementById('btn-rocket-axis')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.inputController.toggleRocketAxis();
      this.syncBoosterTargetingBanner(this.inputController.getHoverState());
    });

    document.getElementById('btn-cancel-booster')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.inputController.cancelTargeting();
    });

    // Bottom Booster Dock
    document.getElementById('btn-booster-undo')?.addEventListener('click', () => {
      this.activateBooster('UNDO');
    });
    document.getElementById('btn-booster-freeze')?.addEventListener('click', () => {
      this.activateBooster('FREEZE');
    });
    document.getElementById('btn-booster-hammer')?.addEventListener('click', () => {
      this.activateBooster('HAMMER');
    });
    document.getElementById('btn-booster-rocket')?.addEventListener('click', () => {
      this.activateBooster('ROCKET');
    });
    document.getElementById('btn-booster-vacuum')?.addEventListener('click', () => {
      this.activateBooster('VACUUM');
    });

    // Victory Modal Buttons
    document.getElementById('btn-victory-home')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
      this.switchScreen('home');
    });
    document.getElementById('btn-victory-replay')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.loadLevel(this.board.levelId, true);
    });
    document.getElementById('btn-next-level')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.loadLevel(this.board.levelId + 1, true);
    });

    // Failure Modal Buttons
    document.getElementById('btn-failure-home')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
      this.switchScreen('home');
    });
    document.getElementById('btn-continue-level')?.addEventListener('click', () => {
      this.continueFailedLevel();
    });
    document.getElementById('btn-retry-level')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.loadLevel(this.board.levelId, true);
    });
    document.getElementById('btn-skip-level')?.addEventListener('click', () => {
      this.skipCurrentLevel();
    });

    // Pause & Settings Modal Controls
    document.getElementById('btn-pause-close')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
    });
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
      if (this.titleOverlayOpen) {
        this.dismissTitleScreen('game');
      }
    });
    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.closeAllModals();
      if (this.titleOverlayOpen) {
        this.dismissTitleScreen('game');
      }
      this.restartCurrentLevel();
    });
    document.getElementById('btn-pause-skip')?.addEventListener('click', () => {
      this.skipCurrentLevel();
    });
    document.getElementById('btn-pause-save-transfer')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('save-transfer');
    });
    document.getElementById('btn-pause-install')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.openModal('install');
    });
    document.getElementById('btn-pause-home')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
      this.switchScreen('home');
    });

    const bindToggle = (id: string, key: keyof SavePayloadV1['settings']) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.addEventListener('change', () => {
        this.saveManager.updateSettings({ [key]: el.checked });
        this.renderNow();
      });
    };
    bindToggle('toggle-sfx', 'sfxEnabled');
    bindToggle('toggle-music', 'musicEnabled');
    bindToggle('toggle-haptics', 'hapticsEnabled');
    bindToggle('toggle-colorblind', 'colorblindSymbols');
    bindToggle('toggle-high-contrast', 'highContrast');
    bindToggle('toggle-reduced-motion', 'reducedMotion');

    const qualitySelect = document.getElementById(
      'select-quality-tier'
    ) as HTMLSelectElement | null;
    qualitySelect?.addEventListener('change', () => {
      const tier = qualitySelect.value as QualityTier;
      this.saveManager.updateSettings({ qualityTier: tier });
      this.renderer.setQualityPreference(tier);
      this.renderNow();
    });

    // Save Backup & Transfer Modal
    document.getElementById('btn-save-transfer-close')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
    });

    document.getElementById('btn-copy-save-code')?.addEventListener('click', async () => {
      this.sound.playButtonTap();
      const code = this.saveManager.exportSaveCode();
      const statusEl = document.getElementById('save-transfer-status');
      try {
        await navigator.clipboard.writeText(code);
        if (statusEl) statusEl.textContent = '📋 Compact Save Code copied to clipboard!';
      } catch {
        if (statusEl) statusEl.textContent = '📋 Select and copy the SB1-... code above.';
      }
    });

    document.getElementById('btn-copy-sync-url')?.addEventListener('click', async () => {
      this.sound.playButtonTap();
      const url = this.saveManager.buildShareUrl();
      const statusEl = document.getElementById('save-transfer-status');
      try {
        await navigator.clipboard.writeText(url);
        if (statusEl) statusEl.textContent = '🔗 Magic Sync URL copied to clipboard!';
      } catch {
        if (statusEl) statusEl.textContent = `🔗 Sync URL: ${url}`;
      }
    });

    document.getElementById('btn-download-json')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.saveManager.downloadSaveJsonFile();
      const statusEl = document.getElementById('save-transfer-status');
      if (statusEl) statusEl.textContent = '📥 Downloaded shredblocks-save-backup.json!';
    });

    document.getElementById('btn-preview-import')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      const inputEl = document.getElementById(
        'save-code-input'
      ) as HTMLTextAreaElement | null;
      this.previewSaveImport(inputEl ? inputEl.value : '');
    });

    const fileInput = document.getElementById('file-upload-json') as HTMLInputElement | null;
    document.getElementById('btn-upload-json')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      this.previewSaveImport(text);
      fileInput.value = '';
    });

    document.getElementById('btn-confirm-import')?.addEventListener('click', () => {
      this.confirmPendingSaveImport();
    });

    document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.pendingImportPayload = null;
      this.pendingImportRawCode = null;
      const diffPanel = document.getElementById('import-diff-panel');
      if (diffPanel) diffPanel.hidden = true;
    });

    document.getElementById('btn-restore-backup')?.addEventListener('click', () => {
      const restored = this.saveManager.restorePreImportBackup();
      if (restored) {
        this.sound.playBooster('UNDO');
        this.refreshSaveTransferModal();
        this.syncAllUiFromSave();
        this.renderRoadmap();
        this.renderThemesStudio();
        const statusEl = document.getElementById('save-transfer-status');
        if (statusEl) {
          statusEl.textContent = '⏪ Restored pre-import local save backup!';
        }
      }
    });

    // Install Modal
    document.getElementById('btn-install-close')?.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.closeAllModals();
    });

    document.getElementById('btn-trigger-native-install')?.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) return;
      await this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        this.markPwaInstalled();
      }
      this.deferredInstallPrompt = null;
      this.closeAllModals();
    });

    window.addEventListener('hashchange', () => {
      this.checkUrlHashForSaveImport();
    });
  }

  public isPwaInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    const standaloneMedia =
      window.matchMedia?.(
        '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)'
      ).matches ?? false;
    const iosStandalone = Boolean(
      (window.navigator as Navigator & { standalone?: boolean }).standalone
    );
    const twaReferrer =
      typeof document !== 'undefined' && document.referrer.startsWith('android-app://');

    if (standaloneMedia || iosStandalone || twaReferrer) {
      this.pwaInstalledDetected = true;
      try {
        window.localStorage.setItem(ShredBlocksApp.PWA_INSTALLED_STORAGE_KEY, '1');
      } catch {
        // Ignore storage errors
      }
      return true;
    }

    try {
      if (window.localStorage.getItem(ShredBlocksApp.PWA_INSTALLED_STORAGE_KEY) === '1') {
        return true;
      }
    } catch {
      // Ignore storage errors
    }

    return this.pwaInstalledDetected;
  }

  private markPwaInstalled(): void {
    this.pwaInstalledDetected = true;
    try {
      window.localStorage.setItem(ShredBlocksApp.PWA_INSTALLED_STORAGE_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    this.syncInstallUiVisibility();
  }

  private syncInstallUiVisibility(): void {
    const installed = this.isPwaInstalled();
    const headerInstallBtn = document.getElementById('btn-install-header');
    const titleInstallBtn = document.getElementById('btn-title-install');
    if (headerInstallBtn) headerInstallBtn.hidden = installed;
    if (titleInstallBtn) titleInstallBtn.hidden = installed;
  }

  private async handleInstallAction(): Promise<void> {
    this.sound.playButtonTap();
    if (this.deferredInstallPrompt) {
      try {
        await this.deferredInstallPrompt.prompt();
        const choice = await this.deferredInstallPrompt.userChoice;
        this.deferredInstallPrompt = null;
        if (choice.outcome === 'accepted') {
          this.markPwaInstalled();
          this.closeAllModals();
        }
        return;
      } catch {
        // Fall through to install guide modal
      }
    }
    this.openModal('install');
  }

  private setupPwaAndServiceWorker(): void {
    this.syncInstallUiVisibility();

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredInstallPrompt = e as BeforeInstallPromptEvent;
      this.syncInstallUiVisibility();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.markPwaInstalled();
      this.closeAllModals();
      this.showGameToast('📲 ShredBlocks installed to your device!');
    });

    try {
      window
        .matchMedia('(display-mode: standalone)')
        .addEventListener('change', () => this.syncInstallUiVisibility());
    } catch {
      // Ignore on legacy browsers
    }

    const navWithRelated = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<
        Array<{ id?: string; platform?: string; url?: string }>
      >;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      void navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            this.markPwaInstalled();
          }
        })
        .catch(() => {
          // Ignore unsupported or cross-origin frame errors
        });
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            if (reg.waiting && navigator.serviceWorker.controller) {
              this.waitingServiceWorker = reg.waiting;
              this.showPwaUpdateToast();
            }

            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              if (!newWorker) return;
              newWorker.addEventListener('statechange', () => {
                if (
                  newWorker.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  this.waitingServiceWorker = newWorker;
                  this.showPwaUpdateToast();
                }
              });
            });
          })
          .catch(() => {
            // Ignore SW errors in restricted test environments
          });
      });

      let refreshing = false;
      let userRequestedSwUpdate = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!userRequestedSwUpdate || refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      document.getElementById('btn-pwa-update-now')?.addEventListener('click', () => {
        if (this.waitingServiceWorker) {
          userRequestedSwUpdate = true;
          this.waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
        }
        const toast = document.getElementById('pwa-update-toast');
        if (toast) toast.hidden = true;
      });
    }

    document.getElementById('btn-pwa-update-dismiss')?.addEventListener('click', () => {
      const toast = document.getElementById('pwa-update-toast');
      if (toast) toast.hidden = true;
    });
  }

  private showPwaUpdateToast(): void {
    const toast = document.getElementById('pwa-update-toast');
    if (toast) toast.hidden = false;
  }

  // ===========================================================================
  // AUTOMATION & E2E VERIFICATION BRIDGE (window.__SHREDBLOCKS_DEBUG__)
  // ===========================================================================

  public createDebugBridge(): ShredBlocksDebugBridge {
    return {
      getBoard: () => this.board,
      getSave: () => this.saveManager.getPayload(),
      loadLevel: (levelId: number) => this.loadLevel(levelId, true),
      commitMove: (blockId: number, targetRow: number, targetCol: number) =>
        this.commitMove(blockId, targetRow, targetCol),
      autoSolveCurrentLevel: () => this.autoSolveCurrentLevel(),
      setPlayMode: (mode: PlayMode) => {
        this.saveManager.updateSettings({ playMode: mode });
        this.syncInGameHud();
        this.renderNow();
      },
      setColorblindMode: (enabled: boolean) => {
        this.saveManager.updateSettings({ colorblindSymbols: enabled });
        this.renderNow();
      },
      setHighContrast: (enabled: boolean) => {
        this.saveManager.updateSettings({ highContrast: enabled });
        this.renderNow();
      },
      setTheme: (skin: SkinId, tray: TrayId, particle: ParticleStyleId) => {
        this.saveManager.unlockOrEquipSkin(skin, 0);
        this.saveManager.unlockOrEquipTray(tray, 0);
        this.saveManager.unlockOrEquipParticle(particle, 0);
        this.renderThemesStudio();
        this.renderNow();
      },
      activateBooster: (type: BoosterType) => {
        this.activateBooster(type);
      },
      openModal: (id: ModalId) => {
        this.openModal(id);
      },
      closeAllModals: () => {
        this.closeAllModals();
      },
      openTitleScreen: () => {
        this.openTitleScreen();
      },
      dismissTitleScreen: (targetScreen = 'game') => {
        this.dismissTitleScreen(targetScreen);
      },
      isTitleScreenOpen: () => {
        return this.titleOverlayOpen;
      },
      previewSaveImport: (code: string) => {
        return this.previewSaveImport(code);
      },
      getTelemetry: () => {
        return this.renderer.getTelemetry();
      },
      run120HzBenchmark: (frames = 120) => {
        return this.renderer.run120HzBenchmark(frames, this.board);
      },
      simulateContextLoss: () => {
        const canvas = this.renderer.canvas;
        const lostEvent = new Event('webglcontextlost', { cancelable: true });
        canvas.dispatchEvent(lostEvent);
        const restoredEvent = new Event('webglcontextrestored');
        canvas.dispatchEvent(restoredEvent);
        this.renderNow();
      },
      boardToScreen: (boardX: number, boardY: number) => {
        const rect = this.renderer.canvas.getBoundingClientRect();
        return this.renderer
          .getCamera()
          .boardToScreen(boardX, boardY, 0.58, rect, this.board.rows, this.board.cols);
      },
    };
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
