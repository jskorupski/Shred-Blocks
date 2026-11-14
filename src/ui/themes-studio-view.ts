import { createBoardState, isBoardRunStarted, isBoardWon } from '../core/board';
import type { BoardState, LevelSpec, ParticleStyleId, SkinId, TrayId } from '../core/types';
import { hasActiveVisualFxImpl } from '../render/particle-fx';
import { Renderer3D } from '../render/renderer-3d';
import {
  type AppViewContext,
  getThemeItemPrice,
  PARTICLE_CATALOG,
  PARTICLE_GLYPHS,
  SKIN_CATALOG,
  TRAY_CATALOG,
} from './catalog-meta';

export {
  bindThemesAndCosmeticsEventsImpl,
  canResumeBoardImpl,
  resumeOrLoadLevelImpl,
  syncPauseCosmeticsDrawerImpl,
} from './pause-cosmetics-drawer';

interface ThemePreviewSelection {
  skin: SkinId;
  tray: TrayId;
  particle: ParticleStyleId;
}

const PREVIEW_SHOWCASE_SPEC: LevelSpec = {
  id: 999_990,
  name: 'Sanctuary Cosmetics Showcase',
  difficulty: 'NORMAL',
  rows: 4,
  cols: 6,
  parMoves: 4,
  moveLimit: 12,
  timeLimitSec: 90,
  gates: [
    { edge: 'RIGHT', spanStart: 1, spanLength: 2, colorQueue: [1] },
    { edge: 'TOP', spanStart: 2, spanLength: 2, colorQueue: [2] },
    { edge: 'LEFT', spanStart: 2, spanLength: 2, colorQueue: [3] },
    { edge: 'BOTTOM', spanStart: 3, spanLength: 2, colorQueue: [4] },
  ],
  blocks: [
    { id: 1, shapeId: '2x1', row: 1, col: 4, colorStack: [1] },
    { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [2] },
    { id: 3, shapeId: 'L3_BL', row: 2, col: 1, colorStack: [3] },
    { id: 4, shapeId: '1x1', row: 2, col: 3, colorStack: [4] },
  ],
};

const PREVIEW_SHRED_STEPS: ReadonlyArray<{
  blockId: number;
  gateIdx: number;
  targetRow: number;
  targetCol: number;
  traceWaypoints: ReadonlyArray<{ x: number; y: number }>;
  spanCols: number;
  spanRows: number;
  cellMask: number;
  colorId: 1 | 2 | 3 | 4;
}> = [
  {
    blockId: 1,
    gateIdx: 0,
    targetRow: 1,
    targetCol: 5,
    traceWaypoints: [
      { x: 4, y: 1 },
      { x: 5.32, y: 1 },
    ],
    spanCols: 1,
    spanRows: 2,
    cellMask: 17, // (1 << 0) | (1 << 4) for 2x1 vertical bar
    colorId: 1,
  },
  {
    blockId: 2,
    gateIdx: 1,
    targetRow: 0,
    targetCol: 2,
    traceWaypoints: [
      { x: 2, y: 1 },
      { x: 2, y: -0.32 },
    ],
    spanCols: 2,
    spanRows: 1,
    cellMask: 3, // (1 << 0) | (1 << 1) for 1x2 horizontal bar
    colorId: 2,
  },
  {
    blockId: 3,
    gateIdx: 2,
    targetRow: 2,
    targetCol: 0,
    traceWaypoints: [
      { x: 1, y: 2 },
      { x: -0.32, y: 2 },
    ],
    spanCols: 2,
    spanRows: 2,
    cellMask: 49, // (1 << 0) | (1 << 4) | (1 << 5) for L3_BL
    colorId: 3,
  },
  {
    blockId: 4,
    gateIdx: 3,
    targetRow: 3,
    targetCol: 3,
    traceWaypoints: [
      { x: 3, y: 2 },
      { x: 3, y: 3.35 },
    ],
    spanCols: 1,
    spanRows: 1,
    cellMask: 1,
    colorId: 4,
  },
];

