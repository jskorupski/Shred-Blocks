import type { SavePayloadV1 } from '../core/types';
import { createDefaultSavePayload, PRE_IMPORT_BACKUP_KEY } from '../storage/save-manager';
import { type AppViewContext, PARTICLE_CATALOG, SKIN_CATALOG, TRAY_CATALOG } from './catalog-meta';

const LAN_DEBUG_BACKUP_KEY = 'shredblocks.lan_debug_backup.v1';

function importSavePreservingUserBackup(app: AppViewContext, payload: SavePayloadV1): void {
  let prevImportBackup: string | null = null;
  try {
    prevImportBackup = localStorage.getItem(PRE_IMPORT_BACKUP_KEY);
  } catch {
    prevImportBackup = null;
  }

  app.saveManager.importSaveJson(JSON.stringify(payload));

  try {
    if (prevImportBackup === null) {
      localStorage.removeItem(PRE_IMPORT_BACKUP_KEY);
    } else {
      localStorage.setItem(PRE_IMPORT_BACKUP_KEY, prevImportBackup);
    }
  } catch {
    // Ignore storage quota / private-mode restrictions
  }
}

function refreshAllViewsAfterLanSaveChange(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  const targetLevel = Math.max(1, save.currentLevelId || 1);
  if (app.board.levelId !== targetLevel && app.activeScreen !== 'game') {
    app.loadLevel(targetLevel, false, false);
  }
  app.syncAllUiFromSave();
  app.syncTitleOverlayDom();
  app.renderRoadmap();
  app.renderThemesStudio();
  app.syncInGameHud();
  app.renderNow();
}

export function applyLanUnlockAll(app: AppViewContext): void {
  const cur = app.saveManager.getPayload();
  try {
    if (!localStorage.getItem(LAN_DEBUG_BACKUP_KEY)) {
      localStorage.setItem(LAN_DEBUG_BACKUP_KEY, JSON.stringify(cur));
    }
  } catch {
    // Ignore storage restrictions
  }

  const next: SavePayloadV1 = {
    ...cur,
    writeSeq: cur.writeSeq + 1,
    updatedAt: Date.now(),
    highestLevelUnlocked: Math.max(cur.highestLevelUnlocked, 305),
    modeLadderVersion: 1,
    modeState: {
      CHALLENGE: {
        currentLevelId: cur.modeState.CHALLENGE.currentLevelId,
        highestUnlocked: Math.max(cur.modeState.CHALLENGE.highestUnlocked, 305),
      },
      ZEN: {
        currentLevelId: cur.modeState.ZEN.currentLevelId,
        highestUnlocked: Math.max(cur.modeState.ZEN.highestUnlocked, 305),
      },
      TIMED: {
        currentLevelId: cur.modeState.TIMED.currentLevelId,
        highestUnlocked: Math.max(cur.modeState.TIMED.highestUnlocked, 305),
      },
    },
    zenBlessings: 3,
    coins: Math.max(cur.coins, 9999),
    boosters: {
      UNDO: Math.max(cur.boosters.UNDO, 25),
      HINT: Math.max(cur.boosters.HINT, 25),
      HAMMER: Math.max(cur.boosters.HAMMER, 25),
      ROCKET: Math.max(cur.boosters.ROCKET, 25),
      VACUUM: Math.max(cur.boosters.VACUUM, 25),
    },
    unlockedSkins: SKIN_CATALOG.map((item) => item.id),
    unlockedTrays: TRAY_CATALOG.map((item) => item.id),
    unlockedParticles: PARTICLE_CATALOG.map((item) => item.id),
  };

  importSavePreservingUserBackup(app, next);
  refreshAllViewsAfterLanSaveChange(app);
  syncRestoreButtonLabels();
  app.sound.playBooster('HINT');
  app.showGameToast(
    '🛠 LAN DevTools: Unlocked all 15 cosmetics, 9,999 Coins, 25× Boosters, 3 Zen Blessings & Lvl 1–305 across all modes!',
    3200
  );
}

