import type { PlayMode, QualityTier, SavePayloadV1 } from "../core/types";
import {
  PWA_INSTALLED_STORAGE_KEY,
  type AppViewContext,
  type BeforeInstallPromptEvent,
} from "./catalog-meta";
import { refreshSaveTransferModalImpl } from "./modals-and-save-transfer";

export function bindDomEventsImpl(app: AppViewContext): void {
  // Sacred-Geometry Title Crest Overlay Actions
  document.getElementById('btn-title-play')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const save = app.saveManager.getPayload();
    const targetId = app.isNewPlayerSave(save)
      ? 1
      : Math.max(1, save.currentLevelId || save.highestLevelUnlocked || 1);
    if (app.board.levelId !== targetId) {
      app.loadLevel(targetId, true);
    } else {
      app.dismissTitleScreen('game');
    }
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
    app.loadLevel(save.currentLevelId || save.highestLevelUnlocked || 1, true);
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

  // Home Screen Actions
  document.getElementById('btn-play-current')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const save = app.saveManager.getPayload();
    app.loadLevel(save.currentLevelId || save.highestLevelUnlocked || 1, true);
  });

  document.getElementById('btn-install-header')?.addEventListener('click', () => {
    void app.handleInstallAction();
  });

  // Roadmap Filter Chips
  document.querySelectorAll<HTMLButtonElement>('.chip-filter[data-range]').forEach((chip) => {
    chip.addEventListener('click', () => {
      app.sound.playButtonTap();
      document
        .querySelectorAll('.chip-filter[data-range]')
        .forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      app.activeRoadmapRange = chip.dataset.range ?? 'all';
      app.renderRoadmap();
    });
  });

  // Themes Studio Category Filter Tabs
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

  // Direct Level Jump
  const jumpInput = document.getElementById('level-jump-input') as HTMLInputElement | null;
  document.getElementById('btn-level-jump')?.addEventListener('click', () => {
    if (!jumpInput) return;
    const val = Number(jumpInput.value);
    if (Number.isFinite(val) && val >= 1) {
      app.sound.playButtonTap();
      app.loadLevel(Math.min(999, Math.floor(val)), true);
    }
  });

  // In-Game HUD Top Bar & Direct Map Return
  document.getElementById('btn-hud-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.inputController.cancelTargeting();
    app.closeAllModals();
    app.switchScreen('home');
  });

  document.getElementById('btn-themes-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.switchScreen('home');
  });

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.openModal('pause');
  });

  document.getElementById('btn-mode-toggle')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    const cur = app.saveManager.getPayload().settings.playMode;
    const next: PlayMode = cur === 'ZEN' ? 'TIMED' : 'ZEN';
    const hadMoves = app.board.movesCommitted > 0;
    app.saveManager.updateSettings({ playMode: next });
    if (hadMoves) {
      app.loadLevel(app.board.levelId, true);
    } else {
      app.syncInGameHud();
      app.renderNow();
    }
    app.showGameToast(
      next === 'ZEN'
        ? `🧘 Switched to Zen Mode${hadMoves ? ' — Level Restarted' : ''}`
        : `⏱ Switched to Timed Rush${hadMoves ? ' — Level Restarted' : ''}`
    );
  });

  document.getElementById('btn-hud-sfx')?.addEventListener('click', () => {
    const cur = app.saveManager.getPayload().settings.sfxEnabled;
    app.saveManager.updateSettings({ sfxEnabled: !cur });
    app.sound.playButtonTap();
  });

  document.getElementById('btn-hud-music')?.addEventListener('click', () => {
    const cur = app.saveManager.getPayload().settings.musicEnabled;
    app.saveManager.updateSettings({ musicEnabled: !cur });
    app.sound.playButtonTap();
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
  document.getElementById('btn-booster-freeze')?.addEventListener('click', () => {
    app.activateBooster('FREEZE');
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
    app.loadLevel(app.board.levelId + 1, true);
  });

  // Failure Modal Buttons
  document.getElementById('btn-failure-home')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.closeAllModals();
    app.switchScreen('home');
  });
  document.getElementById('btn-continue-level')?.addEventListener('click', () => {
    app.continueFailedLevel();
  });
  document.getElementById('btn-retry-level')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.loadLevel(app.board.levelId, true);
  });
  document.getElementById('btn-skip-level')?.addEventListener('click', () => {
    app.skipCurrentLevel();
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
    const inputEl = document.getElementById(
      'save-code-input'
    ) as HTMLTextAreaElement | null;
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
      refreshSaveTransferModalImpl(app);
      app.syncAllUiFromSave();
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
    if (!app.deferredInstallPrompt) return;
    await app.deferredInstallPrompt.prompt();
    const choice = await app.deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      app.markPwaInstalled();
    }
    app.deferredInstallPrompt = null;
    app.closeAllModals();
  });

  window.addEventListener('hashchange', () => {
    app.checkUrlHashForSaveImport();
  });
}

export function isPwaInstalledImpl(app: AppViewContext): boolean {
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
    app.pwaInstalledDetected = true;
    try {
      window.localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    return true;
  }

  try {
    if (window.localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === '1') {
      return true;
    }
  } catch {
    // Ignore storage errors
  }

  return app.pwaInstalledDetected;
}

export function markPwaInstalledImpl(app: AppViewContext): void {
  app.pwaInstalledDetected = true;
  try {
    window.localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
  } catch {
    // Ignore storage errors
  }
  app.syncInstallUiVisibility();
}

export function syncInstallUiVisibilityImpl(app: AppViewContext): void {
  const installed = app.isPwaInstalled();
  const headerInstallBtn = document.getElementById('btn-install-header');
  const titleInstallBtn = document.getElementById('btn-title-install');
  if (headerInstallBtn) headerInstallBtn.hidden = installed;
  if (titleInstallBtn) titleInstallBtn.hidden = installed;
}

export async function handleInstallActionImpl(app: AppViewContext): Promise<void> {
  app.sound.playButtonTap();
  if (app.deferredInstallPrompt) {
    try {
      await app.deferredInstallPrompt.prompt();
      const choice = await app.deferredInstallPrompt.userChoice;
      app.deferredInstallPrompt = null;
      if (choice.outcome === 'accepted') {
        app.markPwaInstalled();
        app.closeAllModals();
      }
      return;
    } catch {
      // Fall through to install guide modal
    }
  }
  app.openModal('install');
}

export function setupPwaAndServiceWorkerImpl(app: AppViewContext): void {
  app.syncInstallUiVisibility();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    app.deferredInstallPrompt = e as BeforeInstallPromptEvent;
    app.syncInstallUiVisibility();
  });

  window.addEventListener('appinstalled', () => {
    app.deferredInstallPrompt = null;
    app.markPwaInstalled();
    app.closeAllModals();
    app.showGameToast('📲 ShredBlocks installed to your device!');
  });

  try {
    window
      .matchMedia('(display-mode: standalone)')
      .addEventListener('change', () => app.syncInstallUiVisibility());
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
          app.markPwaInstalled();
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
            app.waitingServiceWorker = reg.waiting;
            showPwaUpdateToastImpl();
          }

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                app.waitingServiceWorker = newWorker;
                showPwaUpdateToastImpl();
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
      if (app.waitingServiceWorker) {
        userRequestedSwUpdate = true;
        app.waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
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

export function showPwaUpdateToastImpl(): void {
  const toast = document.getElementById('pwa-update-toast');
  if (toast) toast.hidden = false;
}