let previewOverride: Partial<ThemePreviewSelection> | null = null;
let previewRenderer: Renderer3D | null = null;
let previewBoard: BoardState | null = null;
let previewRafId = 0;
let previewLastMs = 0;
let previewSettleFrames = 0;
let previewResetTimerId: ReturnType<typeof setTimeout> | null = null;

function getEffectivePreviewSelection(app: AppViewContext): ThemePreviewSelection {
  const save = app.saveManager.getPayload();
  return {
    skin: previewOverride?.skin ?? save.equippedSkin,
    tray: previewOverride?.tray ?? save.equippedTray,
    particle: previewOverride?.particle ?? save.equippedParticle,
  };
}

function isPreviewMatchingEquipped(app: AppViewContext, sel: ThemePreviewSelection): boolean {
  const save = app.saveManager.getPayload();
  return (
    sel.skin === save.equippedSkin && sel.tray === save.equippedTray && sel.particle === save.equippedParticle
  );
}

function resetPreviewShowcaseBoard(bounce = false): BoardState {
  const fresh = createBoardState(PREVIEW_SHOWCASE_SPEC);
  previewBoard = fresh;
  if (bounce && previewRenderer && !previewRenderer.lastOptions.reducedMotion) {
    for (const b of fresh.blocks) {
      previewRenderer.blockBounceMap.set(b.id, 0.28);
    }
  }
  return fresh;
}

function renderSinglePreviewFrame(app: AppViewContext, dtSec: number, timeSec?: number): void {
  if (!previewRenderer) return;
  const board = previewBoard ?? resetPreviewShowcaseBoard(false);
  const save = app.saveManager.getPayload();
  const sel = getEffectivePreviewSelection(app);
  previewRenderer.render(board, {
    equippedSkin: sel.skin,
    equippedTray: sel.tray,
    equippedParticle: sel.particle,
    colorblindSymbols: save.settings.colorblindSymbols,
    highContrast: save.settings.highContrast,
    reducedMotion: save.settings.reducedMotion,
    qualityTier: save.settings.qualityTier,
    blueprintMix: 0,
    dtSec,
    timeSec,
  });
}

function ensurePreviewAnimationLoop(app: AppViewContext): void {
  if (previewRafId !== 0 || typeof requestAnimationFrame === 'undefined') return;
  previewLastMs = performance.now();
  const step = (nowMs: number) => {
    previewRafId = 0;
    if (app.activeScreen !== 'themes' || app.titleOverlayOpen || !previewRenderer || !previewBoard) {
      return;
    }
    const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - previewLastMs) / 1000));
    previewLastMs = nowMs;
    renderSinglePreviewFrame(app, dtSec, nowMs * 0.001);

    const hasFx = hasActiveVisualFxImpl(previewRenderer, 0) || previewRenderer.blockBounceMap.size > 0;
    if (isBoardWon(previewBoard) && !hasFx && previewResetTimerId === null) {
      resetPreviewShowcaseBoard(true);
      previewSettleFrames = Math.max(previewSettleFrames, 20);
      renderSinglePreviewFrame(app, 1 / 60, nowMs * 0.001);
    }
    if (previewSettleFrames > 0) previewSettleFrames--;
    if (hasFx || previewSettleFrames > 0) {
      previewRafId = requestAnimationFrame(step);
    }
  };
  previewRafId = requestAnimationFrame(step);
}