function restoreOrResetLanSave(app: AppViewContext): void {
  let rawBackup: string | null = null;
  try {
    rawBackup = localStorage.getItem(LAN_DEBUG_BACKUP_KEY);
  } catch {
    rawBackup = null;
  }

  if (rawBackup) {
    try {
      const parsed = JSON.parse(rawBackup) as SavePayloadV1;
      parsed.writeSeq = Math.max(parsed.writeSeq ?? 1, app.saveManager.getPayload().writeSeq + 1);
      parsed.updatedAt = Date.now();
      importSavePreservingUserBackup(app, parsed);
      localStorage.removeItem(LAN_DEBUG_BACKUP_KEY);
      app.loadLevel(Math.max(1, parsed.currentLevelId || 1), false, false);
      refreshAllViewsAfterLanSaveChange(app);
      syncRestoreButtonLabels();
      app.showGameToast('↩ LAN DevTools: Restored your pre-unlock save!', 2800);
      return;
    } catch {
      // Fall through to fresh reset if backup JSON was malformed
    }
  }

  const cur = app.saveManager.getPayload();
  try {
    localStorage.setItem(LAN_DEBUG_BACKUP_KEY, JSON.stringify(cur));
  } catch {
    // Ignore storage restrictions
  }
  const fresh = createDefaultSavePayload();
  fresh.writeSeq = cur.writeSeq + 1;
  fresh.settings = { ...cur.settings };
  importSavePreservingUserBackup(app, fresh);
  app.loadLevel(1, false, false);
  refreshAllViewsAfterLanSaveChange(app);
  syncRestoreButtonLabels();
  app.showGameToast('↺ LAN DevTools: Reset to fresh Level 1 save (tap again to restore)!', 3000);
}

function hasLanBackup(): boolean {
  try {
    return Boolean(localStorage.getItem(LAN_DEBUG_BACKUP_KEY));
  } catch {
    return false;
  }
}

function syncRestoreButtonLabels(): void {
  const btn = document.getElementById('btn-lan-restore-save');
  if (!btn) return;
  btn.textContent = hasLanBackup() ? '↩ Restore Pre-Unlock Save' : '↺ LAN Fresh Lvl 1 Save';
}

function createUnlockButton(id: string, label: string, app: AppViewContext): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'btn-tactile btn-secondary btn-compact';
  btn.textContent = label;
  btn.title = 'LAN-only debug helper: unlock all cosmetics, coins, power-ups, and levels';
  btn.addEventListener('click', () => applyLanUnlockAll(app));
  return btn;
}

/**
 * Mounts LAN-only debug unlock/restore controls exclusively inside `#pause-diagnostics-footer`
 * (`#dialog-pause` Settings) when compiled with `__SHREDBLOCKS_LAN_DEVTOOLS__ === true`
 * (`vite.lan.config.ts`), keeping `.top-economy-bar` headers strictly single-line.
 * Dead-code-stripped (`0` bytes) from production `vite.config.ts` builds.
 */
export function mountLanDevTools(app: AppViewContext): void {
  const diagnosticsFooter =
    document.getElementById('pause-diagnostics-footer') ??
    document.querySelector('#dialog-pause .pause-dialog-card');
  if (diagnosticsFooter && !document.getElementById('btn-lan-unlock-pause')) {
    const devDetails = document.createElement('details');
    devDetails.id = 'pause-lan-devtools';
    devDetails.className = 'telemetry-details lan-devtools-details';

    const summary = document.createElement('summary');
    summary.textContent = 'Developer Tools (LAN Only)';

    const grid = document.createElement('div');
    grid.className = 'dialog-actions-grid pause-dev-grid';

    const unlockBtn = createUnlockButton('btn-lan-unlock-pause', '🛠 LAN Unlock All', app);

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.id = 'btn-lan-restore-save';
    restoreBtn.className = 'btn-tactile btn-secondary btn-compact';
    restoreBtn.addEventListener('click', () => restoreOrResetLanSave(app));

    grid.append(unlockBtn, restoreBtn);
    devDetails.append(summary, grid);
    diagnosticsFooter.appendChild(devDetails);
    syncRestoreButtonLabels();
  }
}
