import { isBoardFailed, isBoardWon } from '../core/board';
import type { ParticleStyleId } from '../core/types';
import {
  type AppViewContext,
  getThemeItemPrice,
  PARTICLE_CATALOG,
  PARTICLE_GLYPHS,
  SKIN_CATALOG,
  TRAY_CATALOG,
} from './catalog-meta';
import { cancelPendingOutcomeTransition } from './outcome-modals-view';
import { renderThemesStudioImpl } from './themes-studio-view';

let pauseDrawerExpanded = false;
let pauseDrawerCustomNotice: string | null = null;

/**
 * Checks whether `app.board` holds a live, non-terminal board for `(levelId, activePlayMode)`
 * that can be resumed seamlessly without resetting to Move 0 (`SESSION-RESUME-01`, `MODE-ISOLATION-01`).
 */
export function canResumeBoardImpl(app: AppViewContext, levelId = app.board.levelId): boolean {
  const cleanId = Math.max(1, Math.floor(levelId));
  const save = app.saveManager.getPayload();
  return (
    app.board.levelId === cleanId &&
    app.boardPlayMode === save.settings.playMode &&
    !app.levelOutcomeHandled &&
    !isBoardWon(app.board) &&
    !isBoardFailed(app.board, app.boardPlayMode).failed
  );
}

/**
 * Resumes the exact in-progress `BoardState` (preserving blocks, moves/timer, undo stack, and spent Boosters)
 * when returning to the same stage & mode, or performs a clean Move-0 `loadLevel` otherwise (`SESSION-RESUME-01`).
 */
export function resumeOrLoadLevelImpl(
  app: AppViewContext,
  levelId: number,
  switchToGameScreen = true,
  persistLevel = true
): void {
  const cleanId = Math.max(1, Math.floor(levelId));
  if (!app.canResumeBoard(cleanId)) {
    app.loadLevel(cleanId, switchToGameScreen, persistLevel);
    return;
  }
  cancelPendingOutcomeTransition();
  app.inputController.cancelTargeting();
  app.lastPointerActivityMs = performance.now();
  const save = app.saveManager.getPayload();
  const activeLadder = save.modeState[save.settings.playMode];
  if (persistLevel && (cleanId !== save.currentLevelId || cleanId !== activeLadder.currentLevelId)) {
    app.saveManager.setCurrentLevel(cleanId);
  }
  if (switchToGameScreen) {
    app.blueprintMix = 0;
    app.closeAllModals();
    app.switchScreen('game');
  }
  app.syncAllUiFromSave();
  app.syncInGameHud();
  app.renderer.resize();
  app.renderNow();
}

/**
 * Synchronizes the expandable Cosmetics Quick-Chooser inside `#dialog-pause` (`Settings`),
 * allowing 1-tap swaps across owned Block Skins, Board Trays, and Shred Particles while
 * keeping unowned cosmetics visually locked (`aria-disabled="true"`) with a direct jump to Themes Studio.
 */
