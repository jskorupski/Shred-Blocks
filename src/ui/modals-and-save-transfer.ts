import { isBoardWon } from '../core/board';
import { getActiveColor } from '../core/polyomino';
import type {
  BoosterType,
  ParticleStyleId,
  PlayMode,
  QualityTier,
  SavePayloadV1,
  SkinId,
  TrayId,
} from '../core/types';
import { getLevelSpec } from '../levels/catalog';
import { solveBoard } from '../levels/solver';
import { generateQrSvg } from '../storage/qr-svg';
import { decodeSaveCode, validateSavePayloadV1 } from '../storage/save-code';
import { CONTINUE_COIN_COST, extractImportCodeFromHash } from '../storage/save-manager';
import {
  type AppHistoryState,
  type AppViewContext,
  BOOSTER_DEBUT_NOTES,
  type ModalId,
  type ShredBlocksDebugBridge,
} from './catalog-meta';

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
    const isTerminalOutcomeModal = dialog.id === 'dialog-victory' || dialog.id === 'dialog-failure';

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
        e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
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
  const codeOutput = document.getElementById('save-code-output') as HTMLTextAreaElement | null;
  const qrContainer = document.getElementById('qr-code-container');
  const restoreBtn = document.getElementById('btn-restore-backup');
  const statusEl = document.getElementById('save-transfer-status');

  const code = app.saveManager.exportSaveCode();
  if (codeOutput) {
    codeOutput.value = code;
  }

  if (qrContainer) {
    try {
      const shareUrl = app.saveManager.buildShareUrl(undefined, true);
      qrContainer.innerHTML = generateQrSvg(shareUrl);
    } catch {
      try {
        qrContainer.innerHTML = generateQrSvg(app.saveManager.exportSaveCode({ qrCompact: true }));
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
  const inputArea = document.getElementById('save-code-input') as HTMLTextAreaElement | null;

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
        `Total Stars: ★ ${p.totalStars}`,
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
      statusEl.textContent = '✓ Valid save verified! Review the comparison below to confirm.';
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
      history.replaceState(history.state, '', window.location.pathname + window.location.search);
    }

    refreshSaveTransferModalImpl(app);
    app.syncAllUiFromSave();
    app.renderRoadmap();
    app.renderThemesStudio();
    app.loadLevel(updated.currentLevelId || updated.highestLevelUnlocked || 1, false);
    if (typeof history !== 'undefined' && isAppHistoryState(history.state) && history.state.view === 'game') {
      history.replaceState(
        { __shredblocksNav: true, view: 'game', levelId: app.board.levelId } satisfies AppHistoryState,
        ''
      );
    }

    if (statusEl) {
      statusEl.textContent = '🎉 Save imported! Your previous save is backed up and can be restored anytime.';
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

export function switchPlayModeImpl(app: AppViewContext, nextMode: PlayMode, silent = false): void {
  const prevMode = app.saveManager.getPayload().settings.playMode;
  if (prevMode === nextMode) {
    if (nextMode === 'ZEN') {
      const failDlg = getModalElement('failure');
      if (failDlg?.open) {
        failDlg.close();
      }
    }
    return;
  }

  app.saveManager.updateSettings({ playMode: nextMode });
  // Freeze seconds are a TIMED-only resource; never let them leak into Challenge/Zen move-based bomb ticks
  if (prevMode === 'TIMED') {
    app.board.freezeRemainingSec = 0;
  }

  if (nextMode === 'ZEN') {
    app.runTouchedZen = true;
    if (!isBoardWon(app.board)) {
      app.levelOutcomeHandled = false;
    }
    for (const b of app.board.blocks) {
      if (b.status === 'ACTIVE' && b.bombMax > 0 && b.bombCount <= 0) {
        b.bombCount = Math.max(4, b.bombMax);
      }
    }
    const failDlg = getModalElement('failure');
    if (failDlg?.open) {
      failDlg.close();
    }
    app.syncAllUiFromSave();
    app.renderNow();
    if (!silent) {
      app.showGameToast('🌿 Switched to Zen Mode — finish this board freely!');
    }
    return;
  }

  const mustRestart = app.board.movesCommitted > 0 || app.runTouchedZen;
  if (mustRestart) {
    app.closeAllModals();
    app.loadLevel(app.board.levelId, app.activeScreen === 'game' && !app.titleOverlayOpen, false);
    if (!silent) {
      app.showGameToast(
        nextMode === 'CHALLENGE'
          ? '⚔️ Challenge Mode — stage restarted for Gold Stars!'
          : '⏱ Speed Rush — stage restarted for Gold Stars!'
      );
    }
  } else {
    app.runTouchedZen = false;
    app.levelOutcomeHandled = false;
    app.syncAllUiFromSave();
    app.renderNow();
    if (!silent) {
      app.showGameToast(
        nextMode === 'CHALLENGE'
          ? '⚔️ Switched to Challenge Mode (Move Budget)'
          : '⏱ Switched to Speed Rush (Timed)'
      );
    }
  }
}

export function createDebugBridgeImpl(app: AppViewContext): ShredBlocksDebugBridge {
  return {
    getBoard: () => app.board,
    getSave: () => app.saveManager.getPayload(),
    patchSave: (patch: Partial<SavePayloadV1>) => {
      const next = validateSavePayloadV1({ ...app.saveManager.getPayload(), ...patch });
      if (next) {
        app.saveManager.importSaveJson(JSON.stringify(next));
        app.syncAllUiFromSave();
        app.renderRoadmap();
        app.renderThemesStudio();
      }
    },
    loadLevel: (levelId: number) => {
      const cleanId = Math.max(1, Math.floor(levelId));
      app.saveManager.setCurrentLevel(cleanId, true);
      app.loadLevel(cleanId, true, false);
    },
    commitMove: (blockId: number, targetRow: number, targetCol: number) =>
      app.commitMove(blockId, targetRow, targetCol),
    autoSolveCurrentLevel: () => app.autoSolveCurrentLevel(),
    setPlayMode: (mode: PlayMode) => {
      app.switchPlayMode(mode, true);
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
    dismissTitleScreen: (targetScreen = 'game', animateAwakening = false) =>
      app.dismissTitleScreen(targetScreen, animateAwakening),
    isTitleScreenOpen: () => app.titleOverlayOpen,
    getBlueprintMix: () => app.blueprintMix,
    setPwaUpdateBannerVisible: (visible: boolean) => {
      app.pwaUpdateAvailable = visible;
      app.pwaUpdateDismissedInSession = false;
      app.syncPwaUpdateBanner();
    },
    previewSaveImport: (code: string) => app.previewSaveImport(code),
    getTelemetry: () => app.renderer.getTelemetry(),
    run120HzBenchmark: (frames = 120) => app.renderer.run120HzBenchmark(frames, app.board),
    simulateContextLoss: () => {
      const canvas = app.renderer.canvas;
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      canvas.dispatchEvent(new Event('webglcontextrestored'));
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
  // Charge first: the +5 Moves / +20s are only granted once the 150-coin payment actually succeeds
  if (save.coins < CONTINUE_COIN_COST || !app.saveManager.buyBoosterWithCoins('FREEZE', CONTINUE_COIN_COST)) {
    app.showGameToast(`Need ${CONTINUE_COIN_COST} Coins — or Retry, Zen Mode, or Skip for FREE!`);
    return;
  }
  app.saveManager.spendBooster('FREEZE');
  app.board.continuesUsed = (app.board.continuesUsed ?? 0) + 1; // STARS-SLACK-01: caps this clear at 1★
  const playMode = save.settings.playMode;
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
  app.sound.playBooster('FREEZE');
  app.syncInGameHud();
  app.renderNow();
}

function isAppHistoryState(val: unknown): val is AppHistoryState {
  if (!val || typeof val !== 'object') return false;
  const candidate = val as Partial<AppHistoryState>;
  return (
    candidate.__shredblocksNav === true &&
    (candidate.view === 'title' ||
      candidate.view === 'home' ||
      candidate.view === 'game' ||
      candidate.view === 'themes')
  );
}

export function handlePopstateNavigationImpl(app: AppViewContext, event: PopStateEvent): void {
  const st = event.state;
  if (!isAppHistoryState(st)) {
    return;
  }

  app.isApplyingPopstate = true;
  try {
    app.inputController.cancelTargeting();
    app.closeAllModals();

    if (st.view === 'title') {
      app.openTitleScreen();
      return;
    }

    if (st.view === 'game') {
      const save = app.saveManager.getPayload();
      const maxAllowed = Math.max(1, save.highestLevelUnlocked || 1);
      const targetId = Math.min(maxAllowed, Math.max(1, Math.floor(st.levelId || save.currentLevelId || 1)));
      if (app.board.levelId !== targetId) {
        app.loadLevel(targetId, true, true);
      } else {
        app.switchScreen('game');
      }
      return;
    }

    app.switchScreen(st.view);
  } finally {
    app.isApplyingPopstate = false;
  }
}

export function openTitleScreenImpl(app: AppViewContext): void {
  app.titleOverlayOpen = true;
  app.blueprintMix = 1.0;
  if (app.toastTimerId !== null) {
    clearTimeout(app.toastTimerId);
    app.toastTimerId = null;
  }
  const gameToast = document.getElementById('game-toast');
  if (gameToast) gameToast.hidden = true;
  const save = app.saveManager.getPayload();
  const targetLevelId = Math.max(1, save.currentLevelId || save.highestLevelUnlocked || 1);
  if (app.board.levelId !== targetLevelId) {
    app.loadLevel(targetLevelId, false, false);
  }
  app.syncAllUiFromSave();
  app.syncTitleOverlayDom();
  app.syncPwaUpdateBanner();
  app.checkForPwaUpdate(false);
  app.renderer.resize();
  app.renderNow();

  if (typeof history !== 'undefined') {
    const titleState: AppHistoryState = { __shredblocksNav: true, view: 'title' };
    const curHist = isAppHistoryState(history.state) ? history.state : null;
    if (!app.historyInitialized) {
      app.historyInitialized = true;
      history.replaceState(titleState, '');
    } else if (!app.isApplyingPopstate) {
      if (curHist?.view === 'title') {
        history.replaceState(titleState, '');
      } else {
        history.pushState(titleState, '');
      }
    }
  }
}

export function dismissTitleScreenImpl(
  app: AppViewContext,
  targetScreen: 'game' | 'home' | 'themes' = 'game',
  animateAwakening = true
): void {
  const wasTitleOpen = app.titleOverlayOpen;
  const awaken =
    wasTitleOpen &&
    targetScreen === 'game' &&
    animateAwakening &&
    !app.saveManager.getPayload().settings.reducedMotion;
  if (!awaken) {
    app.blueprintMix = 0;
  }
  app.switchScreen(targetScreen);
  if (awaken) {
    // Relic Awakening Transformation (RELIC-AWAKEN-01): stone shatters into smoke, shards & glow
    app.blueprintMix = Math.min(app.blueprintMix, 0.995);
    app.renderer.spawnRelicAwakeningBurst(app.board);
    document.getElementById('screen-game')?.classList.add('relic-awakening-burst');
    app.sound.playRelicAwaken();
  }
  if (targetScreen === 'game' && app.board.movesCommitted === 0) {
    const spec = getLevelSpec(app.board.levelId);
    app.showUnlockNoteIfPresent(spec.unlockNote ?? BOOSTER_DEBUT_NOTES[app.board.levelId]);
    app.lastPointerActivityMs = performance.now();
  }
}

export function switchScreenImpl(app: AppViewContext, screen: 'home' | 'game' | 'themes'): void {
  const wasTitleOpen = app.titleOverlayOpen;
  app.activeScreen = screen;
  app.titleOverlayOpen = false;
  // Any screen switch (direct loadLevel, Map, Themes) cancels a running relic-awakening halo;
  // dismissTitleScreenImpl re-adds it right after when launching gameplay from the Title Screen.
  document.getElementById('screen-game')?.classList.remove('relic-awakening-burst');
  if (screen !== 'game') {
    app.blueprintMix = 0;
  }
  app.syncTitleOverlayDom();
  app.syncPwaUpdateBanner();

  document.getElementById('tab-btn-home')?.classList.toggle('active', screen === 'home');
  document.getElementById('tab-btn-themes')?.classList.toggle('active', screen === 'themes');

  if (screen === 'home') {
    app.activeRoadmapRange = 'all';
    document.querySelectorAll<HTMLElement>('.chip-filter[data-range]').forEach((c) => {
      c.classList.toggle('active', c.dataset.range === 'all');
    });
    app.renderRoadmap();
    app.checkForPwaUpdate(false);
  } else if (screen === 'themes') {
    app.renderThemesStudio();
  } else if (screen === 'game') {
    app.renderer.resize();
    app.syncInGameHud();
    app.renderNow();
  }

  if (typeof history !== 'undefined' && !app.isApplyingPopstate) {
    const nextState: AppHistoryState =
      screen === 'game'
        ? { __shredblocksNav: true, view: 'game', levelId: app.board.levelId }
        : { __shredblocksNav: true, view: screen };
    const curHist = isAppHistoryState(history.state) ? history.state : null;

    if (!app.historyInitialized) {
      app.historyInitialized = true;
      history.replaceState(nextState, '');
    } else if (wasTitleOpen && screen === 'game') {
      // Seed Sanctuary Map ('home') beneath Gameplay when launching directly from Title Screen
      // so Browser Back from a level always returns to the Map screen first.
      if (curHist?.view !== 'home') {
        history.pushState({ __shredblocksNav: true, view: 'home' } satisfies AppHistoryState, '');
      }
      history.pushState(nextState, '');
    } else if (curHist?.view === screen) {
      history.replaceState(nextState, '');
    } else {
      history.pushState(nextState, '');
    }
  }
}

export function showGameToastImpl(app: AppViewContext, message: string, durationMs = 2600): void {
  const toast = document.getElementById('game-toast');
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
  const banner = document.getElementById('unlock-toast');
  const textEl = document.getElementById('unlock-toast-text');
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

export function autoSolveCurrentLevelImpl(app: AppViewContext): boolean {
  app.closeAllModals();
  app.levelOutcomeHandled = false;

  const solved = solveBoard(app.board, 6000);
  if (solved.solvable && solved.solutionPath.length > 0) {
    for (const step of solved.solutionPath) {
      app.commitMove(step.blockId, step.targetRow, step.targetCol);
      if (isBoardWon(app.board)) {
        return true;
      }
    }
  }

  // Deterministic fallback for complex states if node budget was reached
  if (!isBoardWon(app.board)) {
    app.pushUndoSnapshot(app.board);
    for (const b of app.board.blocks) {
      if (b.status !== 'ACTIVE') continue;
      const c = getActiveColor(b.colorStack, b.colorCursor);
      if (c !== 0) {
        b.status = 'CLEARED';
        b.shredProgress = 1;
        app.board.sessionBlocksShredded += Math.max(1, b.colorStack.length - b.colorCursor);
      }
    }
    for (const gen of app.board.generators) {
      gen.state = 'DEPLETED';
      gen.queueCursor = gen.queue.length;
    }
    if (app.board.movesCommitted === 0) {
      app.board.movesCommitted = app.board.parMoves;
    }
    app.checkWinOrLossAfterAction();
  }

  return isBoardWon(app.board);
}
