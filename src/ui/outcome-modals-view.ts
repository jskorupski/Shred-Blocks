import { computeEarnedStars, isBoardDeadlocked, isBoardWon } from '../core/board';
import { hasFinalTouchGrace } from '../core/board-state';
import type { PlayMode } from '../core/types';
import { solveBoard } from '../levels/solver';
import { spawnBombDetonationBurstImpl } from '../render/particle-fx';
import {
  BOOSTER_RARITY,
  CONTINUE_COIN_COST,
  countUniqueClearedLevels,
  type LevelWinRewardSummary,
} from '../storage/save-manager';
import {
  type AppViewContext,
  BOOSTER_DISPLAY_NAMES,
  BOOSTER_TOKENS,
  formatCompactLevelRef,
  getPlayModeMeta,
  setButtonIconLabel,
  setRichModeText,
} from './catalog-meta';
import { startVictoryModalFx } from './victory-modal-fx';

/**
 * Level outcome feedback & board-to-dialog choreography (`OUTCOME-TRANSITION-01`, `ECON-V2`,
 * `OUT_OF_MOVES` / `TIME_OUT` / `BOMB_EXPLODED`, `FINAL-TOUCH-01`, `STUCK-01`), extracted from
 * `hud-and-title-view.ts` (`ARCH-ERGONOMICS-01`); imported directly by `main.ts`.
 */

/** `OUTCOME-TRANSITION-01`: 220ms gate-roller shred + 70ms celebratory bloom before overlapped 360ms Victory dissolve */
export const VICTORY_MODAL_BEAT_MS = 290;
/** `OUTCOME-TRANSITION-01`: brief board settle beat on Out of Moves / Time's Up before 360ms Failure dissolve */
export const FAILURE_SETTLE_BEAT_MS = 220;
/** `OUTCOME-TRANSITION-01`: 3D crimson-amber shockwave + radial burst beat on Bomb Exploded before Failure dissolve */
export const BOMB_DETONATION_BEAT_MS = 350;

let pendingOutcomeTimerId: ReturnType<typeof setTimeout> | null = null;
let pendingOutcomeAction: (() => void) | null = null;

export function isOutcomeTransitionPending(): boolean {
  return pendingOutcomeTimerId !== null;
}

export function cancelPendingOutcomeTransition(): void {
  if (pendingOutcomeTimerId !== null) {
    clearTimeout(pendingOutcomeTimerId);
    pendingOutcomeTimerId = null;
  }
  pendingOutcomeAction = null;
}

export function flushPendingOutcomeTransition(): void {
  const action = pendingOutcomeAction;
  cancelPendingOutcomeTransition();
  if (action) {
    action();
  }
}

