import type { BoosterType, ParticleStyleId, PlayMode, QualityTier, SavePayloadV1, SkinId, TrayId } from "../core/types";
import { generateQrSvg } from "../storage/qr-svg";
import { decodeSaveCode, validateSavePayloadV1 } from "../storage/save-code";
import { getLevelSpec } from "../levels/catalog";
import { extractImportCodeFromHash } from "../storage/save-manager";
import { BOOSTER_DEBUT_NOTES, type AppViewContext, type ModalId, type ShredBlocksDebugBridge } from "./catalog-meta";

export function getModalElement(id: ModalId): HTMLDialogElement | null {
  return document.getElementById(`dialog-${id}`) as HTMLDialogElement | null;
}

export function isAnyModalOpenImpl(): boolean {
  const ids: ModalId[] = ['victory', 'failure', 'pause', 'save-transfer', 'install'];
  return ids.some((id) => getModalElement(id)?.open);
}

export function openModalImpl(app: AppViewContext, id: ModalId): void {
  app.closeAllModals();
  const dialog = getModalElement(id);
  if (!dialog) return;

  if (id === 'pause') {
    updateTelemetryReadoutImpl(app);
  } else if (id === 'save-transfer') {
    refreshSaveTransferModalImpl(app);
  } else if (id === 'install') {
    const nativeBanner = document.getElementById('native-install-banner');
    if (nativeBanner) {
      nativeBanner.hidden = !app.deferredInstallPrompt;
    }
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

export function closeAllModalsImpl(): void {
  const ids: ModalId[] = ['victory', 'failure', 'pause', 'save-transfer', 'install'];
  for (const id of ids) {
    const dlg = getModalElement(id);
    if (dlg?.open) {
      dlg.close();
      dlg.returnValue = '';
    }
  }
}

export function setupDialogLightDismissImpl(): void {
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

export function updateTelemetryReadoutImpl(app: AppViewContext): void {
  const el = document.getElementById('telemetry-readout');
  if (!el) return;
  const t = app.renderer.getTelemetry();
  el.textContent = `FPS: ${t.fps} | Work: ${t.avgWorkMs}ms (p95: ${t.p95WorkMs}ms) | Tier: ${t.activeTier} | Backend: ${t.rendererBackend}`;
}

export function refreshSaveTransferModalImpl(app: AppViewContext): void {
  const codeOutput = document.getElementById(
    'save-code-output'
  ) as HTMLTextAreaElement | null;
  const qrContainer = document.getElementById('qr-code-container');
  const restoreBtn = document.getElementById('btn-restore-backup');
  const statusEl = document.getElementById('save-transfer-status');

  const code = app.saveManager.exportSaveCode();
  if (codeOutput) {
    codeOutput.value = code;
  }

  if (qrContainer) {
    try {
      const shareUrl = app.saveManager.buildShareUrl();
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
    restoreBtn.hidden = !app.saveManager.hasPreImportBackup();
  }

  if (statusEl && !app.pendingImportPayload) {
    statusEl.textContent = '';
  }
}

export function previewSaveImportImpl(app: AppViewContext, rawInput: string): boolean {
  const statusEl = document.getElementById('save-transfer-status');
  const diffPanel = document.getElementById('import-diff-panel');
  const curList = document.getElementById('diff-current-list');
  const incList = document.getElementById('diff-incoming-list');
  const inputArea = document.getElementById(
    'save-code-input'
  ) as HTMLTextAreaElement | null;

  app.openModal('save-transfer');
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

    app.pendingImportPayload = incoming;
    app.pendingImportRawCode = trimmed;

    const current = app.saveManager.getPayload();
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
    app.pendingImportPayload = null;
    app.pendingImportRawCode = null;
    if (diffPanel) diffPanel.hidden = true;
    if (statusEl) {
      statusEl.textContent = `❌ ${err instanceof Error ? err.message : 'Invalid save code.'}`;
    }
    return false;
  }
}

export function confirmPendingSaveImportImpl(app: AppViewContext): void {
  const statusEl = document.getElementById('save-transfer-status');
  const diffPanel = document.getElementById('import-diff-panel');
  if (!app.pendingImportRawCode) return;

  try {
    const raw = app.pendingImportRawCode.trim();
    const updated = raw.startsWith('{')
      ? app.saveManager.importSaveJson(raw)
      : app.saveManager.importSaveCode(raw);

    app.pendingImportPayload = null;
    app.pendingImportRawCode = null;
    if (diffPanel) diffPanel.hidden = true;

    if (window.location.hash.includes('import=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    refreshSaveTransferModalImpl(app);
    app.syncAllUiFromSave();
    app.renderRoadmap();
    app.renderThemesStudio();
    app.loadLevel(updated.currentLevelId || updated.highestLevelUnlocked || 1, false);

    if (statusEl) {
      statusEl.textContent =
        '🎉 Save imported! Your previous save is backed up and can be restored anytime.';
    }
    app.sound.playWinFanfare();
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `❌ Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  }
}

export function checkUrlHashForSaveImportImpl(app: AppViewContext): void {
  const code = extractImportCodeFromHash(window.location.hash);
  if (code) {
    app.previewSaveImport(code);
  }
}

export function createDebugBridgeImpl(app: AppViewContext): ShredBlocksDebugBridge {
  return {
    getBoard: () => app.board,
    getSave: () => app.saveManager.getPayload(),
    loadLevel: (levelId: number) => app.loadLevel(levelId, true),
    commitMove: (blockId: number, targetRow: number, targetCol: number) =>
      app.commitMove(blockId, targetRow, targetCol),
    autoSolveCurrentLevel: () => app.autoSolveCurrentLevel(),
    setPlayMode: (mode: PlayMode) => {
      app.saveManager.updateSettings({ playMode: mode });
      app.syncInGameHud();
      app.renderNow();
    },
    setColorblindMode: (enabled: boolean) => {
      app.saveManager.updateSettings({ colorblindSymbols: enabled });
      app.renderNow();
    },
    setHighContrast: (enabled: boolean) => {
      app.saveManager.updateSettings({ highContrast: enabled });
      app.renderNow();
    },
    setReducedMotion: (enabled: boolean) => {
      app.saveManager.updateSettings({ reducedMotion: enabled });
      app.renderNow();
    },
    setQualityTier: (tier: QualityTier) => {
      app.saveManager.updateSettings({ qualityTier: tier });
      app.renderer.setQualityPreference(tier);
      app.renderNow();
    },
    setTheme: (skin: SkinId, tray: TrayId, particle: ParticleStyleId) => {
      app.saveManager.unlockOrEquipSkin(skin, 0);
      app.saveManager.unlockOrEquipTray(tray, 0);
      app.saveManager.unlockOrEquipParticle(particle, 0);
      app.renderThemesStudio();
      app.renderNow();
    },
    activateBooster: (type: BoosterType) => app.activateBooster(type),
    openModal: (id: ModalId) => app.openModal(id),
    closeAllModals: () => app.closeAllModals(),
    openTitleScreen: () => app.openTitleScreen(),
    dismissTitleScreen: (targetScreen = "game") => app.dismissTitleScreen(targetScreen),
    isTitleScreenOpen: () => app.titleOverlayOpen,
    previewSaveImport: (code: string) => app.previewSaveImport(code),
    getTelemetry: () => app.renderer.getTelemetry(),
    run120HzBenchmark: (frames = 120) => app.renderer.run120HzBenchmark(frames, app.board),
    simulateContextLoss: () => {
      const canvas = app.renderer.canvas;
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      canvas.dispatchEvent(new Event("webglcontextrestored"));
      app.renderNow();
    },
    boardToScreen: (boardX: number, boardY: number) => {
      const rect = app.renderer.canvas.getBoundingClientRect();
      return app.renderer
        .getCamera()
        .boardToScreen(boardX, boardY, 0.58, rect, app.board.rows, app.board.cols);
    },
  };
}

export function continueFailedLevelImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  if (save.coins < 50) {
    app.showGameToast("Need 50 Coins to continue — or Retry / Skip for FREE!");
    return;
  }
  if (app.saveManager.buyBoosterWithCoins("FREEZE", 50)) {
    app.saveManager.spendBooster("FREEZE");
  }
  app.board.timeRemainingSec = Math.max(15, app.board.timeRemainingSec + 15);
  for (const b of app.board.blocks) {
    if (b.status === "ACTIVE" && b.bombMax > 0 && b.bombCount <= 0) {
      b.bombCount = Math.max(6, b.bombMax);
    }
  }
  app.levelOutcomeHandled = false;
  app.board.timerRunning = true;
  app.closeAllModals();
  app.sound.playBooster("FREEZE");
  app.syncInGameHud();
  app.renderNow();
}

export function openTitleScreenImpl(app: AppViewContext): void {
  app.titleOverlayOpen = true;
  app.blueprintMix = 1.0;
  const save = app.saveManager.getPayload();
  const targetLevelId = Math.max(1, save.currentLevelId || save.highestLevelUnlocked || 1);
  if (app.board.levelId !== targetLevelId) {
    app.loadLevel(targetLevelId, false, false);
  }
  app.syncAllUiFromSave();
  app.syncTitleOverlayDom();
  app.renderer.resize();
  app.renderNow();
}

export function dismissTitleScreenImpl(
  app: AppViewContext,
  targetScreen: "game" | "home" | "themes" = "game"
): void {
  app.titleOverlayOpen = false;
  app.switchScreen(targetScreen);
  if (targetScreen === "game" && app.board.movesCommitted === 0) {
    const spec = getLevelSpec(app.board.levelId);
    app.showUnlockNoteIfPresent(spec.unlockNote ?? BOOSTER_DEBUT_NOTES[app.board.levelId]);
    app.lastPointerActivityMs = performance.now();
  }
}

export function switchScreenImpl(app: AppViewContext, screen: "home" | "game" | "themes"): void {
  app.activeScreen = screen;
  app.titleOverlayOpen = false;
  app.syncTitleOverlayDom();

  document.getElementById("tab-btn-home")?.classList.toggle("active", screen === "home");
  document.getElementById("tab-btn-themes")?.classList.toggle("active", screen === "themes");

  if (screen === "home") {
    app.renderRoadmap();
  } else if (screen === "themes") {
    app.renderThemesStudio();
  } else if (screen === "game") {
    app.renderer.resize();
    app.syncInGameHud();
    app.renderNow();
  }
}

export function showGameToastImpl(app: AppViewContext, message: string, durationMs = 2600): void {
  const toast = document.getElementById("game-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  if (app.toastTimerId !== null) {
    clearTimeout(app.toastTimerId);
  }
  app.toastTimerId = setTimeout(() => {
    toast.hidden = true;
  }, durationMs);
}

export function showUnlockNoteIfPresentImpl(app: AppViewContext, note?: string): void {
  const banner = document.getElementById("unlock-toast");
  const textEl = document.getElementById("unlock-toast-text");
  if (!banner || !textEl) return;

  if (app.unlockToastTimerId !== null) {
    clearTimeout(app.unlockToastTimerId);
    app.unlockToastTimerId = null;
  }

  if (!note) {
    banner.hidden = true;
    return;
  }

  textEl.textContent = note;
  banner.hidden = false;
  app.unlockToastTimerId = setTimeout(() => {
    banner.hidden = true;
  }, 5500);
}
