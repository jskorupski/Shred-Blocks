import { computeEarnedStars } from '../core/board';
import { getTimedBombTickSec, hasFinalTouchGrace } from '../core/board-state';
import type { BoardState, PlayMode, SavePayloadV1 } from '../core/types';
import { type AppViewContext, setRichModeText } from './catalog-meta';

export type HudUrgency = 'calm' | 'normal' | 'bonus' | 'warn' | 'critical';

export interface KeystoneHudState {
  playMode: PlayMode;
  urgency: HudUrgency;
  boardRingUrgency: HudUrgency;
  metricKind: 'MOVES' | 'TIMER';
  heroValue: string;
  heroUnit: string;
  modBadge: string;
  metaPrimary: string;
  metaSecondary: string;
  gaugeScale: number;
  tick3Pct: number | null;
  tick2Pct: number | null;
}

interface SrThresholdTracker {
  stageKey: string;
  lastTimedSecThreshold: number;
  lastMoveThreshold: number;
  lastFrozen: boolean;
  lastFinalTouch: boolean;
}

const srTracker: SrThresholdTracker = {
  stageKey: '',
  lastTimedSecThreshold: Number.POSITIVE_INFINITY,
  lastMoveThreshold: Number.POSITIVE_INFINITY,
  lastFrozen: false,
  lastFinalTouch: false,
};

let lastTimerPulseSec = -1;
let lastTimerPulseFlip = false;
let lastCachedGaugeScale = '';