function shouldSkipOutcomeBeat(frozenTimeSec: number | null, reducedMotion: boolean): boolean {
  if (frozenTimeSec !== null || reducedMotion) return true;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function populateVictoryModalImpl(app: AppViewContext, summary: LevelWinRewardSummary): void {
  const dialogVictory = document.getElementById('dialog-victory');
  const titleEl = document.getElementById('victory-title');
  const subtitleEl = document.getElementById('victory-subtitle');
  const starsEl = document.getElementById('victory-stars');
  const underParBannerEl = document.getElementById('victory-under-par-banner');
  const movesEl = document.getElementById('victory-moves');
  const coinsTotalEl = document.getElementById('victory-coins-total');
  const breakdownEl = document.getElementById('victory-coins-breakdown');
  const chestFanfareEl = document.getElementById('victory-chest-fanfare');
  const shredTextEl = document.getElementById('victory-shred-chest-text');
  const shredFillEl = document.getElementById('victory-shred-chest-fill');
  const milestoneTextEl = document.getElementById('victory-milestone-chest-text');
  const milestoneFillEl = document.getElementById('victory-milestone-chest-fill');

  const save = app.saveManager.getPayload();
  const playMode = save.settings.playMode;
  const modeInfo = getPlayModeMeta(playMode);
  const isUnderPar = Boolean(summary.underPar);
  const movesSaved = summary.underParMovesSaved ?? Math.max(0, app.board.parMoves - app.board.movesCommitted);

  dialogVictory?.setAttribute('data-under-par', isUnderPar ? 'true' : 'false');

  const nextLevelBtn = document.getElementById('btn-next-level');
  if (nextLevelBtn) {
    setButtonIconLabel(nextLevelBtn, {
      mode: playMode,
      modeIcon: modeInfo.icon,
      actionGlyph: '▶',
      actionKind: 'play',
      label: 'Next Level',
    });
  }

  if (titleEl) {
    titleEl.textContent = isUnderPar
      ? `✦ Level ${app.board.levelId} · Under Par!`
      : `Level ${app.board.levelId} Cleared!`;
  }
  if (subtitleEl) {
    setRichModeText(
      subtitleEl,
      summary.zenClear
        ? summary.zenStarAwarded
          ? '★ +1 Gold Star Earned in Zen Sanctuary! Every 3 unique Zen clears awards a Gold Star.'
          : `🌿 Tranquil Zen Clear — ★ ${save.zenStarProgress}/3 toward next Gold Star · Blessings ${save.zenBlessings}/3`
        : isUnderPar
          ? `Astrolabe Outsmarted — ${movesSaved} ${movesSaved === 1 ? 'move' : 'moves'} faster than the Sanctuary solver!`
          : summary.starsEarned === 3
            ? 'Flawless 3-Star Shredder Mastery!'
            : summary.starsEarned === 2
              ? 'Great Job! Clear in fewer moves for 3 Stars!'
              : 'Stage Complete! Clear closer to Par for 3 Stars!'
    );
  }
  if (underParBannerEl) {
    if (isUnderPar) {
      const kicker = document.createElement('span');
      kicker.className = 'under-par-kicker';
      kicker.textContent = '✦ SECRET FEAT · ORACLE OUTSMARTED';
      const detail = document.createElement('span');
      detail.className = 'under-par-detail';
      if (summary.firstUnderPar && summary.underParBooster) {
        const bName = BOOSTER_DISPLAY_NAMES[summary.underParBooster];
        const bRarity = BOOSTER_RARITY[summary.underParBooster];
        setRichModeText(
          detail,
          `Solved in ${app.board.movesCommitted} vs. Par ${app.board.parMoves}! Bounty: +${summary.underParCoins ?? 0} Coins & ${BOOSTER_TOKENS[summary.underParBooster]} +1 ${bName} [${bRarity}]`
        );
      } else {
        detail.textContent = `Solved in ${app.board.movesCommitted} vs. Par ${app.board.parMoves}! Oracle Encore — Stage Bounty Claimed`;
      }
      underParBannerEl.replaceChildren(kicker, detail);
      underParBannerEl.hidden = false;
    } else {
      underParBannerEl.replaceChildren();
      underParBannerEl.hidden = true;
    }
  }
  if (starsEl) {
    if (summary.zenClear) {
      const pill = document.createElement('span');
      pill.className = 'zen-victory-pill';
      setRichModeText(
        pill,
        summary.zenStarAwarded
          ? '🌿 Zen Cleared · ★ +1 Gold Star Earned!'
          : `🌿 Zen Cleared · ★ ${save.zenStarProgress}/3`
      );
      starsEl.replaceChildren(pill);
    } else {
      const slots: HTMLSpanElement[] = [];
      for (let i = 0; i < 3; i++) {
        const span = document.createElement('span');
        const isEarned = i < summary.starsEarned;
        span.className = isEarned ? 'star-slot earned' : 'star-slot unearned';
        span.textContent = isEarned ? '★' : '☆';
        slots.push(span);
      }
      starsEl.replaceChildren(...slots);
    }
  }
  if (movesEl) {
    movesEl.textContent = isUnderPar
      ? `${app.board.movesCommitted} / Par ${app.board.parMoves} (−${movesSaved})`
      : `${app.board.movesCommitted} / Par ${app.board.parMoves}`;
    movesEl.classList.toggle('stat-value-under-par', isUnderPar);
  }
  if (coinsTotalEl) {
    coinsTotalEl.textContent = `+${summary.totalCoinsEarned} Coins`;
  }
  if (breakdownEl) {
    const parts: string[] = [
      summary.zenClear
        ? summary.isFirstClear
          ? `Zen Clear: +${summary.baseCoins}`
          : `Zen Replay: +${summary.baseCoins}`
        : summary.isFirstClear
          ? `First Clear: +${summary.baseCoins}`
          : `Replay Bonus: +${summary.baseCoins}`,
    ];
    if (summary.starCoins > 0) parts.push(`New Stars: +${summary.starCoins}`);
    if (summary.streakCoins > 0) parts.push(`Flow Streak: +${summary.streakCoins}`);
    if ((summary.underParCoins ?? 0) > 0) parts.push(`✦ Oracle Bounty: +${summary.underParCoins}`);
    if (summary.chestCoins > 0) parts.push(`Chests: +${summary.chestCoins}`);
    breakdownEl.textContent = parts.join(' • ');
  }
  const shredChestProg = Math.min(100, Math.max(0, save.shredderChestProgress % 100));
  const milestoneStep = summary.milestoneChestOpened ? 10 : countUniqueClearedLevels(save) % 10;
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
    const boosterLabels = summary.rewardedBoosters.map(
      (b) => `${BOOSTER_TOKENS[b]} +1 ${BOOSTER_DISPLAY_NAMES[b]} [${BOOSTER_RARITY[b]}]`
    );
    let bCursor = 0;
    if (summary.shredderChestsOpened > 0) {
      const slice = boosterLabels.slice(bCursor, bCursor + summary.shredderChestsOpened);
      bCursor += summary.shredderChestsOpened;
      const rewardPart = slice.length > 0 ? slice.join(', ') : 'Free Booster';
      chestNotes.push(
        `◇ Shredder Chest Opened! (+${summary.shredderChestsOpened * 50} Coins & ${rewardPart})`
      );
    }
    if (summary.milestoneChestOpened) {
      const rewardPart = boosterLabels[bCursor] ?? 'Free Booster';
      bCursor++;
      chestNotes.push(`★ Milestone Chest Opened! (+75 Coins & ${rewardPart})`);
    }
    if (summary.starReliquaryChestsOpened > 0) {
      const slice = boosterLabels.slice(bCursor, bCursor + summary.starReliquaryChestsOpened);
      const rewardPart = slice.length > 0 ? slice.join(', ') : 'Free Booster';
      chestNotes.push(
        `✦ Star Reliquary Chest Opened! (+${summary.starReliquaryChestsOpened * 90} Coins & ${rewardPart})`
      );
    }
    if (summary.zenBlessingAwarded) {
      chestNotes.push(`🌿 Zen Blessing Earned! (${save.zenBlessings}/3 Free Continues Banked)`);
    }
    if (chestNotes.length > 0) {
      setRichModeText(chestFanfareEl, chestNotes.join(' | '));
      chestFanfareEl.hidden = false;
    } else {
      delete chestFanfareEl.dataset.richModeSig;
      chestFanfareEl.replaceChildren();
      chestFanfareEl.hidden = true;
    }
  }
}