function requestPreviewFrames(app: AppViewContext, minFrames = 3): void {
  if (app.activeScreen !== 'themes' || app.titleOverlayOpen) return;
  const canvas = document.getElementById('themes-preview-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (!previewRenderer) previewRenderer = new Renderer3D(canvas);
  if (!previewBoard) resetPreviewShowcaseBoard(false);
  previewSettleFrames = Math.max(previewSettleFrames, minFrames);
  renderSinglePreviewFrame(app, 1 / 60);
  ensurePreviewAnimationLoop(app);
}

/**
 * Re-renders `#themes-preview-canvas` immediately when `#screen-themes` is active so live A11y toggles
 * (`colorblindSymbols`, `highContrast`, `reducedMotion`), quality changes, or save syncs stay 100% in sync.
 */
export function refreshThemesPreviewIfActive(app: AppViewContext): void {
  if (app.activeScreen === 'themes' && !app.titleOverlayOpen) {
    requestPreviewFrames(app, 3);
  }
}

/**
 * Suspends or activates the Live 3D Showcase Diorama loop when entering/leaving `#screen-themes`,
 * resetting any unowned `previewOverride` on exit so locked previews never leak into gameplay.
 */
export function notifyThemesScreenActiveState(app: AppViewContext, active: boolean): void {
  if (!active) {
    if (previewRafId !== 0 && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(previewRafId);
      previewRafId = 0;
    }
    if (previewResetTimerId !== null) {
      clearTimeout(previewResetTimerId);
      previewResetTimerId = null;
    }
    previewOverride = null;
    previewRenderer?.resetTransientFx();
    resetPreviewShowcaseBoard(false);
    return;
  }
  requestAnimationFrame(() => {
    if (app.activeScreen !== 'themes' || app.titleOverlayOpen) return;
    previewRenderer?.resize();
    requestPreviewFrames(app, 4);
  });
}

/**
 * Fires a live 3D block-into-gate shred animation + signature audio on the Themes Studio preview stage.
 * Cycling through all 4 showcase blocks triggers the celebratory final-shred crescendo on the 4th block.
 */
export function triggerThemePreviewShred(app: AppViewContext): void {
  if (previewResetTimerId !== null) {
    clearTimeout(previewResetTimerId);
    previewResetTimerId = null;
  }
  const canvas = document.getElementById('themes-preview-canvas') as HTMLCanvasElement | null;
  if (canvas && !previewRenderer) previewRenderer = new Renderer3D(canvas);
  let board = previewBoard ?? resetPreviewShowcaseBoard(false);
  if (isBoardWon(board)) {
    board = resetPreviewShowcaseBoard(false);
    renderSinglePreviewFrame(app, 1 / 60);
  } else if (previewRenderer && previewRenderer.lastSyncedBoardRef !== board) {
    renderSinglePreviewFrame(app, 1 / 60);
  }

  const nextStep = PREVIEW_SHRED_STEPS.find((s) =>
    board.blocks.some((b) => b.id === s.blockId && b.status === 'ACTIVE')
  );
  const blk = nextStep ? board.blocks.find((b) => b.id === nextStep.blockId) : undefined;
  if (!nextStep || !blk) return;

  const clearedSoFar = board.blocks.filter((b) => b.status !== 'ACTIVE').length;
  blk.row = nextStep.targetRow;
  blk.col = nextStep.targetCol;
  blk.x = nextStep.targetCol;
  blk.y = nextStep.targetRow;
  blk.shredGateIndex = nextStep.gateIdx;
  blk.shredProgress = 1;
  blk.status = 'CLEARED';
  board.movesCommitted += 1;
  board.sessionBlocksShredded += 1;

  const save = app.saveManager.getPayload();
  const sel = getEffectivePreviewSelection(app);
  const wonNow = isBoardWon(board);

  if (previewRenderer && !save.settings.reducedMotion) {
    previewRenderer.spawnPathTrace(
      nextStep.traceWaypoints.map((pt) => ({ x: pt.x, y: pt.y })),
      nextStep.colorId,
      0,
      nextStep.spanCols,
      nextStep.spanRows,
      true,
      nextStep.cellMask
    );
  }

  app.sound.playShred(clearedSoFar, sel.particle, wonNow);
  requestPreviewFrames(app, save.settings.reducedMotion ? 28 : 54);

  if (wonNow && save.settings.reducedMotion) {
    previewResetTimerId = setTimeout(() => {
      previewResetTimerId = null;
      if (app.activeScreen === 'themes') {
        resetPreviewShowcaseBoard(false);
        requestPreviewFrames(app, 3);
      }
    }, 440);
  }
}

function selectItemForStudioPreview(
  app: AppViewContext,
  kind: 'skin' | 'tray' | 'particle',
  id: SkinId | TrayId | ParticleStyleId,
  fireShredFx: boolean
): void {
  const cur = getEffectivePreviewSelection(app);
  const next: ThemePreviewSelection = {
    skin: kind === 'skin' ? (id as SkinId) : cur.skin,
    tray: kind === 'tray' ? (id as TrayId) : cur.tray,
    particle: kind === 'particle' ? (id as ParticleStyleId) : cur.particle,
  };
  previewOverride = isPreviewMatchingEquipped(app, next) ? null : next;

  if (kind !== 'particle') {
    const activeCount = previewBoard ? previewBoard.blocks.filter((b) => b.status === 'ACTIVE').length : 0;
    if (!previewBoard || activeCount < 3) {
      resetPreviewShowcaseBoard(true);
    } else if (previewRenderer && !app.saveManager.getPayload().settings.reducedMotion) {
      for (const b of previewBoard.blocks) {
        if (b.status === 'ACTIVE') previewRenderer.blockBounceMap.set(b.id, 0.24);
      }
    }
    app.sound.playButtonTap();
  }

  renderThemesStudioImpl(app);
  if (fireShredFx) {
    triggerThemePreviewShred(app);
  } else {
    requestPreviewFrames(app, 20);
  }
}

function ensureThemesStudioEnhancementsMounted(app: AppViewContext): void {
  const themesSection = document.getElementById('screen-themes');
  if (!themesSection) return;

  const headerPills = themesSection.querySelector<HTMLElement>('.top-economy-bar .economy-pills');
  if (headerPills && !document.getElementById('btn-themes-resume-game')) {
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.id = 'btn-themes-resume-game';
    resumeBtn.className = 'btn-tactile btn-primary btn-compact themes-resume-btn';
    resumeBtn.hidden = true;
    resumeBtn.addEventListener('click', () => {
      app.sound.playButtonTap();
      app.resumeOrLoadLevel(app.board.levelId, true);
    });
    headerPills.prepend(resumeBtn);
  }

  const scrollEl = themesSection.querySelector<HTMLElement>('.themes-scroll');
  if (scrollEl && !document.getElementById('themes-preview-card')) {
    const card = document.createElement('div');
    card.id = 'themes-preview-card';
    card.className = 'themes-preview-card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Live 3D Theme Preview');

    const stageBox = document.createElement('div');
    stageBox.className = 'themes-preview-stage';

    const canvas = document.createElement('canvas');
    canvas.id = 'themes-preview-canvas';
    canvas.className = 'themes-preview-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', 'Interactive 3D Theme Preview — activate to test shred animation');
    canvas.addEventListener('click', () => triggerThemePreviewShred(app));
    canvas.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerThemePreviewShred(app);
      }
    });

    const tapHint = document.createElement('span');
    tapHint.className = 'themes-preview-tap-hint';
    tapHint.setAttribute('aria-hidden', 'true');
    tapHint.textContent = '⚡ Tap stage to shred';
    stageBox.append(canvas, tapHint);

    const panel = document.createElement('div');
    panel.className = 'themes-preview-panel';

    const headerRow = document.createElement('div');
    headerRow.className = 'themes-preview-header';
    const badge = document.createElement('span');
    badge.id = 'themes-preview-badge';
    badge.className = 'themes-preview-badge';
    badge.textContent = '✦ Equipped Loadout';
    headerRow.appendChild(badge);

    const comboList = document.createElement('div');
    comboList.id = 'themes-preview-combo';
    comboList.className = 'themes-preview-combo';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'themes-preview-actions';

    const testShredBtn = document.createElement('button');
    testShredBtn.type = 'button';
    testShredBtn.id = 'btn-themes-test-shred';
    testShredBtn.className = 'btn-tactile btn-primary btn-compact';
    testShredBtn.textContent = '⚡ Test Shred';
    testShredBtn.addEventListener('click', () => triggerThemePreviewShred(app));

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.id = 'btn-themes-reset-preview';
    resetBtn.className = 'btn-tactile btn-secondary btn-compact';
    resetBtn.textContent = '↺ Reset';
    resetBtn.title = 'Reset preview to currently equipped loadout';
    resetBtn.hidden = true;
    resetBtn.addEventListener('click', () => {
      previewOverride = null;
      resetPreviewShowcaseBoard(true);
      app.sound.playButtonTap();
      renderThemesStudioImpl(app);
      requestPreviewFrames(app, 20);
    });

    actionsRow.append(testShredBtn, resetBtn);
    panel.append(headerRow, comboList, actionsRow);
    card.append(stageBox, panel);
    themesSection.insertBefore(card, scrollEl);
  }
}

