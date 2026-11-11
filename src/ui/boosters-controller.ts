import {
  applyBoosterFreeze,
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  carryLiveResourcesIntoUndo,
  cloneBoardState,
} from '../core/board';
import { getShape } from '../core/polyomino';
import type { BoardState, BoosterType, InputMode } from '../core/types';
import type { BoosterTargetPayload } from '../input/pointer-controller';
import { findNextHintMove } from '../levels/solver';
import { BOOSTER_RARITY, BOOSTER_UNLOCK_LEVEL, isBoosterUnlocked } from '../storage/save-manager';
import { type AppViewContext, BOOSTER_DISPLAY_NAMES, UI_BOOSTER_PRICES } from './catalog-meta';

/**
 * Booster & Undo controller (`UX-04`, `UX-11`, `F-08`, `MECH-10`, `UNDO-RES-01`), extracted from `main.ts`
 * (`ARCH-ERGONOMICS-01`). Invariants:
 * - Boosters are charged only when their effect is actually applied (destructive strikes roll back on payment failure).
 * - Destructive boosters (`HAMMER` / `ROCKET` / `VACUUM`) clear the undo stack so consumed inventory is never refunded.
 * - Undo restores board geometry but carries forward live paid/clock resources (`carryLiveResourcesIntoUndo`).
 */
export interface BoosterAppContext extends AppViewContext {
  undoStack: BoardState[];
  preRestartSnapshot: BoardState | null;
  preRestartUndoStack: BoardState[];
  preRestartFreeUndos: number;
  refreshAutoGuideMove(): void;
}

function canAffordBooster(app: BoosterAppContext, type: BoosterType): boolean {
  if (app.saveManager.getBoosterCount(type) > 0) return true;
  const price = UI_BOOSTER_PRICES[type];
  if (app.saveManager.getPayload().coins >= price) return true;
  app.showGameToast(`Need ${price} Coins for ${type} booster!`);
  return false;
}

function ensureBoosterAvailable(app: BoosterAppContext, type: BoosterType): boolean {
  if (app.saveManager.getBoosterCount(type) > 0) return true;
  const price = UI_BOOSTER_PRICES[type];
  if (app.saveManager.buyBoosterWithCoins(type, price)) {
    app.showGameToast(`Purchased ${type} booster for ${price} Coins!`);
    return true;
  }
  app.showGameToast(`Need ${price} Coins for ${type} booster!`);
  return false;
}

export function activateBoosterImpl(app: BoosterAppContext, type: BoosterType): void {
  const save = app.saveManager.getPayload();
  const effectiveLevel = Math.max(app.board.levelId, save.highestLevelUnlocked);
  if (!isBoosterUnlocked(type, effectiveLevel)) {
    app.sound.playWallClack();
    const displayName = BOOSTER_DISPLAY_NAMES[type];
    app.showGameToast(
      `🔒 ${displayName} (${BOOSTER_RARITY[type]}) unlocks at Level ${BOOSTER_UNLOCK_LEVEL[type]}!`
    );
    return;
  }

  if (type === 'UNDO') {
    executeUndoBoosterImpl(app);
    return;
  }
  if (type === 'FREEZE') {
    executeHintOrFreezeBoosterImpl(app);
    return;
  }

  const modeMap: Record<'HAMMER' | 'ROCKET' | 'VACUUM', InputMode> = {
    HAMMER: 'TARGET_HAMMER',
    ROCKET: 'TARGET_ROCKET',
    VACUUM: 'TARGET_VACUUM',
  };
  const targetMode = modeMap[type];

  // Toggle off if already targeting this booster
  if (app.inputController.getInputMode() === targetMode) {
    app.inputController.cancelTargeting();
    return;
  }
  if (!canAffordBooster(app, type)) return;

  app.sound.playButtonTap();
  app.inputController.setInputMode(targetMode);
  app.syncBoosterTargetingBanner(app.inputController.getHoverState());
  app.renderNow();
}