export function handleLevelVictoryImpl(app: AppViewContext, frozenTimeSec: number | null): void {
  cancelPendingOutcomeTransition();
  app.inputController.cancelActiveDrag?.();
  app.inputController.cancelTargeting();

  const playMode = app.saveManager.getPayload().settings.playMode;
  const zenClear = playMode === 'ZEN' || app.runTouchedZen;
  const pureBoosterFreeRun =
    !zenClear && (app.board.powerUpsUsed ?? 0) === 0 && (app.board.continuesUsed ?? 0) === 0;
  const earnedStars = computeEarnedStars(app.board, playMode, app.runTouchedZen);
  const elapsedSec = Math.max(1, Math.round(app.board.timeLimitSec - app.board.timeRemainingSec));
  // Persist rewards synchronously at t=0ms so closing the app or navigating mid-shred never drops progress
  const summary = app.saveManager.recordLevelWin(
    app.board.levelId,
    app.board.movesCommitted,
    elapsedSec,
    Math.max(1, app.board.sessionBlocksShredded),
    earnedStars,
    app.board.parMoves,
    app.board.difficulty,
    zenClear,
    pureBoosterFreeRun
  );

  populateVictoryModalImpl(app, summary);
  const postSave = app.saveManager.getPayload();
  const boardAtWin = app.board;

  const presentVictoryModal = () => {
    if (
      app.board !== boardAtWin ||
      !app.levelOutcomeHandled ||
      app.activeScreen !== 'game' ||
      app.titleOverlayOpen
    ) {
      return;
    }
    const latestSave = app.saveManager.getPayload();
    app.sound.playWinFanfare(earnedStars);
    if (summary.underPar) {
      app.sound.playUnderParOracleChime();
    }
    app.openModal('victory');
    startVictoryModalFx({
      isUnderPar: Boolean(summary.underPar),
      earnedStars,
      equippedParticle: latestSave.equippedParticle,
      reducedMotion: latestSave.settings.reducedMotion,
      frozen: frozenTimeSec !== null,
      activeTier: app.renderer.getQualityGovernor().getActiveTier(),
    });
  };

  if (shouldSkipOutcomeBeat(frozenTimeSec, postSave.settings.reducedMotion)) {
    presentVictoryModal();
    return;
  }

  pendingOutcomeAction = presentVictoryModal;
  pendingOutcomeTimerId = setTimeout(() => {
    pendingOutcomeTimerId = null;
    pendingOutcomeAction = null;
    presentVictoryModal();
  }, VICTORY_MODAL_BEAT_MS);
}