export function syncPauseCosmeticsDrawerImpl(app: AppViewContext, collapseDrawer = false): void {
  if (collapseDrawer) {
    pauseDrawerExpanded = false;
    pauseDrawerCustomNotice = null;
  }

  const save = app.saveManager.getPayload();
  const toggleBtn = document.getElementById('btn-toggle-cosmetics-drawer') as HTMLButtonElement | null;
  const panelEl = document.getElementById('pause-cosmetics-panel');
  const pillEl = document.getElementById('pause-cosmetics-pill');
  const summaryEl = document.getElementById('pause-cosmetics-summary');
  const miniSkin = document.getElementById('pause-mini-swatch-skin');
  const miniTray = document.getElementById('pause-mini-swatch-tray');
  const miniPart = document.getElementById('pause-mini-swatch-particle');
  const statusEl = document.getElementById('pause-cosmetics-status');
  const rowsEl = document.getElementById('pause-cosmetics-rows');
  const coinsEl = document.getElementById('pause-cosmetics-coins');

  if (!toggleBtn || !panelEl || !rowsEl) return;

  const ownedUpgrades = Math.max(
    0,
    save.unlockedSkins.length - 1 + (save.unlockedTrays.length - 1) + (save.unlockedParticles.length - 1)
  );

  toggleBtn.setAttribute('aria-expanded', pauseDrawerExpanded ? 'true' : 'false');
  panelEl.hidden = !pauseDrawerExpanded;

  if (miniSkin) miniSkin.className = `mini-theme-swatch swatch-${save.equippedSkin}`;
  if (miniTray) miniTray.className = `mini-theme-swatch swatch-${save.equippedTray}`;
  if (miniPart) {
    miniPart.className = `mini-theme-swatch swatch-${save.equippedParticle}`;
    miniPart.textContent = PARTICLE_GLYPHS[save.equippedParticle] ?? '◆';
  }

  if (pillEl) {
    pillEl.textContent = pauseDrawerExpanded ? 'Hide' : ownedUpgrades > 0 ? 'Swap' : 'Browse';
  }
  if (coinsEl) {
    coinsEl.textContent = `${save.coins} Coins`;
  }

  const skinName = SKIN_CATALOG.find((s) => s.id === save.equippedSkin)?.name ?? 'Classic Studs';
  const trayName = TRAY_CATALOG.find((t) => t.id === save.equippedTray)?.name ?? 'Industrial Slate';
  const partName = PARTICLE_CATALOG.find((p) => p.id === save.equippedParticle)?.name ?? 'Classic Cubes';
  const loadoutSummary = `${skinName} · ${trayName} · ${partName}`;

  if (summaryEl) {
    summaryEl.textContent =
      ownedUpgrades === 0 && !pauseDrawerExpanded
        ? 'Starter loadout · Preview & unlock in Themes Studio'
        : loadoutSummary;
  }

  if (statusEl) {
    if (pauseDrawerCustomNotice) {
      statusEl.textContent = pauseDrawerCustomNotice;
      statusEl.classList.add('is-locked-hint');
    } else if (ownedUpgrades === 0) {
      statusEl.textContent = 'Starter set active — preview & unlock upgrades in Themes Studio';
      statusEl.classList.remove('is-locked-hint');
    } else {
      statusEl.textContent = 'Tap an unlocked tile to equip immediately';
      statusEl.classList.remove('is-locked-hint');
    }
  }

  if (!pauseDrawerExpanded) return;

  const buildQuickRow = <T extends string>(
    rowLabel: string,
    kind: 'skin' | 'tray' | 'particle',
    items: ReadonlyArray<{ id: T; name: string }>,
    unlockedList: T[],
    equippedId: T,
    equipFn: (id: T) => boolean
  ) => {
    const row = document.createElement('div');
    row.className = 'cosmetics-quick-row';

    const label = document.createElement('span');
    label.className = 'cosmetics-quick-label';
    label.textContent = rowLabel;

    const strip = document.createElement('div');
    strip.className = 'cosmetics-quick-strip';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', rowLabel);

    items.forEach((item, idx) => {
      const price = getThemeItemPrice(idx);
      const isUnlocked = unlockedList.includes(item.id);
      const isEquipped = equippedId === item.id;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.quickCosmeticKind = kind;
      btn.dataset.quickCosmeticId = item.id;
      btn.className = ['cosmetic-quick-btn', isEquipped ? 'is-equipped' : '', !isUnlocked ? 'is-locked' : '']
        .filter(Boolean)
        .join(' ');
      btn.title = isEquipped
        ? `${item.name} (Equipped)`
        : isUnlocked
          ? `Equip ${item.name}`
          : `${item.name} — Locked (${price} Coins in Themes Studio)`;
      btn.setAttribute(
        'aria-label',
        isUnlocked ? `${item.name}${isEquipped ? ', equipped' : ''}` : `${item.name}, locked (${price} Coins)`
      );
      if (isUnlocked) {
        btn.setAttribute('aria-pressed', isEquipped ? 'true' : 'false');
      } else {
        btn.setAttribute('aria-disabled', 'true');
      }

      const swatch = document.createElement('span');
      swatch.className = `quick-swatch-tile swatch-${item.id}`;
      swatch.setAttribute('aria-hidden', 'true');
      const glyph = PARTICLE_GLYPHS[item.id as ParticleStyleId];
      if (glyph) {
        swatch.textContent = glyph;
      }

      const cornerBadge = document.createElement('span');
      cornerBadge.className = 'quick-swatch-badge';
      cornerBadge.setAttribute('aria-hidden', 'true');
      if (isEquipped) {
        cornerBadge.textContent = '✓';
      } else if (!isUnlocked) {
        cornerBadge.textContent = '🔒';
      }

      btn.append(swatch, cornerBadge);
      btn.addEventListener('click', () => {
        if (!isUnlocked) {
          app.sound.playWallClack();
          pauseDrawerCustomNotice = `🔒 ${item.name} (${price} Coins) — Unlock in Themes Studio`;
          syncPauseCosmeticsDrawerImpl(app, false);
          return;
        }
        pauseDrawerCustomNotice = null;
        if (isEquipped) {
          if (kind === 'particle') {
            app.sound.playParticlePreview(item.id as unknown as ParticleStyleId);
          } else {
            app.sound.playButtonTap();
          }
          syncPauseCosmeticsDrawerImpl(app, false);
          return;
        }
        if (equipFn(item.id)) {
          if (kind === 'particle') {
            app.sound.playParticlePreview(item.id as unknown as ParticleStyleId);
          } else {
            app.sound.playButtonTap();
          }
          app.syncAllUiFromSave();
          renderThemesStudioImpl(app);
          app.renderNow();
          app.requestModalBackdropRefresh?.();
        }
      });

      strip.appendChild(btn);
    });

    row.append(label, strip);
    return row;
  };

  const frag = document.createDocumentFragment();
  frag.append(
    buildQuickRow('Blocks', 'skin', SKIN_CATALOG, save.unlockedSkins, save.equippedSkin, (id) =>
      app.saveManager.unlockOrEquipSkin(id, 0)
    ),
    buildQuickRow('Board', 'tray', TRAY_CATALOG, save.unlockedTrays, save.equippedTray, (id) =>
      app.saveManager.unlockOrEquipTray(id, 0)
    ),
    buildQuickRow(
      'Shred',
      'particle',
      PARTICLE_CATALOG,
      save.unlockedParticles,
      save.equippedParticle,
      (id) => app.saveManager.unlockOrEquipParticle(id, 0)
    )
  );
  rowsEl.replaceChildren(frag);
}

/**
 * Binds DOM listeners for the Settings Cosmetics Quick-Chooser drawer and Themes Studio tabs.
 */
export function bindThemesAndCosmeticsEventsImpl(app: AppViewContext): void {
  document.getElementById('btn-toggle-cosmetics-drawer')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    pauseDrawerExpanded = !pauseDrawerExpanded;
    if (!pauseDrawerExpanded) {
      pauseDrawerCustomNotice = null;
    }
    syncPauseCosmeticsDrawerImpl(app, false);
    if (pauseDrawerExpanded) {
      const drawerEl = document.getElementById('pause-cosmetics-drawer');
      drawerEl?.scrollIntoView({
        behavior: app.saveManager.getPayload().settings.reducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
    }
  });

  document.getElementById('btn-pause-open-themes')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const cameFromGame = app.activeScreen === 'game' && !app.titleOverlayOpen;
    app.closeAllModals();
    app.themesEnteredFromGame = cameFromGame;
    if (app.titleOverlayOpen) {
      app.dismissTitleScreen('themes', false);
    } else {
      app.switchScreen('themes');
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-theme-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      app.sound.playButtonTap();
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

  document.getElementById('btn-themes-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.switchScreen('home');
  });
}
