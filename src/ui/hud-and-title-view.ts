import { getTimedBombTickSec } from '../core/board-state';
import { findEligibleGateForBlockAt } from '../core/gate-clearance';
import {
  canGroupOccupyOffset,
  getBlockRoomId,
  getMovedGroupBlocks,
  isBlockInLockedRoom,
} from '../core/physics';
import { getActiveColor } from '../core/polyomino';
import {
  type BarrierState,
  type BlockState,
  type BoosterType,
  COLOR_PALETTE,
  type SavePayloadV1,
} from '../core/types';
import type { HoverState } from '../input/pointer-controller';
import { getLevelSpec } from '../levels/catalog';
import type { RenderSceneOptions } from '../render/renderer-3d';
import { BOOSTER_RARITY, BOOSTER_UNLOCK_LEVEL, isBoosterUnlocked } from '../storage/save-manager';
import {
  type AppViewContext,
  getChapterMetaForLevel,
  getNextSanctuaryAwakeningText,
  UI_BOOSTER_PRICES,
} from './catalog-meta';

export { handleLevelFailureImpl, populateVictoryModalImpl } from './outcome-modals-view';

export function handleImmobileBlockTapImpl(app: AppViewContext, block: BlockState): void {
  if (isBlockInLockedRoom(app.board, block)) {
    const roomId = getBlockRoomId(app.board, block);
    const bar = app.board.barriers.find((b) => !b.open && b.unlocksRoomId === roomId);
    if (bar?.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0) {
      app.showGameToast('⛩️ Chamber Sealed! Shred a block with a 🔑 Key to open the Portcullis');
    } else if (bar && bar.shredsRemaining > 0) {
      app.showGameToast(
        `⛩️ Chamber Sealed! Shred ${bar.shredsRemaining} more block(s) to open the Portcullis`
      );
    } else {
      app.showGameToast('⛩️ Chamber Sealed! Open the Portcullis Barrier first');
    }
    return;
  }

  const activeColor = getActiveColor(block.colorStack, block.colorCursor);
  if (activeColor === 0) {
    app.showGameToast('🪨 Stone Block — permanent obstacle that never moves');
  } else if (block.iceCount > 0) {
    app.showGameToast(`❄️ Frozen! Shred ${block.iceCount} more block(s) to thaw`);
  } else if (block.chained) {
    app.showGameToast('🔒 Chained! Shred a block carrying a 🔑 Key to unlock');
  } else if (block.ropeColor > 0) {
    const cName = COLOR_PALETTE[block.ropeColor]?.name ?? 'matching';
    app.showGameToast(`🪢 Tied with ${cName} Rope! Shred matching ✂️ Scissors first`);
  }
}

export function syncBoosterTargetingBannerImpl(hoverState: HoverState): void {
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
    axisBtn.textContent = hoverState.rocketAxis === 'ROW' ? 'Axis: ↔ ROW' : 'Axis: ↕ COL';
  } else if (hoverState.inputMode === 'TARGET_VACUUM') {
    textEl.textContent = '🧲 Tap any unlocked colored block to vacuum all matching blocks';
    axisBtn.hidden = true;
  }
}

export function isNewPlayerSaveImpl(
  app: AppViewContext,
  save: SavePayloadV1 = app.saveManager.getPayload()
): boolean {
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

export function syncTitleOverlayDomImpl(app: AppViewContext): void {
  const titleEl = document.getElementById('title-overlay');
  const homeEl = document.getElementById('screen-home');
  const gameEl = document.getElementById('screen-game');
  const themesEl = document.getElementById('screen-themes');
  const tabBarEl = document.getElementById('menu-tab-bar');

  if (app.titleOverlayOpen) {
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
      gameEl.classList.remove('relic-awakening-burst');
    }
    app.renderer.resize();
    return;
  }

  if (titleEl) titleEl.hidden = true;
  if (homeEl) {
    homeEl.hidden = app.activeScreen !== 'home';
    homeEl.inert = false;
  }
  if (themesEl) {
    themesEl.hidden = app.activeScreen !== 'themes';
    themesEl.inert = false;
  }
  if (tabBarEl) {
    tabBarEl.hidden = app.activeScreen === 'game';
    tabBarEl.inert = false;
  }
  if (gameEl) {
    gameEl.hidden = app.activeScreen !== 'game';
    gameEl.inert = false;
    gameEl.classList.remove('title-backdrop-mode');
  }
  if (app.activeScreen === 'game') {
    app.renderer.resize();
  }
}

