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
import {
  BOOSTER_RARITY,
  BOOSTER_UNLOCK_LEVEL,
  canSkipZenLevel,
  countUniqueClearedLevels,
  getEffectiveBoosterUnlockLevel,
  isBoosterUnlocked,
} from '../storage/save-manager';
import {
  type AppViewContext,
  getChapterMetaForLevel,
  getNextSanctuaryAwakeningText,
  getPlayModeMeta,
  UI_BOOSTER_PRICES,
} from './catalog-meta';

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
    const ropeEntry = COLOR_PALETTE[block.ropeColor];
    const cb = app.saveManager.getPayload().settings.colorblindSymbols;
    const cName = ropeEntry
      ? cb
        ? `${ropeEntry.cbName} (${ropeEntry.symbol})`
        : ropeEntry.name
      : 'matching';
    app.showGameToast(`🪢 Tied with ${cName} Rope! Shred matching ✂️ Scissors first`);
  }
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

function setClassIfChanged(el: Element | null, className: string): void {
  if (el && el.className !== className) {
    el.className = className;
  }
}

export function syncBoosterTargetingBannerImpl(hoverState: HoverState): void {
  const banner = document.getElementById('booster-target-banner');
  const textEl = document.getElementById('booster-target-text');
  const axisBtn = document.getElementById('btn-rocket-axis');

  const hammerBtn = document.getElementById('btn-booster-hammer');
  const rocketBtn = document.getElementById('btn-booster-rocket');
  const vacuumBtn = document.getElementById('btn-booster-vacuum');

  const isHammer = hoverState.inputMode === 'TARGET_HAMMER';
  const isRocket = hoverState.inputMode === 'TARGET_ROCKET';
  const isVacuum = hoverState.inputMode === 'TARGET_VACUUM';
  if (hammerBtn && hammerBtn.classList.contains('active-targeting') !== isHammer) {
    hammerBtn.classList.toggle('active-targeting', isHammer);
  }
  if (rocketBtn && rocketBtn.classList.contains('active-targeting') !== isRocket) {
    rocketBtn.classList.toggle('active-targeting', isRocket);
  }
  if (vacuumBtn && vacuumBtn.classList.contains('active-targeting') !== isVacuum) {
    vacuumBtn.classList.toggle('active-targeting', isVacuum);
  }

  if (!banner || !textEl || !axisBtn) return;

  if (hoverState.inputMode === 'DRAG') {
    if (!banner.hidden) banner.hidden = true;
    return;
  }

  if (banner.hidden) banner.hidden = false;
  const unlockToast = document.getElementById('unlock-toast');
  if (unlockToast && !unlockToast.hidden) {
    unlockToast.hidden = true;
  }
  if (isHammer) {
    setTextIfChanged(textEl, '🔨 Tap any block, crate, or locked gate to smash');
    if (!axisBtn.hidden) axisBtn.hidden = true;
  } else if (isRocket) {
    setTextIfChanged(
      textEl,
      `🚀 Aim & release to blast entire ${hoverState.rocketAxis === 'ROW' ? 'ROW' : 'COLUMN'}`
    );
    if (axisBtn.hidden) axisBtn.hidden = false;
    setTextIfChanged(axisBtn, hoverState.rocketAxis === 'ROW' ? 'Axis: ↔ ROW' : 'Axis: ↕ COL');
  } else if (isVacuum) {
    setTextIfChanged(textEl, '🧲 Tap any unlocked colored block to vacuum all matching blocks');
    if (!axisBtn.hidden) axisBtn.hidden = true;
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
  const appShell = document.getElementById('app-shell');
  const titleEl = document.getElementById('title-overlay');
  const homeEl = document.getElementById('screen-home');
  const gameEl = document.getElementById('screen-game');
  const themesEl = document.getElementById('screen-themes');
  const tabBarEl = document.getElementById('menu-tab-bar');

  if (appShell) {
    appShell.setAttribute('data-title-open', app.titleOverlayOpen ? 'true' : 'false');
    appShell.setAttribute('data-active-screen', app.activeScreen);
  }

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
}

export function syncAllUiFromSaveImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();

  app.sound.updateSettings({
    sfxEnabled: save.settings.sfxEnabled,
    musicEnabled: save.settings.musicEnabled,
    hapticsEnabled: save.settings.hapticsEnabled,
    equippedParticle: save.equippedParticle,
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

  // Chests & Zen Sanctuary Progress
  const shredChestProg = Math.min(100, Math.max(0, save.shredderChestProgress % 100));
  const shredText = document.getElementById('shredder-chest-text');
  const shredFill = document.getElementById('shredder-chest-fill');
  if (shredText) shredText.textContent = `${shredChestProg}/100`;
  if (shredFill) shredFill.style.width = `${shredChestProg}%`;

  const milestoneStep = countUniqueClearedLevels(save) % 10;
  const mileText = document.getElementById('milestone-chest-text');
  const mileFill = document.getElementById('milestone-chest-fill');
  if (mileText) mileText.textContent = `${milestoneStep}/10`;
  if (mileFill) mileFill.style.width = `${Math.max(10, milestoneStep * 10)}%`;

  const blessCount = Math.min(3, Math.max(0, save.zenBlessings || 0));
  const starProg = Math.min(2, Math.max(0, save.zenStarProgress || 0));
  const blessProg = Math.min(3, Math.max(0, save.zenBlessingProgress || 0));
  const zenText = document.getElementById('zen-progress-text');
  const zenFill = document.getElementById('zen-progress-fill');
  if (zenText) zenText.textContent = `${blessCount}/3 · ★${starProg}/3`;
  if (zenFill) {
    const ratio = blessCount < 3 ? blessProg / 4 : starProg / 3;
    zenFill.style.width = `${Math.max(8, Math.round(ratio * 100))}%`;
  }

  // Connected Folder-Tab Sanctuary Mode Selector (`MAP-MODE-SPLIT-01`)
  const activeMode = save.settings.playMode;
  const modeTabDefs = [
    { mode: 'CHALLENGE', tabId: 'map-tab-challenge', lvlId: 'map-tab-lvl-challenge' },
    { mode: 'ZEN', tabId: 'map-tab-zen', lvlId: 'map-tab-lvl-zen' },
    { mode: 'TIMED', tabId: 'map-tab-timed', lvlId: 'map-tab-lvl-timed' },
  ] as const;
  for (const def of modeTabDefs) {
    const tabEl = document.getElementById(def.tabId);
    const lvlEl = document.getElementById(def.lvlId);
    const isSelected = def.mode === activeMode;
    if (tabEl) {
      tabEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tabEl.tabIndex = isSelected ? 0 : -1;
    }
    if (lvlEl) {
      lvlEl.textContent = `Lvl ${save.modeState[def.mode].currentLevelId}`;
    }
  }
  const modePanelEl = document.getElementById('map-mode-panel');
  if (modePanelEl) {
    modePanelEl.setAttribute('data-play-mode', activeMode);
    modePanelEl.setAttribute('aria-labelledby', `map-tab-${activeMode.toLowerCase()}`);
  }

  // Hero Launch Card & Mode-Aware Play CTAs (Scoped to Active Mode Ladder — `PLAY-CTA-MODE-01`)
  const modeInfo = getPlayModeMeta(activeMode);
  const activeLadder = save.modeState[activeMode];
  const targetLevelId = Math.max(1, activeLadder.currentLevelId || activeLadder.highestUnlocked || 1);
  const targetSpec = getLevelSpec(targetLevelId);
  const chapterMeta = getChapterMetaForLevel(targetLevelId);
  const heroChapterTag = document.getElementById('hero-chapter-tag');
  const heroDiff = document.getElementById('hero-badge-difficulty');
  const heroHeading = document.getElementById('hero-level-heading');
  const heroNote = document.getElementById('hero-level-note');
  const heroAwakeningText = document.getElementById('hero-awakening-text');
  const playBtn = document.getElementById('btn-play-current');
  const tabPlayBtn = document.getElementById('tab-btn-play');
  const tabPlayModeIcon = document.getElementById('tab-play-mode-icon');
  const tabPlayLabel = document.getElementById('tab-play-label');
  const pauseResumeBtn = document.getElementById('btn-pause-resume');

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
      (activeMode === 'ZEN'
        ? 'Untimed sanctuary flow — 3 clears earn +1 ★ & 4 clears bank a Free Continue Blessing'
        : activeMode === 'TIMED'
          ? `Beat the ${targetSpec.timeLimitSec ?? 90}s Speed Rush clock for up to 3 Gold Stars`
          : `Clear all blocks in ${targetSpec.parMoves ?? 6} moves for 3 Stars`);
  }
  if (heroAwakeningText) {
    heroAwakeningText.textContent = getNextSanctuaryAwakeningText(targetSpec.id);
  }
  if (playBtn) {
    playBtn.textContent = `${modeInfo.icon} ▶ PLAY LEVEL ${targetSpec.id}`;
  }
  if (tabPlayModeIcon) {
    tabPlayModeIcon.textContent = modeInfo.icon;
  }
  if (tabPlayLabel) {
    tabPlayLabel.textContent = targetSpec.id >= 1000 ? `Play ${targetSpec.id}` : `Play Lvl ${targetSpec.id}`;
  }
  if (tabPlayBtn) {
    tabPlayBtn.title = `Continue ${modeInfo.shortLabel} · Level ${targetSpec.id}`;
  }
  if (pauseResumeBtn) {
    pauseResumeBtn.textContent = `${modeInfo.icon} ▶ Resume`;
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
    titleChapterBadge.textContent = `${modeInfo.badgeLabel} · ${chapterMeta.chapterNum} · ${chapterMeta.title.toUpperCase()}`;
  }
  if (titleLevelSubtitle) {
    titleLevelSubtitle.textContent = `Level ${targetSpec.id} — ${targetSpec.name}`;
  }
  if (titleStatStars) titleStatStars.textContent = String(save.totalStars);
  if (titleStatCoins) titleStatCoins.textContent = String(save.coins);
  if (titleStatStreak) titleStatStreak.textContent = String(save.winStreak);
  if (titlePlayBtn) {
    titlePlayBtn.setAttribute('data-new-player', isNewPlayer ? 'true' : 'false');
    titlePlayBtn.textContent = isNewPlayer
      ? '▶ BEGIN JOURNEY'
      : `${modeInfo.icon} ▶ CONTINUE · LEVEL ${targetSpec.id}`;
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

  const tierSelect = document.getElementById('select-quality-tier') as HTMLSelectElement | null;
  if (tierSelect) {
    tierSelect.value = save.settings.qualityTier;
  }

  const jumpInput = document.getElementById('level-jump-input') as HTMLInputElement | null;
  if (jumpInput) {
    const maxUnlocked = Math.max(1, activeLadder.highestUnlocked || 1);
    jumpInput.max = String(maxUnlocked);
    jumpInput.title = `Jump to unlocked ${activeMode.toLowerCase()} stage (1–${maxUnlocked})`;
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

  const appShell = document.getElementById('app-shell');
  setAttrIfChanged(appShell, 'data-play-mode', playMode);
  setAttrIfChanged(document.body, 'data-play-mode', playMode);

  // Skips exist strictly in Zen Mode and cap at 3 consecutive un-cleared skips (`ZEN-SKIP-GUARD-01`)
  const isZenMode = playMode === 'ZEN';
  const skipAllowed = canSkipZenLevel(save, app.board.levelId);
  const skipHudBtn = document.getElementById('btn-skip-hud') as HTMLButtonElement | null;
  const pauseSkipBtn = document.getElementById('btn-pause-skip') as HTMLButtonElement | null;
  const skipCapReached = isZenMode && !skipAllowed;
  for (const btn of [skipHudBtn, pauseSkipBtn]) {
    if (!btn) continue;
    if (btn.hidden !== !isZenMode) btn.hidden = !isZenMode;
    if (btn.disabled !== !isZenMode) btn.disabled = !isZenMode;
    setAttrIfChanged(btn, 'aria-disabled', skipCapReached ? 'true' : 'false');
    if (btn.classList.contains('skip-cap-reached') !== skipCapReached) {
      btn.classList.toggle('skip-cap-reached', skipCapReached);
    }
  }

  const titleEl = document.getElementById('hud-level-title');
  const diffEl = document.getElementById('hud-difficulty-badge');
  const coinsInline = document.getElementById('hud-coins-inline');
  const modeBtn = document.getElementById('btn-mode-toggle');
  const modeIcon = document.getElementById('hud-mode-icon');
  const modeText = document.getElementById('hud-mode-text');
  const prevBtn = document.getElementById('btn-mode-prev');
  const prevIcon = document.getElementById('hud-mode-prev-icon');
  const prevLabel = document.getElementById('hud-mode-prev-label');
  const nextBtn = document.getElementById('btn-mode-next');
  const nextIcon = document.getElementById('hud-mode-next-icon');
  const nextLabel = document.getElementById('hud-mode-next-label');
  const movesPill = document.getElementById('hud-moves-pill');
  const timerPill = document.getElementById('hud-timer-pill');

  setTextIfChanged(titleEl, `Level ${app.board.levelId} — ${app.board.name}`);
  if (diffEl) {
    setTextIfChanged(diffEl, app.board.difficulty.replace('_', ' '));
    setClassIfChanged(diffEl, `badge-difficulty diff-${app.board.difficulty.toLowerCase()}`);
  }
  setTextIfChanged(coinsInline, `${save.coins}`);
  const modeMeta = {
    CHALLENGE: { icon: '⚔️', hero: 'Challenge', wing: 'Challenge', full: 'Challenge Mode' },
    ZEN: { icon: '🌿', hero: 'Zen', wing: 'Zen', full: 'Zen Mode' },
    TIMED: { icon: '⏱', hero: 'Speed Rush', wing: 'Rush', full: 'Speed Rush Mode' },
  } as const;
  setAttrIfChanged(modeBtn, 'data-mode', playMode);
  setTextIfChanged(modeIcon, modeMeta[playMode].icon);
  setTextIfChanged(modeText, modeMeta[playMode].hero);
  const modeOrder = ['CHALLENGE', 'ZEN', 'TIMED'] as const;
  const modeIdx = modeOrder.indexOf(playMode);
  const prevMode = modeOrder[(modeIdx + 2) % 3];
  const nextMode = modeOrder[(modeIdx + 1) % 3];
  setTextIfChanged(prevIcon, modeMeta[prevMode].icon);
  setTextIfChanged(prevLabel, modeMeta[prevMode].wing);
  const prevTitle = `Switch to ${modeMeta[prevMode].full}`;
  if (prevBtn && prevBtn.title !== prevTitle) prevBtn.title = prevTitle;
  setTextIfChanged(nextIcon, modeMeta[nextMode].icon);
  setTextIfChanged(nextLabel, modeMeta[nextMode].wing);
  const nextTitle = `Switch to ${modeMeta[nextMode].full}`;
  if (nextBtn && nextBtn.title !== nextTitle) nextBtn.title = nextTitle;

  if (movesPill) {
    if (playMode === 'CHALLENGE') {
      if (app.board.freeMovesRemaining > 0) {
        setTextIfChanged(
          movesPill,
          `Moves Left: ${app.board.movesRemaining} (+${app.board.freeMovesRemaining} Free)`
        );
        setClassIfChanged(movesPill, 'tabular-metric moves-pill moves-bonus');
      } else {
        setTextIfChanged(movesPill, `Moves Left: ${app.board.movesRemaining}`);
        const nextMovesClass =
          app.board.movesRemaining <= 1
            ? 'tabular-metric moves-pill moves-critical'
            : app.board.movesRemaining <= 3
              ? 'tabular-metric moves-pill moves-low'
              : 'tabular-metric moves-pill';
        setClassIfChanged(movesPill, nextMovesClass);
      }
    } else {
      setTextIfChanged(movesPill, `Moves: ${app.board.movesCommitted} / Par ${app.board.parMoves}`);
      setClassIfChanged(movesPill, 'tabular-metric moves-pill');
    }
  }
  if (timerPill && timerPill.hidden !== (playMode !== 'TIMED')) {
    timerPill.hidden = playMode !== 'TIMED';
  }
  app.syncTimerPillOnly();

  // Boosters Dock Badges, Rarity Accents & Progressive Level Unlocking (ECON-01 / ECON-02 / ZEN-SKIP-GUARD-01)
  const effectiveLevel = getEffectiveBoosterUnlockLevel(save, app.board.levelId);

  const syncBoosterSlot = (btnId: string, badgeId: string, type: BoosterType) => {
    const btnEl = document.getElementById(btnId);
    const badgeEl = document.getElementById(badgeId);
    const unlocked = isBoosterUnlocked(type, effectiveLevel);
    const rarity = BOOSTER_RARITY[type].toLowerCase();

    if (btnEl) {
      const rarityClass = `rarity-${rarity}`;
      if (!btnEl.classList.contains(rarityClass)) {
        btnEl.classList.remove(
          'rarity-common',
          'rarity-uncommon',
          'rarity-rare',
          'rarity-epic',
          'rarity-legendary'
        );
        btnEl.classList.add(rarityClass);
      }
      if (btnEl.classList.contains('locked-booster') === unlocked) {
        btnEl.classList.toggle('locked-booster', !unlocked);
      }
      setAttrIfChanged(btnEl, 'data-rarity', BOOSTER_RARITY[type]);
    }

    if (!badgeEl) return;

    if (!unlocked) {
      setTextIfChanged(badgeEl, `Lvl ${BOOSTER_UNLOCK_LEVEL[type]}`);
      setClassIfChanged(badgeEl, 'booster-badge badge-locked');
      return;
    }

    if (type === 'UNDO' && app.freeUndosRemaining > 0) {
      setTextIfChanged(badgeEl, `FREE (${app.freeUndosRemaining})`);
      setClassIfChanged(badgeEl, 'booster-badge badge-free');
      return;
    }

    const count = save.boosters[type] ?? 0;
    if (count > 0) {
      setTextIfChanged(badgeEl, String(count));
      setClassIfChanged(badgeEl, `booster-badge badge-rarity-${rarity}`);
    } else {
      setTextIfChanged(badgeEl, `${UI_BOOSTER_PRICES[type]} Coins`);
      setClassIfChanged(badgeEl, 'booster-badge badge-coin');
    }
  };

  syncBoosterSlot('btn-booster-undo', 'badge-booster-undo', 'UNDO');
  syncBoosterSlot('btn-booster-hint', 'badge-booster-hint', 'HINT');
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
    isLiveDrag: hover.activeBlockId !== null,
    dragLeftOrigin: hover.activeBlockId !== null ? Boolean(hover.dragLeftOrigin) : false,
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
      app.blueprintMix = Math.max(0, app.blueprintMix - dtSec / 0.58);
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
    app.bombTickAccumulatorSec += dtSec;
    while (app.bombTickAccumulatorSec >= bombTickSec) {
      app.bombTickAccumulatorSec -= bombTickSec;
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
