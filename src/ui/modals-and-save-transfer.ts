import { isBoardRunStarted, isBoardWon } from '../core/board';
import { setFxRandomSeed } from '../core/fx-random';
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
import { scheduleRelicPlatePrewarm } from '../render/voronoi-plates';
import { generateQrSvg } from '../storage/qr-svg';
import { decodeSaveCode, validateSavePayloadV1 } from '../storage/save-code';
import { extractImportCodeFromHash, migrateLegacyEconomy } from '../storage/save-manager';
import {
  type AppHistoryState,
  type AppViewContext,
  clearTransientBannersImpl,
  type ModalId,
  presentStageUnlockBannerImpl,
  type ShredBlocksDebugBridge,
  showGameToastImpl,
  showUnlockNoteIfPresentImpl,
} from './catalog-meta';
import {
  cancelPendingOutcomeTransition,
  cancelStuckBoardCheckImpl,
  continueFailedLevelImpl,
  isOutcomeTransitionPending,
  useZenBlessingContinueImpl,
} from './outcome-modals-view';
import { notifyThemesScreenActiveState, syncPauseCosmeticsDrawerImpl } from './themes-studio-view';
import { stopVictoryModalFx } from './victory-modal-fx';

export {
  continueFailedLevelImpl,
  showGameToastImpl,
  showUnlockNoteIfPresentImpl,
  useZenBlessingContinueImpl,
};

export function getModalElement(id: ModalId): HTMLDialogElement | null {
  return document.getElementById(`dialog-${id}`) as HTMLDialogElement | null;
}

export function isAnyModalOpenImpl(): boolean {
  const ids: ModalId[] = ['victory', 'failure', 'pause', 'save-transfer', 'install'];
  return ids.some((id) => getModalElement(id)?.open);
}