export function syncAllUiFromSaveImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();

  app.sound.updateSettings({
    sfxEnabled: save.settings.sfxEnabled,
    musicEnabled: save.settings.musicEnabled,
    hapticsEnabled: save.settings.hapticsEnabled,
  });
  app.renderer.setQualityPreference(save.settings.qualityTier);

  document.body.classList.toggle('high-contrast', Boolean(save.settings.highContrast));
  document.body.classList.toggle('colorblind-mode', Boolean(save.settings.colorblindSymbols));
  document.body.classList.toggle('reduced-motion', Boolean(save.settings.reducedMotion));

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
  const heroAwakeningText = document.getElementById('hero-awakening-text');
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
      targetSpec.unlockNote ?? `Clear all blocks in ${targetSpec.parMoves ?? 6} moves for 3 Stars`;
  }
  if (heroAwakeningText) {
    heroAwakeningText.textContent = getNextSanctuaryAwakeningText(targetSpec.id);
  }
  if (playBtn) {
    playBtn.textContent = `▶ PLAY LEVEL ${targetSpec.id}`;
  }
  if (tabPlayLabel) {
    tabPlayLabel.textContent = `Play Lvl ${targetSpec.id}`;
  }

  // Sacred-Geometry Title Crest Overlay (Adaptive New vs. Returning Player State)
  const isNewPlayer = app.isNewPlayerSave(save);
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
    titlePlayBtn.textContent = isNewPlayer ? '▶ BEGIN JOURNEY' : `▶ CONTINUE · LEVEL ${targetSpec.id}`;
  }
  if (titleSyncLabel) {
    titleSyncLabel.textContent = isNewPlayer ? 'Restore Save' : 'Sync';
  }
  app.syncInstallUiVisibility();

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

  const modeSelect = document.getElementById('select-play-mode') as HTMLSelectElement | null;
  if (modeSelect) {
    modeSelect.value = save.settings.playMode;
  }

  const tierSelect = document.getElementById('select-quality-tier') as HTMLSelectElement | null;
  if (tierSelect) {
    tierSelect.value = save.settings.qualityTier;
  }

  const jumpInput = document.getElementById('level-jump-input') as HTMLInputElement | null;
  if (jumpInput) {
    const maxUnlocked = Math.max(1, save.highestLevelUnlocked || 1);
    jumpInput.max = String(maxUnlocked);
    jumpInput.title = `Jump to unlocked stage (1–${maxUnlocked})`;
  }

  const hudSfxBtn = document.getElementById('btn-hud-sfx');
  const hudMusicBtn = document.getElementById('btn-hud-music');
  if (hudSfxBtn) hudSfxBtn.textContent = save.settings.sfxEnabled ? '🔊' : '🔇';
  if (hudMusicBtn) hudMusicBtn.textContent = save.settings.musicEnabled ? '🎵' : '🔕';

  app.syncInGameHud();
}

