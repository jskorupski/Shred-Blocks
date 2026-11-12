import { isBoardDeadlocked, isBoardWon } from '../core/board';
import { hasFinalTouchGrace } from '../core/board-state';
import { solveBoard } from '../levels/solver';
import { BOOSTER_RARITY, CONTINUE_COIN_COST, type LevelWinRewardSummary } from '../storage/save-manager';
import { type AppViewContext, BOOSTER_DISPLAY_NAMES } from './catalog-meta';

/**
 * Level outcome feedback (`ECON-V2` victory rewards, `OUT_OF_MOVES` / `TIME_OUT` / `BOMB_EXPLODED` failure options,
 * `FINAL-TOUCH-01` grace hints, and `STUCK-01` provably-unsolvable warnings), extracted from `hud-and-title-view.ts`
 * (`ARCH-ERGONOMICS-01`); imported directly by `main.ts`.
 */

export function populateVictoryModalImpl(app: AppViewContext, summary: LevelWinRewardSummary): void {
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

  const save = app.saveManager.getPayload();

  if (titleEl) {
    titleEl.textContent = `Level ${app.board.levelId} Cleared!`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = summary.zenClear
      ? summary.zenStarAwarded
        ? '★ +1 Gold Star Earned in Zen Sanctuary! Every 3 unique Zen clears awards a Gold Star.'
        : `🌿 Tranquil Zen Clear — ★ ${save.zenStarProgress}/3 toward next Gold Star · Blessings ${save.zenBlessings}/3`
      : summary.starsEarned === 3
        ? 'Flawless 3-Star Shredder Mastery!'
        : summary.starsEarned === 2
          ? 'Great Job! Clear in fewer moves for 3 Stars!'
          : 'Stage Complete! Clear closer to Par for 3 Stars!';
  }
  if (starsEl) {
    if (summary.zenClear) {
      const pill = document.createElement('span');
      pill.className = 'zen-victory-pill';
      pill.textContent = summary.zenStarAwarded
        ? '🌿 Zen Cleared · ★ +1 Gold Star Earned!'
        : `🌿 Zen Cleared · ★ ${save.zenStarProgress}/3`;
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
    movesEl.textContent = `${app.board.movesCommitted} / Par ${app.board.parMoves}`;
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
    const boosterLabels = summary.rewardedBoosters.map(
      (b) => `+1 ${BOOSTER_DISPLAY_NAMES[b]} [${BOOSTER_RARITY[b]}]`
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
      chestFanfareEl.textContent = chestNotes.join(' | ');
      chestFanfareEl.hidden = false;
    } else {
      chestFanfareEl.hidden = true;
    }
  }
}

export function handleLevelFailureImpl(
  app: AppViewContext,
  reason: 'TIME_OUT' | 'BOMB_EXPLODED' | 'OUT_OF_MOVES'
): void {
  app.sound.playLossBuzzer();
  app.saveManager.recordLevelLoss();
  // A timeout/bomb can fire mid-drag in TIMED: drop the held block so release can't "win" behind the modal
  app.inputController.cancelActiveDrag?.();

  const save = app.saveManager.getPayload();
  const playMode = save.settings.playMode;
  const titleEl = document.getElementById('failure-title');
  const reasonEl = document.getElementById('failure-reason');
  const blessingBtn = document.getElementById('btn-use-zen-blessing');
  const continueBtn = document.getElementById('btn-continue-level');
  const zenBtn = document.getElementById('btn-failure-zen');

  if (blessingBtn) {
    const blessings = save.zenBlessings || 0;
    blessingBtn.hidden = playMode === 'ZEN' || blessings <= 0;
    blessingBtn.textContent =
      reason === 'OUT_OF_MOVES'
        ? `🌿 Zen Blessing: +5 Moves (Free · ${blessings}/3)`
        : reason === 'BOMB_EXPLODED'
          ? `🌿 Zen Blessing: Defuse & Continue (Free · ${blessings}/3)`
          : `🌿 Zen Blessing: +20 Seconds (Free · ${blessings}/3)`;
  }

  if (zenBtn) {
    zenBtn.hidden = playMode === 'ZEN';
    zenBtn.textContent = `🌿 Switch to Zen Mode · Lvl ${save.modeState.ZEN.currentLevelId}`;
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
    continueBtn.textContent =
      reason === 'OUT_OF_MOVES'
        ? `➕ +5 Moves (${CONTINUE_COIN_COST} Coins)`
        : reason === 'BOMB_EXPLODED'
          ? `➕ Defuse & Continue (${CONTINUE_COIN_COST} Coins)`
          : `➕ +20 Seconds (${CONTINUE_COIN_COST} Coins)`;
  }

  app.openModal('failure');
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
