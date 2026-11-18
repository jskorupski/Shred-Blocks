import { isBoardRunStarted } from '../core/board';
import type { PlayMode, QualityTier, SavePayloadV1 } from '../core/types';
import { type AppViewContext, MAX_ENDLESS_LEVEL } from './catalog-meta';
import { cycleAudioVolumeSettingImpl } from './hud-and-title-view';
import { showKeystoneRuleToastImpl } from './hud-keystone';
import { handlePopstateNavigationImpl, refreshSaveTransferModalImpl } from './modals-and-save-transfer';
import { promptNativeInstall } from './pwa-update-lifecycle';
import { bindThemesAndCosmeticsEventsImpl } from './themes-studio-view';

export * from './pwa-update-lifecycle';

export function bindDomEventsImpl(app: AppViewContext): void {
  // Sacred-Geometry Title Crest Overlay Actions
  document.getElementById('btn-title-play')?.addEventListener('click', () => {
    const save = app.saveManager.getPayload();
    if (save.settings.reducedMotion) {
      app.sound.playButtonTap();
    }
    const ladder = save.modeState[save.settings.playMode];
    const targetId = app.isNewPlayerSave(save)
      ? 1
      : Math.max(1, Math.min(ladder.highestUnlocked, ladder.currentLevelId || ladder.highestUnlocked || 1));
    if (
      app.board.levelId !== targetId ||
      app.boardPlayMode !== save.settings.playMode ||
      isBoardRunStarted(app.board) ||
      app.levelOutcomeHandled
    ) {
      app.loadLevel(targetId, false, true);
    }
    app.dismissTitleScreen('game', true);
  });
  document.getElementById('btn-title-map')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.dismissTitleScreen('home');
  });
  document.getElementById('btn-title-themes')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.dismissTitleScreen('themes');
  });
  document.getElementById('btn-title-sync')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('save-transfer');
  });
  document.getElementById('btn-title-settings')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('pause');
  });
  document.getElementById('btn-title-install')?.addEventListener('click', () => {
    void app.handleInstallAction();
  });
  document.getElementById('btn-home-title')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openTitleScreen();
  });

  // Bottom Navigation Tabs
  document.getElementById('tab-btn-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.switchScreen('home');
  });
  document.getElementById('tab-btn-play')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const save = app.saveManager.getPayload();
    const ladder = save.modeState[save.settings.playMode];
    app.resumeOrLoadLevel(ladder.currentLevelId || ladder.highestUnlocked || 1, true);
  });
  document.getElementById('tab-btn-themes')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.switchScreen('themes');
  });
  document.getElementById('tab-btn-save')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('save-transfer');
  });
  document.getElementById('tab-btn-settings')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('pause');
  });

  // Connected Folder-Tab Sanctuary Mode Selector (`MAP-MODE-SPLIT-01`, WAI-ARIA `role="tablist"`)
  const modeTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#map-mode-tabs [data-mode-tab]'));
  const activateMapModeTab = (tab: HTMLButtonElement, focusTab = false) => {
    const nextMode = tab.dataset.modeTab as PlayMode | undefined;
    if (!nextMode) return;
    app.sound.playButtonTap();
    app.switchPlayMode(nextMode, true);
    if (focusTab) {
      tab.focus();
    }
  };
  for (const tab of modeTabs) {
    tab.addEventListener('click', () => {
      activateMapModeTab(tab, false);
    });
    tab.addEventListener('keydown', (e: KeyboardEvent) => {
      const idx = modeTabs.indexOf(tab);
      if (idx < 0) return;
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % modeTabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + modeTabs.length) % modeTabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = modeTabs.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        activateMapModeTab(modeTabs[nextIdx], true);
      }
    });
  }

  // Home Screen Actions
  document.getElementById('btn-play-current')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const save = app.saveManager.getPayload();
    const ladder = save.modeState[save.settings.playMode];
    app.resumeOrLoadLevel(ladder.currentLevelId || ladder.highestUnlocked || 1, true);
  });

  document.getElementById('btn-install-header')?.addEventListener('click', () => {
    void app.handleInstallAction();
  });

  // Roadmap Filter Chips (delegated for static Campaign + dynamic Endless 50-stage tier chips)
  document.querySelector<HTMLElement>('.filter-pills')?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.chip-filter[data-range]');
    if (!chip) return;
    app.sound.playButtonTap();
    app.activeRoadmapRange = chip.dataset.range ?? 'all';
    app.renderRoadmap();
  });

  bindThemesAndCosmeticsEventsImpl(app);

  // Direct Level Jump (Locked to 1..modeState[playMode].highestUnlocked)
  const jumpInput = document.getElementById('level-jump-input') as HTMLInputElement | null;
  const triggerLevelJump = () => {
    if (!jumpInput) return;
    const val = Number(jumpInput.value);
    if (!Number.isFinite(val) || val < 1) return;
    const target = Math.min(MAX_ENDLESS_LEVEL, Math.floor(val));
    const save = app.saveManager.getPayload();
    const maxUnlocked = Math.max(1, save.modeState[save.settings.playMode].highestUnlocked || 1);
    if (target > maxUnlocked) {
      app.sound.playWallClack();
      app.showGameToast(`🔒 Stage #${target} is locked — reach Stage #${maxUnlocked} first!`);
      return;
    }
    app.sound.playButtonTap();
    app.resumeOrLoadLevel(target, true);
  };
  document.getElementById('btn-level-jump')?.addEventListener('click', triggerLevelJump);
  jumpInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerLevelJump();
    }
  });

  // In-Game HUD Top Bar & Direct Map Return (including whole Title + Difficulty Crest region)
  const returnHudToMap = (syncBoardStage: boolean) => {
    app.sound.playButtonTap();
    if (syncBoardStage) {
      const save = app.saveManager.getPayload();
      const ladder = save.modeState[save.settings.playMode];
      if (app.board.levelId <= ladder.highestUnlocked && ladder.currentLevelId !== app.board.levelId) {
        app.saveManager.setCurrentLevel(app.board.levelId);
      }
    }
    app.inputController.cancelTargeting();
    app.closeAllModals();
    app.switchScreen('home');
  };
  document.getElementById('btn-hud-home')?.addEventListener('click', () => returnHudToMap(false));
  document.getElementById('btn-hud-title-map')?.addEventListener('click', () => returnHudToMap(true));

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('pause');
  });

  document.getElementById('btn-mode-prev')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const cur = app.saveManager.getPayload().settings.playMode;
    const prev: PlayMode = cur === 'CHALLENGE' ? 'TIMED' : cur === 'ZEN' ? 'CHALLENGE' : 'ZEN';
    app.switchPlayMode(prev);
  });

  document.getElementById('btn-mode-toggle')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const cur = app.saveManager.getPayload().settings.playMode;
    const next: PlayMode = cur === 'CHALLENGE' ? 'ZEN' : cur === 'ZEN' ? 'TIMED' : 'CHALLENGE';
    app.switchPlayMode(next);
  });

  document.getElementById('btn-mode-next')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const cur = app.saveManager.getPayload().settings.playMode;
    const next: PlayMode = cur === 'CHALLENGE' ? 'ZEN' : cur === 'ZEN' ? 'TIMED' : 'CHALLENGE';
    app.switchPlayMode(next);
  });

  document.getElementById('hud-keystone-info')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    showKeystoneRuleToastImpl(app);
  });

  document.getElementById('btn-restart')?.addEventListener('click', () => {
    app.restartCurrentLevel();
  });

  document.getElementById('btn-skip-hud')?.addEventListener('click', () => {
    app.skipCurrentLevel();
  });

  // Booster Targeting Banner
  document.getElementById('btn-rocket-axis')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.inputController.toggleRocketAxis();
    app.syncBoosterTargetingBanner(app.inputController.getHoverState());
  });

  document.getElementById('btn-cancel-booster')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.inputController.cancelTargeting();
  });

  // Bottom Booster Dock
  document.getElementById('btn-booster-undo')?.addEventListener('click', () => {
    app.activateBooster('UNDO');
  });
  document.getElementById('btn-booster-hint')?.addEventListener('click', () => {
    app.activateBooster('HINT');
  });
  document.getElementById('btn-booster-hammer')?.addEventListener('click', () => {
    app.activateBooster('HAMMER');
  });
  document.getElementById('btn-booster-rocket')?.addEventListener('click', () => {
    app.activateBooster('ROCKET');
  });
  document.getElementById('btn-booster-vacuum')?.addEventListener('click', () => {
    app.activateBooster('VACUUM');
  });

  // Victory Modal Buttons
  document.getElementById('btn-victory-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
    app.switchScreen('home');
  });
  document.getElementById('btn-victory-replay')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.loadLevel(app.board.levelId, true);
  });
  document.getElementById('btn-next-level')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const save = app.saveManager.getPayload();
    const ladder = save.modeState[save.settings.playMode];
    const nextId = Math.max(1, Math.min(MAX_ENDLESS_LEVEL, ladder.highestUnlocked, app.board.levelId + 1));
    app.loadLevel(nextId, true);
  });

  // Failure Modal Buttons
  document.getElementById('btn-failure-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
    app.switchScreen('home');
  });
  document.getElementById('btn-use-zen-blessing')?.addEventListener('click', () => {
    app.useZenBlessingContinue();
  });
  document.getElementById('btn-continue-level')?.addEventListener('click', () => {
    app.continueFailedLevel();
  });
  document.getElementById('btn-failure-zen')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.switchPlayMode('ZEN');
  });
  document.getElementById('btn-retry-level')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.loadLevel(app.board.levelId, true);
  });

  // Pause & Settings Modal Controls
  document.getElementById('btn-pause-close')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
  });
  document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
    if (app.titleOverlayOpen) {
      app.dismissTitleScreen('game');
    }
  });
  document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
    app.closeAllModals();
    if (app.titleOverlayOpen) {
      app.dismissTitleScreen('game');
    }
    app.restartCurrentLevel();
  });
  document.getElementById('btn-pause-skip')?.addEventListener('click', () => {
    app.skipCurrentLevel();
  });
  document.getElementById('btn-pause-save-transfer')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('save-transfer');
  });
  document.getElementById('btn-pause-install')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('install');
  });
  document.getElementById('btn-pause-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
    app.switchScreen('home');
  });

  const bindToggle = (id: string, key: keyof SavePayloadV1['settings']) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('change', () => {
      app.saveManager.updateSettings({ [key]: el.checked });
      app.renderNow();
    });
  };
  document.getElementById('btn-volume-sfx')?.addEventListener('click', () => {
    cycleAudioVolumeSettingImpl(app, 'sfx');
  });
  document.getElementById('btn-volume-music')?.addEventListener('click', () => {
    cycleAudioVolumeSettingImpl(app, 'music');
  });
  bindToggle('toggle-haptics', 'hapticsEnabled');
  bindToggle('toggle-colorblind', 'colorblindSymbols');
  bindToggle('toggle-high-contrast', 'highContrast');
  bindToggle('toggle-reduced-motion', 'reducedMotion');

  const qualitySelect = document.getElementById('select-quality-tier') as HTMLSelectElement | null;
  qualitySelect?.addEventListener('change', () => {
    const tier = qualitySelect.value as QualityTier;
    app.saveManager.updateSettings({ qualityTier: tier });
    app.renderer.setQualityPreference(tier);
    app.renderNow();
  });

  // Save Backup & Transfer Modal
  document.getElementById('btn-save-transfer-close')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
  });

  document.getElementById('btn-copy-save-code')?.addEventListener('click', async () => {
    app.sound.playButtonTap();
    const code = app.saveManager.exportSaveCode();
    const statusEl = document.getElementById('save-transfer-status');
    try {
      await navigator.clipboard.writeText(code);
      if (statusEl) statusEl.textContent = '📋 Compact Save Code copied to clipboard!';
    } catch {
      if (statusEl) statusEl.textContent = '📋 Select and copy the SB1-... code above.';
    }
  });

  document.getElementById('btn-copy-sync-url')?.addEventListener('click', async () => {
    app.sound.playButtonTap();
    const url = app.saveManager.buildShareUrl();
    const statusEl = document.getElementById('save-transfer-status');
    try {
      await navigator.clipboard.writeText(url);
      if (statusEl) statusEl.textContent = '🔗 Magic Sync URL copied to clipboard!';
    } catch {
      if (statusEl) statusEl.textContent = `🔗 Sync URL: ${url}`;
    }
  });

  document.getElementById('btn-download-json')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.saveManager.downloadSaveJsonFile();
    const statusEl = document.getElementById('save-transfer-status');
    if (statusEl) statusEl.textContent = '📥 Downloaded shredblocks-save-backup.json!';
  });

  document.getElementById('btn-preview-import')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const inputEl = document.getElementById('save-code-input') as HTMLTextAreaElement | null;
    app.previewSaveImport(inputEl ? inputEl.value : '');
  });

  const fileInput = document.getElementById('file-upload-json') as HTMLInputElement | null;
  document.getElementById('btn-upload-json')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    app.previewSaveImport(text);
    fileInput.value = '';
  });

  document.getElementById('btn-confirm-import')?.addEventListener('click', () => {
    app.confirmPendingSaveImport();
  });

  document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.pendingImportPayload = null;
    app.pendingImportRawCode = null;
    const diffPanel = document.getElementById('import-diff-panel');
    if (diffPanel) diffPanel.hidden = true;
  });

  document.getElementById('btn-restore-backup')?.addEventListener('click', () => {
    const restored = app.saveManager.restorePreImportBackup();
    if (restored) {
      app.sound.playBooster('UNDO');
      app.activeRoadmapRange = 'all';
      app.expandedEndlessRanges = [];
      const ladder = restored.modeState[restored.settings.playMode];
      const frontierId = Math.max(1, Math.min(ladder.highestUnlocked, ladder.currentLevelId || 1));
      app.loadLevel(frontierId, false, false);
      refreshSaveTransferModalImpl(app);
      app.renderRoadmap();
      app.renderThemesStudio();
      const statusEl = document.getElementById('save-transfer-status');
      if (statusEl) {
        statusEl.textContent = '⏪ Restored pre-import local save backup!';
      }
    }
  });

  // Install Modal
  document.getElementById('btn-install-close')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
  });

  document.getElementById('btn-trigger-native-install')?.addEventListener('click', async () => {
    await promptNativeInstall(app);
    app.closeAllModals();
  });

  window.addEventListener('hashchange', () => {
    app.checkUrlHashForSaveImport();
  });

  window.addEventListener('popstate', (event) => {
    handlePopstateNavigationImpl(app, event);
  });
}