export function syncInGameHudImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  const playMode = save.settings.playMode;

  const titleEl = document.getElementById('hud-level-title');
  const diffEl = document.getElementById('hud-difficulty-badge');
  const coinsInline = document.getElementById('hud-coins-inline');
  const shredInline = document.getElementById('hud-shred-inline');
  const modeLabel = document.getElementById('hud-mode-label');
  const movesPill = document.getElementById('hud-moves-pill');
  const timerPill = document.getElementById('hud-timer-pill');

  if (titleEl) {
    titleEl.textContent = `Level ${app.board.levelId} — ${app.board.name}`;
  }
  if (diffEl) {
    diffEl.textContent = app.board.difficulty.replace('_', ' ');
    diffEl.className = `badge-difficulty diff-${app.board.difficulty.toLowerCase()}`;
  }
  if (coinsInline) {
    coinsInline.textContent = `${save.coins}`;
  }
  if (shredInline) {
    const prog = (save.shredderChestProgress + app.board.sessionBlocksShredded) % 100;
    shredInline.textContent = `${prog}/100`;
  }
  if (modeLabel) {
    modeLabel.textContent =
      playMode === 'CHALLENGE' ? '⚔️ Challenge' : playMode === 'ZEN' ? '🌿 Zen Mode' : '⏱ Speed Rush';
  }
  if (movesPill) {
    if (playMode === 'CHALLENGE') {
      if (app.board.stasisMovesRemaining > 0) {
        movesPill.textContent = `Moves Left: ${app.board.movesRemaining} · ❄️×${app.board.stasisMovesRemaining}`;
        movesPill.className = 'tabular-metric moves-pill moves-stasis';
      } else {
        movesPill.textContent = `Moves Left: ${app.board.movesRemaining}`;
        movesPill.className =
          app.board.movesRemaining <= 1
            ? 'tabular-metric moves-pill moves-critical'
            : app.board.movesRemaining <= 3
              ? 'tabular-metric moves-pill moves-low'
              : 'tabular-metric moves-pill';
      }
    } else {
      movesPill.textContent = `Moves: ${app.board.movesCommitted} / Par ${app.board.parMoves}`;
      movesPill.className = 'tabular-metric';
    }
  }
  if (timerPill) {
    timerPill.hidden = playMode !== 'TIMED';
  }
  app.syncTimerPillOnly();

  const svgHint = document.getElementById('svg-booster-hint');
  const svgFreeze = document.getElementById('svg-booster-freeze');
  const freezeLabel = document.getElementById('label-booster-freeze');
  if (svgHint) svgHint.toggleAttribute('hidden', playMode !== 'ZEN');
  if (svgFreeze) svgFreeze.toggleAttribute('hidden', playMode === 'ZEN');
  if (freezeLabel) {
    freezeLabel.textContent = playMode === 'CHALLENGE' ? 'Stasis' : playMode === 'TIMED' ? 'Freeze' : 'Hint';
  }

  // Boosters Dock Badges, Rarity Accents & Progressive Level Unlocking (ECON-01 / ECON-02)
  const effectiveLevel = Math.max(app.board.levelId, save.highestLevelUnlocked);

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

    if (type === 'UNDO' && app.freeUndosRemaining > 0) {
      badgeEl.textContent = `FREE (${app.freeUndosRemaining})`;
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

export function syncTimerPillOnlyImpl(app: AppViewContext): void {
  const timerPill = document.getElementById('hud-timer-pill');
  if (!timerPill || timerPill.hidden) return;

  const totalSec = Math.max(0, Math.ceil(app.board.timeRemainingSec));
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');

  if (app.board.freezeRemainingSec > 0) {
    timerPill.textContent = `❄️ ${mins}:${secs} (${Math.ceil(app.board.freezeRemainingSec)}s)`;
    timerPill.className = 'tabular-metric timer-pill frozen';
  } else {
    timerPill.textContent = `⏱ ${mins}:${secs}`;
    timerPill.className = totalSec <= 15 ? 'tabular-metric timer-pill urgent' : 'tabular-metric timer-pill';
  }
}

export function buildRenderOptionsImpl(
  app: AppViewContext,
  dtSec = 1 / 60,
  timeSec?: number
): RenderSceneOptions {
  const save = app.saveManager.getPayload();
  const hover = app.inputController.getHoverState();
  const activeBlockId = hover.activeBlockId ?? app.board.hintMove?.blockId ?? null;

  let dragTargetRow: number | null = null;
  let dragTargetCol: number | null = null;
  let dragEligibleGateIndex: number | null = null;

  if (hover.activeBlockId !== null) {
    const blk = app.board.blocks.find((b) => b.id === hover.activeBlockId);
    if (blk) {
      const group = getMovedGroupBlocks(app.board, blk.id);
      const rawDRow = Math.round(blk.y - blk.row);
      const rawDCol = Math.round(blk.x - blk.col);
      let chosenDRow = 0;
      let chosenDCol = 0;
      if (canGroupOccupyOffset(app.board, group, rawDRow, rawDCol)) {
        chosenDRow = rawDRow;
        chosenDCol = rawDCol;
      } else {
        const contDCol = blk.x - blk.col;
        const contDRow = blk.y - blk.row;
        let bestDist = Infinity;
        for (let dr = rawDRow - 1; dr <= rawDRow + 1; dr++) {
          for (let dc = rawDCol - 1; dc <= rawDCol + 1; dc++) {
            if (canGroupOccupyOffset(app.board, group, dr, dc)) {
              const d = Math.hypot(contDCol - dc, contDRow - dr);
              if (d < bestDist) {
                bestDist = d;
                chosenDRow = dr;
                chosenDCol = dc;
              }
            }
          }
        }
      }
      dragTargetRow = blk.row + chosenDRow;
      dragTargetCol = blk.col + chosenDCol;
      for (const member of group) {
        const gIdx = findEligibleGateForBlockAt(
          app.board,
          member,
          member.row + chosenDRow,
          member.col + chosenDCol
        );
        if (gIdx >= 0) {
          dragEligibleGateIndex = gIdx;
          break;
        }
      }
    }
  } else if (app.board.hintMove) {
    dragTargetRow = app.board.hintMove.targetRow;
    dragTargetCol = app.board.hintMove.targetCol;
    if (app.board.hintMove.exitsGateIndex >= 0) {
      dragEligibleGateIndex = app.board.hintMove.exitsGateIndex;
    }
  }

  let autoGuideMove: { blockId: number; targetRow: number; targetCol: number } | null = null;
  if (
    !app.titleOverlayOpen &&
    hover.activeBlockId === null &&
    hover.inputMode === 'DRAG' &&
    !app.board.hintMove &&
    !app.levelOutcomeHandled &&
    app.cachedAutoGuideMove
  ) {
    const isImmediateOnboardingOrAxisDebut =
      (app.board.levelId <= 5 || app.board.levelId === 11) && app.board.movesCommitted === 0;
    const isIdleEarlyOrShowcase =
      (app.board.levelId <= 30 || app.currentLevelHasUnlockNote) &&
      performance.now() - app.lastPointerActivityMs >= 4000;
    if (isImmediateOnboardingOrAxisDebut || isIdleEarlyOrShowcase) {
      autoGuideMove = app.cachedAutoGuideMove;
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
    blueprintMix: app.titleOverlayOpen ? 1.0 : app.blueprintMix ** 1.5,
    dtSec,
    timeSec,
  };
}

export function handleLockedVaultTapImpl(app: AppViewContext, vault: BarrierState): void {
  if (vault.shredsRemaining > 0 && vault.lockId > 0) {
    app.showGameToast(
      `🔒 Sealed Mystery Vault: Shred ${vault.shredsRemaining} more block${vault.shredsRemaining > 1 ? 's' : ''} + Key #${vault.lockId} to reveal!`
    );
  } else if (vault.shredsRemaining > 0) {
    app.showGameToast(
      `🔒 Sealed Mystery Vault: Shred ${vault.shredsRemaining} more block${vault.shredsRemaining > 1 ? 's' : ''} to reveal hidden blocks!`
    );
  } else if (vault.lockId > 0) {
    app.showGameToast(`🔑 Sealed Mystery Vault: Shred the Key #${vault.lockId} block to reveal!`);
  }
}

export function stepSimulationImpl(app: AppViewContext, dtSec: number): void {
  if (app.titleOverlayOpen) {
    app.blueprintMix = 1.0;
  } else if (app.blueprintMix > 0) {
    if (app.saveManager.getPayload().settings.reducedMotion) {
      app.blueprintMix = 0;
    } else {
      app.blueprintMix = Math.max(0, app.blueprintMix - dtSec / 0.72);
    }
    if (app.blueprintMix === 0) {
      document.getElementById('screen-game')?.classList.remove('relic-awakening-burst');
    }
  }

  for (const b of app.board.blocks) {
    if (b.reboundTimerMs > 0) {
      b.reboundTimerMs = Math.max(0, b.reboundTimerMs - dtSec * 1000);
    }
  }

  // Booster targeting no longer pauses the clock: in TIMED, free targeting toggles must not freeze time & bombs
  if (
    app.titleOverlayOpen ||
    app.activeScreen !== 'game' ||
    app.levelOutcomeHandled ||
    !app.board.timerRunning ||
    app.isAnyModalOpen()
  ) {
    return;
  }

  if (app.board.freezeRemainingSec > 0) {
    app.board.freezeRemainingSec = Math.max(0, app.board.freezeRemainingSec - dtSec);
    app.syncTimerPillOnly();
    return;
  }

  const playMode = app.saveManager.getPayload().settings.playMode;
  if (playMode === 'TIMED') {
    app.board.timeRemainingSec = Math.max(0, app.board.timeRemainingSec - dtSec);
    // TIMED-BOMB-01: move-calibrated fuses burn one tick per move-equivalent of clock time
    const bombTickSec = getTimedBombTickSec(app.board);
    app.bombSecondAccumulator += dtSec;
    while (app.bombSecondAccumulator >= bombTickSec) {
      app.bombSecondAccumulator -= bombTickSec;
      for (const b of app.board.blocks) {
        if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount > 0 && !isBlockInLockedRoom(app.board, b)) {
          b.bombCount = Math.max(0, b.bombCount - 1);
        }
      }
    }
    app.syncTimerPillOnly();
    app.checkWinOrLossAfterAction();
  }
}