export function handleLevelFailureImpl(
  app: AppViewContext,
  reason: 'TIME_OUT' | 'BOMB_EXPLODED' | 'OUT_OF_MOVES',
  frozenTimeSec: number | null = null
): void {
  cancelPendingOutcomeTransition();
  // A timeout/bomb can fire mid-drag in TIMED: drop the held block so release can't "win" behind the modal
  app.inputController.cancelActiveDrag?.();
  app.inputController.cancelTargeting();
  app.saveManager.recordLevelLoss();

  if (reason === 'BOMB_EXPLODED') {
    spawnBombDetonationBurstImpl(app.renderer, app.board);
    app.renderNow();
    app.sound.playLossBuzzer();
  }

  const save = app.saveManager.getPayload();
  const playMode = save.settings.playMode;
  const titleEl = document.getElementById('failure-title');
  const reasonEl = document.getElementById('failure-reason');
  const retryBtn = document.getElementById('btn-retry-level');
  const blessingBtn = document.getElementById('btn-use-zen-blessing');
  const continueBtn = document.getElementById('btn-continue-level');
  const zenBtn = document.getElementById('btn-failure-zen');

  if (retryBtn) {
    setButtonIconLabel(retryBtn, {
      mode: playMode,
      actionGlyph: '↻',
      actionKind: 'restart',
      label: 'Try Again (Free)',
    });
  }

  if (blessingBtn) {
    const blessings = save.zenBlessings || 0;
    blessingBtn.hidden = playMode === 'ZEN' || blessings <= 0;
    setButtonIconLabel(blessingBtn, {
      mode: 'ZEN',
      label:
        reason === 'OUT_OF_MOVES'
          ? `Zen Blessing: +5 Moves (Free · ${blessings}/3)`
          : reason === 'BOMB_EXPLODED'
            ? `Zen Blessing: Defuse & Continue (Free · ${blessings}/3)`
            : `Zen Blessing: +20 Seconds (Free · ${blessings}/3)`,
    });
  }

  if (zenBtn) {
    zenBtn.hidden = playMode === 'ZEN';
    setButtonIconLabel(zenBtn, {
      mode: 'ZEN',
      label: `Switch to Zen Mode · ${formatCompactLevelRef(save.modeState.ZEN.currentLevelId)}`,
    });
  }

  if (titleEl) {
    titleEl.textContent =
      reason === 'OUT_OF_MOVES'
        ? '🛑 Out of Moves!'
        : reason === 'BOMB_EXPLODED'
          ? '💣 Bomb Exploded!'
          : "⏰ Time's Up!";
  }
  if (reasonEl) {
    reasonEl.textContent =
      reason === 'OUT_OF_MOVES'
        ? 'You reached the move budget! Retry for free, use a Zen Blessing or Coins for +5 moves, or switch to Zen Mode.'
        : reason === 'BOMB_EXPLODED'
          ? 'A countdown bomb reached zero! Retry for free, defuse with a Zen Blessing or Coins, or switch to Zen Mode.'
          : 'You ran out of time in Speed Rush! Retry for free, add +20 seconds with a Zen Blessing or Coins, or switch to Zen Mode.';
  }
  if (continueBtn) {
    setButtonIconLabel(continueBtn, {
      actionGlyph: '+',
      actionKind: 'plus',
      label:
        reason === 'OUT_OF_MOVES'
          ? `+5 Moves (${CONTINUE_COIN_COST} Coins)`
          : reason === 'BOMB_EXPLODED'
            ? `Defuse & Continue (${CONTINUE_COIN_COST} Coins)`
            : `+20 Seconds (${CONTINUE_COIN_COST} Coins)`,
    });
  }

  const boardAtLoss = app.board;
  const presentFailureModal = () => {
    if (
      app.board !== boardAtLoss ||
      !app.levelOutcomeHandled ||
      app.activeScreen !== 'game' ||
      app.titleOverlayOpen
    ) {
      return;
    }
    if (reason !== 'BOMB_EXPLODED') {
      app.sound.playLossBuzzer();
    }
    app.openModal('failure');
  };

  if (shouldSkipOutcomeBeat(frozenTimeSec, save.settings.reducedMotion)) {
    presentFailureModal();
    return;
  }

  const beatMs = reason === 'BOMB_EXPLODED' ? BOMB_DETONATION_BEAT_MS : FAILURE_SETTLE_BEAT_MS;
  pendingOutcomeAction = presentFailureModal;
  pendingOutcomeTimerId = setTimeout(() => {
    pendingOutcomeTimerId = null;
    pendingOutcomeAction = null;
    presentFailureModal();
  }, beatMs);
}