function syncThemesPreviewHeaderAndReadout(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  const sel = getEffectivePreviewSelection(app);
  const matchesEquipped = isPreviewMatchingEquipped(app, sel);

  const resumeBtn = document.getElementById('btn-themes-resume-game') as HTMLButtonElement | null;
  if (resumeBtn) {
    const canResume = app.canResumeBoard(app.board.levelId);
    const runStarted = isBoardRunStarted(app.board);
    const showResume = canResume && (runStarted || app.themesEnteredFromGame);
    resumeBtn.hidden = !showResume;
    if (showResume) {
      const lvl = app.board.levelId;
      resumeBtn.textContent = runStarted ? `▶ Resume Lvl ${lvl}` : `▶ Back to Lvl ${lvl}`;
      resumeBtn.title = `Return directly to Level ${lvl}`;
    }
  }

  const skinIdx = SKIN_CATALOG.findIndex((s) => s.id === sel.skin);
  const trayIdx = TRAY_CATALOG.findIndex((t) => t.id === sel.tray);
  const partIdx = PARTICLE_CATALOG.findIndex((p) => p.id === sel.particle);
  const skinItem = SKIN_CATALOG[Math.max(0, skinIdx)];
  const trayItem = TRAY_CATALOG[Math.max(0, trayIdx)];
  const partItem = PARTICLE_CATALOG[Math.max(0, partIdx)];

  const skinLockedCost = save.unlockedSkins.includes(sel.skin) ? 0 : getThemeItemPrice(skinIdx);
  const trayLockedCost = save.unlockedTrays.includes(sel.tray) ? 0 : getThemeItemPrice(trayIdx);
  const partLockedCost = save.unlockedParticles.includes(sel.particle) ? 0 : getThemeItemPrice(partIdx);
  const totalLockedCost = skinLockedCost + trayLockedCost + partLockedCost;

  const badge = document.getElementById('themes-preview-badge');
  if (badge) {
    if (matchesEquipped) {
      badge.className = 'themes-preview-badge is-equipped';
      badge.textContent = '✦ Equipped Loadout';
    } else if (totalLockedCost > 0) {
      badge.className = 'themes-preview-badge is-locked-preview';
      badge.textContent = `🔒 Preview · ${totalLockedCost} Coins`;
    } else {
      badge.className = 'themes-preview-badge is-owned-preview';
      badge.textContent = '✦ Previewing Owned Combo';
    }
  }

  const resetBtn = document.getElementById('btn-themes-reset-preview') as HTMLButtonElement | null;
  if (resetBtn) resetBtn.hidden = matchesEquipped;

  const comboList = document.getElementById('themes-preview-combo');
  if (comboList) {
    const entries = [
      { section: 'skins', prefix: 'Blocks', name: skinItem.name, locked: skinLockedCost > 0, id: sel.skin },
      { section: 'trays', prefix: 'Board', name: trayItem.name, locked: trayLockedCost > 0, id: sel.tray },
      {
        section: 'particles',
        prefix: 'Shred',
        name: partItem.name,
        locked: partLockedCost > 0,
        id: sel.particle,
      },
    ] as const;
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `preview-combo-chip ${entry.locked ? 'is-locked' : ''}`;
      chip.title = `Scroll to ${entry.prefix}: ${entry.name}`;

      const dot = document.createElement('span');
      dot.className = `mini-theme-swatch swatch-${entry.id}`;
      dot.setAttribute('aria-hidden', 'true');
      if (entry.section === 'particles') dot.textContent = PARTICLE_GLYPHS[sel.particle] ?? '◆';

      const txt = document.createElement('span');
      txt.className = 'preview-combo-text';
      txt.textContent = `${entry.locked ? '🔒 ' : ''}${entry.name}`;

      chip.append(dot, txt);
      chip.addEventListener('click', () => {
        app.sound.playButtonTap();
        const allTab = document.querySelector<HTMLButtonElement>('[data-theme-tab="all"]');
        const secEl = document.querySelector<HTMLElement>(`[data-theme-section="${entry.section}"]`);
        if (secEl?.hidden && allTab) allTab.click();
        secEl?.scrollIntoView({
          behavior: save.settings.reducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
      });
      frag.appendChild(chip);
    }
    comboList.replaceChildren(frag);
  }
}

export function renderThemesStudioImpl(app: AppViewContext): void {
  ensureThemesStudioEnhancementsMounted(app);
  const save = app.saveManager.getPayload();
  const sel = getEffectivePreviewSelection(app);
  syncThemesPreviewHeaderAndReadout(app);

  const buildCategoryGrid = <T extends string>(
    containerId: string,
    kind: 'skin' | 'tray' | 'particle',
    items: ReadonlyArray<{ id: T; name: string; desc: string }>,
    unlockedList: T[],
    equippedId: T,
    previewedId: T,
    onAction: (id: T, price: number) => void
  ) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const itemPrice = getThemeItemPrice(idx);
      const isUnlocked = unlockedList.includes(item.id);
      const isEquipped = equippedId === item.id;
      const isPreviewed = previewedId === item.id;

      const card = document.createElement('div');
      card.className = [
        'theme-card',
        isEquipped ? 'equipped' : '',
        isPreviewed && !isEquipped ? 'is-previewing' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const topDiv = document.createElement('div');
      topDiv.className = 'theme-card-top';
      topDiv.title = `Preview ${item.name} in 3D showcase`;
      topDiv.addEventListener('click', () =>
        selectItemForStudioPreview(
          app,
          kind,
          item.id as unknown as SkinId | TrayId | ParticleStyleId,
          kind === 'particle'
        )
      );

      const swatchDiv = document.createElement('div');
      swatchDiv.className = `theme-swatch swatch-${item.id}`;
      const glyph = PARTICLE_GLYPHS[item.id as ParticleStyleId];
      if (glyph) swatchDiv.textContent = glyph;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'theme-card-meta';
      const titleRow = document.createElement('div');
      titleRow.className = 'theme-card-title-row';
      const h4 = document.createElement('h4');
      h4.className = 'theme-card-title';
      h4.textContent = item.name;
      titleRow.appendChild(h4);

      if (isPreviewed && !isEquipped) {
        const prevTag = document.createElement('span');
        prevTag.className = 'theme-preview-tag';
        prevTag.textContent = 'Previewing';
        titleRow.appendChild(prevTag);
      }

      const p = document.createElement('p');
      p.className = 'theme-card-desc';
      p.textContent = item.desc;
      metaDiv.append(titleRow, p);
      topDiv.append(swatchDiv, metaDiv);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'theme-card-actions';

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.dataset.previewThemeId = item.id;
      previewBtn.dataset.previewKind = kind;
      previewBtn.className = `btn-tactile btn-compact btn-theme-preview ${
        isPreviewed ? 'is-active-preview' : 'btn-secondary'
      }`;
      previewBtn.textContent =
        kind === 'particle'
          ? isPreviewed
            ? '⚡ Test'
            : '⚡ Preview'
          : isPreviewed
            ? '👁 Shown'
            : '👁 Preview';
      previewBtn.setAttribute('aria-pressed', isPreviewed ? 'true' : 'false');
      previewBtn.addEventListener('click', () =>
        selectItemForStudioPreview(
          app,
          kind,
          item.id as unknown as SkinId | TrayId | ParticleStyleId,
          kind === 'particle'
        )
      );

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.themeId = item.id;
      btn.className = `btn-tactile btn-compact btn-theme-cta ${
        isEquipped ? 'btn-primary' : isUnlocked ? 'btn-secondary' : 'btn-warning'
      }`;
      btn.textContent = isEquipped ? '✦ Equipped' : isUnlocked ? 'Equip' : `Unlock · ${itemPrice} Coins`;
      btn.addEventListener('click', () => onAction(item.id, itemPrice));

      actionsRow.append(previewBtn, btn);
      card.append(topDiv, actionsRow);
      frag.appendChild(card);
    });
    container.replaceChildren(frag);
  };

  const applyThemeSelection = (
    kind: 'skin' | 'tray' | 'particle',
    id: SkinId | TrayId | ParticleStyleId,
    ok: boolean,
    price: number,
    onSuccessSound: () => void
  ) => {
    if (ok) {
      if (previewOverride) {
        delete previewOverride[kind];
        if (!previewOverride.skin && !previewOverride.tray && !previewOverride.particle) {
          previewOverride = null;
        }
      }
      app.syncAllUiFromSave();
      onSuccessSound();
      renderThemesStudioImpl(app);
      app.renderNow();
      if (kind === 'particle' && app.activeScreen === 'themes') {
        triggerThemePreviewShred(app);
      } else {
        requestPreviewFrames(app, 20);
      }
    } else {
      const cur = getEffectivePreviewSelection(app);
      previewOverride = {
        skin: kind === 'skin' ? (id as SkinId) : cur.skin,
        tray: kind === 'tray' ? (id as TrayId) : cur.tray,
        particle: kind === 'particle' ? (id as ParticleStyleId) : cur.particle,
      };
      app.sound.playWallClack();
      app.showGameToast(`Need ${price} Coins to unlock this cosmetic!`);
      renderThemesStudioImpl(app);
      requestPreviewFrames(app, 20);
    }
  };

  buildCategoryGrid(
    'themes-skins-grid',
    'skin',
    SKIN_CATALOG,
    save.unlockedSkins,
    save.equippedSkin,
    sel.skin,
    (id, price) =>
      applyThemeSelection('skin', id, app.saveManager.unlockOrEquipSkin(id, price), price, () =>
        app.sound.playButtonTap()
      )
  );
  buildCategoryGrid(
    'themes-trays-grid',
    'tray',
    TRAY_CATALOG,
    save.unlockedTrays,
    save.equippedTray,
    sel.tray,
    (id, price) =>
      applyThemeSelection('tray', id, app.saveManager.unlockOrEquipTray(id, price), price, () =>
        app.sound.playButtonTap()
      )
  );
  buildCategoryGrid(
    'themes-particles-grid',
    'particle',
    PARTICLE_CATALOG,
    save.unlockedParticles,
    save.equippedParticle,
    sel.particle,
    (id, price) =>
      applyThemeSelection('particle', id, app.saveManager.unlockOrEquipParticle(id, price), price, () =>
        app.sound.playParticlePreview(id)
      )
  );

  if (app.activeScreen === 'themes' && !app.titleOverlayOpen) {
    requestPreviewFrames(app, 3);
  }
}