function executeUndoBoosterImpl(app: BoosterAppContext): void {
  // UX-11: Check if undoing an accidental level restart first
  if (app.undoStack.length === 0 && app.preRestartSnapshot) {
    app.board = cloneBoardState(app.preRestartSnapshot);
    app.undoStack = app.preRestartUndoStack;
    app.freeUndosRemaining = app.preRestartFreeUndos;
    app.preRestartSnapshot = null;
    app.preRestartUndoStack = [];
    app.board.bombsInert = app.saveManager.getPayload().settings.playMode === 'ZEN';
    app.levelOutcomeHandled = false;
    app.sound.playBooster('UNDO');
    app.showGameToast('↩️ Restored board before restart!');
    app.syncInGameHud();
    app.renderNow();
    // A restored board that was already failed (0 moves / detonated bomb) re-surfaces its failure modal
    app.checkWinOrLossAfterAction();
    return;
  }

  if (app.undoStack.length === 0) {
    app.showGameToast('↩️ No moves to undo yet');
    return;
  }

  if (app.freeUndosRemaining > 0) {
    app.freeUndosRemaining--;
  } else {
    if (!ensureBoosterAvailable(app, 'UNDO')) return;
    app.saveManager.spendBooster('UNDO');
  }

  const previous = app.undoStack.pop();
  if (!previous) return;
  carryLiveResourcesIntoUndo(previous, app.board, app.saveManager.getPayload().settings.playMode);
  app.board = previous;
  app.levelOutcomeHandled = false;
  app.lastPointerActivityMs = performance.now();
  app.refreshAutoGuideMove();
  app.sound.playBooster('UNDO');
  app.syncInGameHud();
  app.renderNow();
}

function executeHintOrFreezeBoosterImpl(app: BoosterAppContext): void {
  const playMode = app.saveManager.getPayload().settings.playMode;
  if (!canAffordBooster(app, 'FREEZE')) return;

  const hint = findNextHintMove(app.board);
  if (playMode === 'ZEN' && !hint) {
    app.showGameToast('💡 No hint needed right now!');
    return;
  }
  if (!ensureBoosterAvailable(app, 'FREEZE')) return;
  app.saveManager.spendBooster('FREEZE');
  applyBoosterFreeze(app.board, playMode, hint);
  app.sound.playBooster('FREEZE');
  app.showGameToast(
    playMode === 'CHALLENGE'
      ? hint
        ? '❄️ +2 Stasis Moves & Optimal Hint!'
        : '❄️ +2 Stasis Moves Activated!'
      : playMode === 'TIMED'
        ? '❄️ Timer & Bombs Frozen for +10s!'
        : '💡 Optimal next move highlighted on the board!'
  );
  app.syncInGameHud();
  app.renderNow();
}

export function executeTargetedBoosterImpl(
  app: BoosterAppContext,
  type: BoosterType,
  target: BoosterTargetPayload
): boolean {
  if (!canAffordBooster(app, type)) return false;

  const closedBefore = new Set(app.board.barriers.filter((b) => !b.open).map((b) => b.id));
  const boardBefore = cloneBoardState(app.board);
  let applied = false;

  if (type === 'HAMMER') {
    const pickedBlock =
      target.blockId !== null
        ? app.board.blocks.find((b) => b.id === target.blockId && b.status === 'ACTIVE')
        : null;
    const firstCell = pickedBlock ? getShape(pickedBlock.shapeId).cells[0] : null;
    const r = pickedBlock && firstCell ? pickedBlock.row + firstCell[0] : target.row;
    const c = pickedBlock && firstCell ? pickedBlock.col + firstCell[1] : target.col;
    applied = (applyBoosterHammer as (b: BoardState, r: number, c: number, id?: number | null) => boolean)(
      app.board,
      r,
      c,
      pickedBlock ? pickedBlock.id : null
    );
  } else if (type === 'ROCKET') {
    applied = applyBoosterRocket(app.board, target.row, target.col, target.axis);
  } else if (type === 'VACUUM' && target.color && target.color > 0) {
    applied = applyBoosterVacuum(app.board, target.color);
  }

  if (!applied) {
    app.sound.playWallClack();
    app.showGameToast('Tap a valid colored block or crate target!');
    return false;
  }

  if (!ensureBoosterAvailable(app, type)) {
    app.board = boardBefore; // Payment failed: roll back the strike so no booster effect is ever free
    app.renderNow();
    return false;
  }
  // F-08 / MECH-10: Destructive boosters clear the undo stack so consumed boosters cannot be refunded
  app.undoStack = [];
  app.preRestartSnapshot = null;
  app.preRestartUndoStack = [];
  app.saveManager.spendBooster(type);
  const newlyOpened = app.board.barriers.filter((b) => b.open && closedBefore.has(b.id));
  if (newlyOpened.length > 0) {
    app.showGameToast(
      newlyOpened.some((b) => b.isVault)
        ? '🔓 Mystery Vault Unlocked! Hidden blocks revealed!'
        : '⛩️ Portcullis Opened! New chamber unlocked!'
    );
  }
  app.syncInGameHud();
  app.checkWinOrLossAfterAction();
  return true;
}