export function openModalImpl(app: AppViewContext, id: ModalId): void {
  if (
    id === 'pause' &&
    isOutcomeTransitionPending() &&
    app.activeScreen === 'game' &&
    !app.titleOverlayOpen
  ) {
    return;
  }
  app.inputController.cancelTargeting();
  app.closeAllModals();
  const dialog = getModalElement(id);
  if (!dialog) return;

  if (id === 'pause') {
    const navSec = dialog.querySelector<HTMLElement>('.pause-nav-section');
    if (navSec) {
      navSec.hidden = app.activeScreen !== 'game' || app.titleOverlayOpen;
    }
    app.syncInstallUiVisibility();
    syncPauseCosmeticsDrawerImpl(app, true);
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

export function closeAllModalsImpl(): boolean {
  cancelPendingOutcomeTransition();
  let closedOutcomeModal = false;
  const ids: ModalId[] = ['victory', 'failure', 'pause', 'save-transfer', 'install'];
  for (const id of ids) {
    const dlg = getModalElement(id);
    if (dlg?.open) {
      if (id === 'victory' || id === 'failure') {
        closedOutcomeModal = true;
      }
      dlg.close();
      dlg.returnValue = '';
    }
  }
  return closedOutcomeModal;
}

export function setupDialogLightDismissImpl(): void {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog.game-dialog');
  dialogs.forEach((dialog) => {
    const isTerminalOutcomeModal = dialog.id === 'dialog-victory' || dialog.id === 'dialog-failure';

    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
      if (dialog.id === 'dialog-victory') {
        stopVictoryModalFx();
      }
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
  const text = `FPS: ${t.fps} (${t.displayHz}Hz) | Work: ${t.avgWorkMs}ms (p95: ${t.p95WorkMs}ms) | Tier: ${t.activeTier} | Backend: ${t.rendererBackend}`;
  if (el.textContent !== text) el.textContent = text;
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
      incoming = migrateLegacyEconomy(validateSavePayloadV1(JSON.parse(trimmed)));
    } else {
      incoming = migrateLegacyEconomy(decodeSaveCode(trimmed));
    }

    app.pendingImportPayload = incoming;
    app.pendingImportRawCode = trimmed;

    const current = app.saveManager.getPayload();
    const renderSummaryItems = (targetUl: HTMLElement | null, p: SavePayloadV1) => {
      if (!targetUl) return;
      const dateStr = new Date(p.updatedAt || Date.now()).toLocaleString();
      const nonZenMax = Math.max(p.modeState.CHALLENGE.highestUnlocked, p.modeState.TIMED.highestUnlocked);
      const zenMax = p.modeState.ZEN.highestUnlocked;
      const maxLine =
        zenMax > nonZenMax
          ? `Max Level: Level ${nonZenMax} (Zen: Level ${zenMax})`
          : `Max Level: Level ${p.highestLevelUnlocked}`;
      const items = [
        maxLine,
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
    app.activeRoadmapRange = 'all';
    app.expandedEndlessRanges = [];
    const ladder = updated.modeState[updated.settings.playMode];
    const frontierId = Math.max(1, Math.min(ladder.highestUnlocked, ladder.currentLevelId || 1));
    app.loadLevel(frontierId, false, false);
    app.renderRoadmap();
    app.renderThemesStudio();
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
  const prevSave = app.saveManager.getPayload();
  const prevMode = prevSave.settings.playMode;
  const fromOutcomeModal = Boolean(
    getModalElement('failure')?.open || getModalElement('victory')?.open || isOutcomeTransitionPending()
  );

  if (prevMode === nextMode && !fromOutcomeModal && app.boardPlayMode === nextMode) {
    if (app.activeScreen === 'home' && !app.titleOverlayOpen) {
      app.activeRoadmapRange = 'all';
      app.expandedEndlessRanges = [];
      app.renderRoadmap();
    }
    return;
  }

  const wasRunStarted = isBoardRunStarted(app.board);
  // STREAK-INTEGRITY-01: Switching modes mid-run in Challenge / Speed Rush forfeits Flow Streak
  if (
    app.activeScreen === 'game' &&
    !app.titleOverlayOpen &&
    !fromOutcomeModal &&
    !app.levelOutcomeHandled &&
    prevMode !== 'ZEN' &&
    wasRunStarted &&
    (prevSave.winStreak || 0) > 0
  ) {
    app.saveManager.recordLevelLoss();
  }

  app.inputController.cancelTargeting();
  app.activeRoadmapRange = 'all';
  app.expandedEndlessRanges = [];
  app.saveManager.updateSettings({ playMode: nextMode });

  const nextSave = app.saveManager.getPayload();
  const nextLadder = nextSave.modeState[nextMode];
  const frontierId = Math.max(1, Math.min(nextLadder.highestUnlocked, nextLadder.currentLevelId || 1));

  // 1. Off-screen (Map / Themes / Title): unconditionally reload target mode's frontier at Move 0 (`MODE-ISOLATION-01`)
  if (app.activeScreen !== 'game' || app.titleOverlayOpen) {
    app.loadLevel(frontierId, false, false);
    app.syncAllUiFromSave();
    app.renderRoadmap();
    app.renderNow();
    return;
  }

  // 2. In-game HUD or Outcome Modal (`MODE-ISOLATION-01`): ALWAYS load a clean Move-0 board for `nextMode`
  const useFrontier =
    fromOutcomeModal ||
    app.board.levelId > nextLadder.highestUnlocked ||
    (!wasRunStarted && nextLadder.currentLevelId > app.board.levelId);
  const targetId = useFrontier ? frontierId : app.board.levelId;
  const persistBookmark = useFrontier || app.board.levelId >= nextLadder.currentLevelId;

  app.closeAllModals();
  app.loadLevel(targetId, true, persistBookmark);
  app.renderRoadmap();

  if (!silent) {
    if (useFrontier) {
      app.showGameToast(
        nextMode === 'ZEN'
          ? `🌿 Zen Mode · Level ${targetId} — clear stages to earn ★ & Zen Blessings!`
          : nextMode === 'CHALLENGE'
            ? `⚔️ Challenge Mode · Level ${targetId}`
            : `⏱️ Speed Rush · Level ${targetId}`
      );
    } else if (wasRunStarted) {
      app.showGameToast(
        nextMode === 'ZEN'
          ? `🌿 Zen Mode — Level ${targetId} restarted with inert bombs!`
          : nextMode === 'CHALLENGE'
            ? `⚔️ Challenge Mode — Level ${targetId} restarted for Gold Stars!`
            : `⏱️ Speed Rush — Level ${targetId} restarted for Gold Stars!`
      );
    } else {
      app.showGameToast(
        nextMode === 'ZEN'
          ? '🌿 Switched to Zen Mode (Untimed · Inert Bombs)'
          : nextMode === 'CHALLENGE'
            ? '⚔️ Switched to Challenge Mode (Move Budget)'
            : '⏱️ Switched to Speed Rush (Timed)'
      );
    }
  }
}

export function createDebugBridgeImpl(app: AppViewContext): ShredBlocksDebugBridge {
  return {
    getBoard: () => app.board,
    getSave: () => app.saveManager.getPayload(),
    patchSave: (patch: Partial<SavePayloadV1>) => {
      const cur = app.saveManager.getPayload();
      const merged: Partial<SavePayloadV1> = { ...cur, ...patch };
      if (
        !patch.modeState &&
        (patch.highestLevelUnlocked !== undefined || patch.currentLevelId !== undefined)
      ) {
        const activeMode = merged.settings?.playMode ?? cur.settings.playMode;
        const nextHighest = Math.max(
          1,
          patch.highestLevelUnlocked ?? cur.modeState[activeMode].highestUnlocked
        );
        const nextCurrent = Math.min(
          nextHighest,
          Math.max(1, patch.currentLevelId ?? cur.modeState[activeMode].currentLevelId)
        );
        merged.modeState = {
          ...cur.modeState,
          [activeMode]: { highestUnlocked: nextHighest, currentLevelId: nextCurrent },
        };
      }
      const next = validateSavePayloadV1(merged);
      if (next) {
        app.activeRoadmapRange = 'all';
        app.expandedEndlessRanges = [];
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
      app.syncAllUiFromSave();
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
    syncHud: () => app.syncInGameHud(),
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
    freezeTime: (timeSec: number | null) => app.freezeTime(timeSec),
    advanceFrozenFrames: (frames: number, dtSec = 1 / 60) => app.advanceFrozenFrames(frames, dtSec),
    getHoverState: () => app.inputController.getHoverState(),
    getActivePathTraceCount: () => app.renderer.activePathTraces.length,
    getParticleTelemetry: () => {
      const n = app.renderer.activeParticleCount;
      let sumZ = 0;
      for (let i = 0; i < n; i++) {
        sumZ += app.renderer.particleInstanceData[i * 8 + 2];
      }
      return {
        activeParticles: n,
        activeGateBursts: app.renderer.activeGateBursts.length,
        gateBurstModes: app.renderer.activeGateBursts.map((g) => `${g.mode}:${g.style}`),
        meanParticleZ: n > 0 ? sumZ / n : 0,
      };
    },
    setFxRandomSeed: (seed: number | null) => setFxRandomSeed(seed),
    boardToScreen: (boardX: number, boardY: number) =>
      app.renderer.boardToScreen(boardX, boardY, 0.58, app.board.rows, app.board.cols),
  };
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
      const ladder = save.modeState[save.settings.playMode];
      const maxAllowed = Math.max(1, ladder.highestUnlocked || 1);
      const targetId = Math.min(
        maxAllowed,
        Math.max(1, Math.floor(st.levelId || ladder.currentLevelId || 1))
      );
      app.resumeOrLoadLevel(targetId, true, true);
      return;
    }

    app.switchScreen(st.view);
  } finally {
    app.isApplyingPopstate = false;
  }
}

export function openTitleScreenImpl(app: AppViewContext): void {
  cancelPendingOutcomeTransition();
  cancelStuckBoardCheckImpl();
  app.sound?.stopOutcomeCue?.();
  app.inputController.cancelTargeting();
  app.themesEnteredFromGame = false;
  notifyThemesScreenActiveState(app, false);
  app.titleOverlayOpen = true;
  app.blueprintMix = 1.0;
  clearTransientBannersImpl(app);
  const save = app.saveManager.getPayload();
  const ladder = save.modeState[save.settings.playMode];
  const targetLevelId = Math.max(
    1,
    Math.min(ladder.highestUnlocked, ladder.currentLevelId || ladder.highestUnlocked || 1)
  );
  if (
    app.board.levelId !== targetLevelId ||
    app.boardPlayMode !== save.settings.playMode ||
    isBoardRunStarted(app.board) ||
    app.levelOutcomeHandled
  ) {
    app.loadLevel(targetLevelId, false, false);
  }
  app.syncAllUiFromSave();
  app.syncTitleOverlayDom();
  app.syncPwaUpdateBanner();
  app.checkForPwaUpdate(false);
  app.renderer.resetTransientFx();
  app.renderer.resize();
  app.renderNow();
  if (!save.settings.reducedMotion) {
    scheduleRelicPlatePrewarm(
      () => app.board,
      () => app.titleOverlayOpen && !app.saveManager.getPayload().settings.reducedMotion
    );
  }

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
  } else {
    // Relic Awakening Transformation (RELIC-AWAKEN-01 / PERF-TRANSITION-01):
    // Prepare burst state before screen switch so we never execute a wasted pre-burst WebGL render
    // or double layout reflow on the click frame.
    app.blueprintMix = Math.min(app.blueprintMix, 0.995);
    app.renderer.spawnRelicAwakeningBurst(app.board);
  }
  switchScreenImpl(app, targetScreen, awaken);
  if (awaken) {
    app.sound.playRelicAwaken();
  }
  if (targetScreen === 'game') {
    app.lastPointerActivityMs = performance.now();
    if (app.board.movesCommitted === 0 && !app.boardUnlockNoteShown) {
      presentStageUnlockBannerImpl(app, app.board.levelId, getLevelSpec(app.board.levelId).unlockNote);
    }
  }
}

export function switchScreenImpl(
  app: AppViewContext,
  screen: 'home' | 'game' | 'themes',
  preserveAwakeningBurst = false
): void {
  const wasTitleOpen = app.titleOverlayOpen;
  const prevScreen = app.activeScreen;
  app.activeScreen = screen;
  app.titleOverlayOpen = false;
  const gameEl = document.getElementById('screen-game');
  if (preserveAwakeningBurst) {
    gameEl?.classList.add('relic-awakening-burst');
  } else {
    gameEl?.classList.remove('relic-awakening-burst');
  }
  if (screen !== 'game') {
    cancelPendingOutcomeTransition();
    cancelStuckBoardCheckImpl();
    app.sound?.stopOutcomeCue?.();
    app.inputController.cancelTargeting();
    clearTransientBannersImpl(app);
    app.blueprintMix = 0;
    app.renderer.resetTransientFx();
  } else if (prevScreen !== 'game' || wasTitleOpen) {
    clearTransientBannersImpl(app);
  }
  app.syncTitleOverlayDom();
  app.syncPwaUpdateBanner();

  document.getElementById('tab-btn-home')?.classList.toggle('active', screen === 'home');
  document.getElementById('tab-btn-themes')?.classList.toggle('active', screen === 'themes');

  if (screen !== 'themes') {
    app.themesEnteredFromGame = false;
  }
  notifyThemesScreenActiveState(app, screen === 'themes');

  if (screen === 'home') {
    app.activeRoadmapRange = 'all';
    app.expandedEndlessRanges = [];
    app.syncAllUiFromSave();
    app.renderRoadmap();
    app.checkForPwaUpdate(false);
  } else if (screen === 'themes') {
    app.renderThemesStudio();
    app.checkForPwaUpdate(false);
  } else if (screen === 'game') {
    if (!preserveAwakeningBurst || app.renderer.canvas.width <= 64) {
      app.renderer.resize();
    }
    app.syncInGameHud();
    if (!preserveAwakeningBurst) {
      app.renderNow();
    }
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