function applyContinueRescueToBoard(app: AppViewContext, playMode: PlayMode): void {
  app.board.continuesUsed = (app.board.continuesUsed ?? 0) + 1; // STARS-SLACK-01: caps this clear at 1★
  if (playMode === 'CHALLENGE') {
    app.board.movesRemaining = Math.max(5, app.board.movesRemaining + 5);
    app.board.moveLimit += 5;
  } else if (playMode === 'TIMED') {
    app.board.timeRemainingSec = Math.max(20, app.board.timeRemainingSec + 20);
  }
  for (const b of app.board.blocks) {
    if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount <= 0) {
      b.bombCount = Math.max(5, b.bombMax);
    }
  }
  app.levelOutcomeHandled = false;
  app.board.timerRunning = true;
  app.closeAllModals();
  app.sound.playBooster('HINT');
  app.syncAllUiFromSave();
  app.renderNow();
}

export function continueFailedLevelImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  if (save.coins < CONTINUE_COIN_COST || !app.saveManager.buyBoosterWithCoins('HINT', CONTINUE_COIN_COST)) {
    app.showGameToast(
      `Need ${CONTINUE_COIN_COST} Coins — Retry for FREE or bank a 🌿 Zen Blessing in Zen Mode!`
    );
    return;
  }
  app.saveManager.spendBooster('HINT');
  applyContinueRescueToBoard(app, save.settings.playMode);
}

export function useZenBlessingContinueImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  if (save.settings.playMode === 'ZEN' || !app.saveManager.consumeZenBlessing()) {
    return;
  }
  applyContinueRescueToBoard(app, save.settings.playMode);
  app.showGameToast(
    save.settings.playMode === 'TIMED'
      ? '🌿 Zen Blessing used — +20 Seconds granted (Free)!'
      : '🌿 Zen Blessing used — +5 Moves granted (Free)!'
  );
}

/**
 * `FINAL-TOUCH-01`: with `0` moves left in `CHALLENGE`, explain the free final touch (after a committed move that
 * leaves grace) or why a different block's move was rejected.
 */
export function notifyFinalTouchImpl(app: AppViewContext, moved: boolean): void {
  if (app.levelOutcomeHandled || app.saveManager.getPayload().settings.playMode !== 'CHALLENGE') return;
  if (app.board.movesRemaining > 0 || app.board.freeMovesRemaining > 0 || !hasFinalTouchGrace(app.board))
    return;
  app.showGameToast(
    moved
      ? '✋ Last move! Finish sliding that block into its gate — it stays free.'
      : '✋ Out of moves — only your last block can still finish into its gate.',
    3200
  );
}

let stuckCheckToken = 0;

/**
 * `STUCK-01`: after each committed move, an idle-time exhaustive solver probe warns when the board has become
 * provably unsolvable (immediate gridlock, or a search that empties its open set without a solution). Budget-limited
 * searches that merely time out never warn, so there are zero false positives. Critical in Zen, where no move
 * budget, clock, or bomb will ever end a stuck run on its own.
 */
export function scheduleStuckBoardCheckImpl(app: AppViewContext): void {
  const token = ++stuckCheckToken;
  const boardAtSchedule = app.board;
  const run = () => {
    if (token !== stuckCheckToken || app.board !== boardAtSchedule || app.levelOutcomeHandled) return;
    if (isBoardWon(app.board)) return;
    const stuck =
      isBoardDeadlocked(app.board) ||
      (() => {
        const res = solveBoard(app.board, 450);
        return !res.solvable && res.searchExhausted === true;
      })();
    if (!stuck || token !== stuckCheckToken) return;
    const zen = app.saveManager.getPayload().settings.playMode === 'ZEN';
    app.showGameToast(
      zen
        ? '🌿 This board can no longer be solved — tap Undo, a Power-Up, or Retry to keep flowing.'
        : '⚠️ No solution left from here — use Undo, a Power-Up, or Retry!',
      4200
    );
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(run, { timeout: 700 });
  else setTimeout(run, 60);
}