export function formatClockCompact(rawSec: number): string {
  const totalSec = Math.max(0, Math.ceil(rawSec));
  const mins = Math.floor(totalSec / 60);
  const secs = String(totalSec % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function setAttrIfChanged(el: Element | null, attr: string, value: string): void {
  if (el && el.getAttribute(attr) !== value) {
    el.setAttribute(attr, value);
  }
}

function setTextIfChanged(el: Element | null, text: string): void {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

function setHiddenIfChanged(el: HTMLElement | null, hidden: boolean): void {
  if (el && el.hidden !== hidden) {
    el.hidden = hidden;
  }
}

function formatStarsGlyph(stars: number): string {
  if (stars >= 3) return '★★★';
  if (stars === 2) return '★★☆';
  return '★☆☆';
}

function computeTickPct(remainingThreshold: number, total: number): number | null {
  if (total <= 0) return null;
  const pct = (remainingThreshold / total) * 100;
  if (pct <= 2 || pct >= 98) return null;
  return Number(pct.toFixed(1));
}

/**
 * Pure view-model derivation for Option 1 ("The Sanctuary Keystone", `HUD-KEYSTONE-01`).
 * Elevates Challenge move budgets and Speed Rush clocks with star thresholds and `<15s` / `<5s`
 * pre-attentive urgency while keeping Zen Mode 100% calm and pressure-free.
 */
export function deriveKeystoneHudState(
  board: BoardState,
  save: Pick<SavePayloadV1, 'zenBlessings' | 'zenStarProgress'>,
  playMode: PlayMode,
  titleOverlayOpen = false
): KeystoneHudState {
  const activeBombs = board.blocks.filter((b) => b.status === 'ACTIVE' && b.bombMax > 0);
  const continuesUsed = board.continuesUsed ?? 0;

  if (playMode === 'ZEN') {
    const blessCount = Math.min(3, Math.max(0, save.zenBlessings || 0));
    const starProg = Math.min(2, Math.max(0, save.zenStarProgress || 0));
    return {
      playMode,
      urgency: 'calm',
      boardRingUrgency: 'calm',
      metricKind: 'MOVES',
      heroValue: '∞',
      heroUnit: 'No Limit',
      modBadge: `Moves ${board.movesCommitted}`,
      metaPrimary: activeBombs.length > 0 ? '🌿 Bombs Inert' : '🌿 Calm Flow',
      metaSecondary: `★ ${starProg}/3 · 🌿 ${blessCount}/3`,
      gaugeScale: 1,
      tick3Pct: null,
      tick2Pct: null,
    };
  }

  if (playMode === 'TIMED') {
    const limitSec = Math.max(1, board.timeLimitSec || 90);
    const totalSec = Math.max(0, Math.ceil(board.timeRemainingSec));
    const heroValue = formatClockCompact(totalSec);
    const stars = computeEarnedStars(board, 'TIMED', false);

    let urgency: HudUrgency = 'normal';
    let heroUnit = 'Time Left';
    let modBadge = '';

    if (board.freezeRemainingSec > 0) {
      urgency = 'bonus';
      heroUnit = 'Frozen';
      modBadge = `❄️ ${Math.ceil(board.freezeRemainingSec)}s`;
    } else if (!board.timerRunning && board.movesCommitted === 0) {
      urgency = 'normal';
      heroUnit = 'Time Left';
      modBadge = 'Ready';
    } else if (totalSec <= 5) {
      urgency = 'critical';
      heroUnit = '⚠️ Hurry!';
    } else if (totalSec <= 15) {
      urgency = 'warn';
      heroUnit = '⏰ Low Time';
    }

    const sec3 = formatClockCompact(Math.ceil(limitSec * 0.28));
    const sec2 = formatClockCompact(Math.ceil(limitSec * 0.12));
    const cutoff =
      continuesUsed > 0 ? '1★ Cap' : stars === 3 ? `3★≥${sec3}` : stars === 2 ? `2★≥${sec2}` : '1★ Clear';

    let metaSecondary = cutoff;
    if (activeBombs.length > 0) {
      const minBomb = Math.min(...activeBombs.map((b) => b.bombCount));
      metaSecondary = `${cutoff} · 💣${minBomb}`;
    }

    const gaugeScale = Math.max(0, Math.min(1, board.timeRemainingSec / limitSec));
    return {
      playMode,
      urgency,
      boardRingUrgency: titleOverlayOpen ? 'calm' : urgency,
      metricKind: 'TIMER',
      heroValue,
      heroUnit,
      modBadge,
      metaPrimary: formatStarsGlyph(stars),
      metaSecondary,
      gaugeScale,
      tick3Pct: continuesUsed > 0 ? null : 28,
      tick2Pct: continuesUsed > 0 ? null : 12,
    };
  }

  // CHALLENGE mode
  const par = Math.max(1, board.parMoves);
  const limit = Math.max(par, board.moveLimit || par);
  const slack = Math.max(0, limit - par);
  const max3 = par + Math.floor(slack / 3);
  const max2 = par + Math.floor((2 * slack) / 3);
  const stars = computeEarnedStars(board, 'CHALLENGE', false);
  const finalTouch = board.movesRemaining <= 0 && board.freeMovesRemaining <= 0 && hasFinalTouchGrace(board);

  let urgency: HudUrgency = 'normal';
  let heroValue = String(board.movesRemaining);
  let heroUnit = 'Moves Left';
  let modBadge = '';

  if (finalTouch) {
    urgency = 'critical';
    heroValue = '0+';
    heroUnit = 'Final Touch';
    modBadge = '✦ Slide block';
  } else if (board.freeMovesRemaining > 0) {
    urgency = 'bonus';
    modBadge = `+${board.freeMovesRemaining} Free`;
  } else if (board.movesRemaining <= 1) {
    urgency = 'critical';
    heroUnit = '⚠️ Last Move';
  } else if (board.movesRemaining <= 3) {
    urgency = 'warn';
    heroUnit = '⚠️ Moves Left';
  }

  let metaSecondary: string;
  if (finalTouch) {
    metaSecondary = 'Finish to gate';
  } else if (continuesUsed > 0) {
    metaSecondary = `1★ Cap · Par ${par}`;
  } else if (stars === 3) {
    metaSecondary = `Par ${par} · ${board.movesCommitted}/${max3}`;
  } else if (stars === 2) {
    metaSecondary = `Par ${par} · ${board.movesCommitted}/${max2}`;
  } else {
    metaSecondary = `1★ Clear · Par ${par}`;
  }

  const gaugeScale = finalTouch ? 0.04 : Math.max(0, Math.min(1, board.movesRemaining / limit));
  return {
    playMode,
    urgency,
    boardRingUrgency: titleOverlayOpen ? 'calm' : urgency,
    metricKind: 'MOVES',
    heroValue,
    heroUnit,
    modBadge,
    metaPrimary: formatStarsGlyph(stars),
    metaSecondary,
    gaugeScale,
    tick3Pct: continuesUsed > 0 ? null : computeTickPct(limit - max3, limit),
    tick2Pct: continuesUsed > 0 ? null : computeTickPct(limit - max2, limit),
  };
}

function updateSrThresholdAnnouncement(board: BoardState, state: KeystoneHudState): void {
  const srEl = document.getElementById('hud-sr-announcer');
  if (!srEl) return;

  const stageKey = `${board.levelId}:${state.playMode}`;
  const isResetRun = board.movesCommitted === 0 && !board.timerRunning;
  if (srTracker.stageKey !== stageKey || (isResetRun && board.freeMovesRemaining === 0)) {
    srTracker.stageKey = stageKey;
    srTracker.lastTimedSecThreshold = Number.POSITIVE_INFINITY;
    srTracker.lastMoveThreshold = Number.POSITIVE_INFINITY;
    srTracker.lastFrozen = board.freezeRemainingSec > 0;
    srTracker.lastFinalTouch = false;
    setTextIfChanged(srEl, '');
    return;
  }

  if (state.playMode === 'ZEN') {
    setTextIfChanged(srEl, '');
    return;
  }

  let announcement = '';
  if (state.playMode === 'TIMED') {
    const isFrozen = board.freezeRemainingSec > 0;
    if (isFrozen && !srTracker.lastFrozen) {
      announcement = `Speed Rush clock frozen for ${Math.ceil(board.freezeRemainingSec)} seconds`;
    }
    srTracker.lastFrozen = isFrozen;

    if (!isFrozen && board.timerRunning) {
      const totalSec = Math.max(0, Math.ceil(board.timeRemainingSec));
      for (const threshold of [30, 15, 10, 5]) {
        if (totalSec <= threshold && srTracker.lastTimedSecThreshold > threshold) {
          srTracker.lastTimedSecThreshold = threshold;
          announcement = `${threshold} seconds left`;
        }
      }
    }
  } else {
    const isFinalTouch = state.heroValue === '0+';
    if (isFinalTouch && !srTracker.lastFinalTouch) {
      announcement = 'Final touch active: finish sliding active block into gate';
    }
    srTracker.lastFinalTouch = isFinalTouch;

    if (!isFinalTouch && board.freeMovesRemaining <= 0) {
      for (const threshold of [3, 1]) {
        if (board.movesRemaining <= threshold && srTracker.lastMoveThreshold > threshold) {
          srTracker.lastMoveThreshold = threshold;
          announcement = threshold === 1 ? 'Last move left' : '3 moves left';
        }
      }
    }
  }

  if (announcement) {
    setTextIfChanged(srEl, announcement);
  }
}

export function syncKeystoneDomImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  const playMode = save.settings.playMode;
  const state = deriveKeystoneHudState(app.board, save, playMode, app.titleOverlayOpen);

  const appShell = document.getElementById('app-shell');
  setAttrIfChanged(appShell, 'data-hud-urgency', state.boardRingUrgency);

  const keystone = document.getElementById('hud-keystone');
  setAttrIfChanged(keystone, 'data-mode', playMode);
  setAttrIfChanged(keystone, 'data-urgency', state.urgency);

  const movesPill = document.getElementById('hud-moves-pill');
  const timerPill = document.getElementById('hud-timer-pill');
  setHiddenIfChanged(movesPill, state.metricKind !== 'MOVES');
  setHiddenIfChanged(timerPill, state.metricKind !== 'TIMER');

  if (state.metricKind === 'MOVES') {
    setTextIfChanged(document.getElementById('hud-moves-value'), state.heroValue);
    setTextIfChanged(document.getElementById('hud-moves-unit'), state.heroUnit);
    const movesBadge = document.getElementById('hud-moves-badge');
    setHiddenIfChanged(movesBadge, state.modBadge.length === 0);
    if (state.modBadge) setTextIfChanged(movesBadge, state.modBadge);
  } else {
    setTextIfChanged(document.getElementById('hud-timer-value'), state.heroValue);
    setTextIfChanged(document.getElementById('hud-timer-unit'), state.heroUnit);
    const timerBadge = document.getElementById('hud-timer-badge');
    setHiddenIfChanged(timerBadge, state.modBadge.length === 0);
    if (state.modBadge) setTextIfChanged(timerBadge, state.modBadge);

    const totalSec = Math.max(0, Math.ceil(app.board.timeRemainingSec));
    if (keystone) {
      if (state.urgency === 'critical' && app.board.timerRunning && totalSec !== lastTimerPulseSec) {
        lastTimerPulseSec = totalSec;
        lastTimerPulseFlip = !lastTimerPulseFlip;
        keystone.classList.toggle('tick-pulse-a', lastTimerPulseFlip);
        keystone.classList.toggle('tick-pulse-b', !lastTimerPulseFlip);
      } else if (state.urgency !== 'critical') {
        lastTimerPulseSec = -1;
        if (keystone.classList.contains('tick-pulse-a')) keystone.classList.remove('tick-pulse-a');
        if (keystone.classList.contains('tick-pulse-b')) keystone.classList.remove('tick-pulse-b');
      }
    }
  }

  setRichModeText(document.getElementById('hud-keystone-stars'), state.metaPrimary);
  setRichModeText(document.getElementById('hud-keystone-rule'), state.metaSecondary);

  const fill = document.getElementById('hud-keystone-fill');
  if (fill) {
    const quantized = (Math.round(state.gaugeScale * 500) / 500).toFixed(3);
    const nextTransform = `scaleX(${quantized})`;
    if (lastCachedGaugeScale !== nextTransform) {
      lastCachedGaugeScale = nextTransform;
      fill.style.transform = nextTransform;
    }
  }

  const tick3 = document.getElementById('hud-keystone-tick-3');
  const tick2 = document.getElementById('hud-keystone-tick-2');
  setHiddenIfChanged(tick3, state.tick3Pct === null);
  if (tick3 && state.tick3Pct !== null) {
    const left3 = `${state.tick3Pct}%`;
    if (tick3.style.left !== left3) tick3.style.left = left3;
  }
  setHiddenIfChanged(tick2, state.tick2Pct === null);
  if (tick2 && state.tick2Pct !== null) {
    const left2 = `${state.tick2Pct}%`;
    if (tick2.style.left !== left2) tick2.style.left = left2;
  }

  updateSrThresholdAnnouncement(app.board, state);
}

/**
 * Non-destructive stage-rules summary toast opened by tapping `#hud-keystone-info`.
 */
export function showKeystoneRuleToastImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  const mode = save.settings.playMode;
  const par = Math.max(1, app.board.parMoves);

  if (mode === 'ZEN') {
    const starProg = Math.min(2, Math.max(0, save.zenStarProgress || 0));
    const blessProg = Math.min(3, Math.max(0, save.zenBlessingProgress || 0));
    app.showGameToast(
      `🌿 Zen Sanctuary: Unlimited time & moves · Par ref ${par} · Stars ${starProg}/3 · Blessing ${blessProg}/4`
    );
    return;
  }

  if (mode === 'TIMED') {
    const limit = Math.max(1, app.board.timeLimitSec || 90);
    const s3 = formatClockCompact(Math.ceil(limit * 0.28));
    const s2 = formatClockCompact(Math.ceil(limit * 0.12));
    const activeBombs = app.board.blocks.some((b) => b.status === 'ACTIVE' && b.bombMax > 0);
    const bombNote = activeBombs
      ? ` · 💣 -1/${Math.max(1, Math.round(getTimedBombTickSec(app.board)))}s`
      : '';
    app.showGameToast(`⏱️ Speed Rush: 3★ ≥ ${s3} · 2★ ≥ ${s2}${bombNote}`);
    return;
  }

  const limit = Math.max(par, app.board.moveLimit || par);
  const slack = Math.max(0, limit - par);
  const max3 = par + Math.floor(slack / 3);
  const max2 = par + Math.floor((2 * slack) / 3);
  app.showGameToast(`⚔️ Challenge: Par ${par} (<Par = ✦ Oracle!) · 3★ ≤ ${max3} · 2★ ≤ ${max2}`);
}
