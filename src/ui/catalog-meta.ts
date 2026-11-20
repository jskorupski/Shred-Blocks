import type { SoundEngine } from '../audio/synth';
import type { CommitMoveOutcome } from '../core/board';
import type {
  Benchmark120HzResult,
  BoardState,
  BoosterType,
  ParticleStyleId,
  PerfTelemetry,
  PlayMode,
  QualityTier,
  SavePayloadV1,
  SkinId,
  TrayId,
} from '../core/types';
import type { BoardInputController, HoverState } from '../input/pointer-controller';
import type { Renderer3D } from '../render/renderer-3d';
import {
  BOOSTER_COIN_COSTS,
  countUniqueClearedLevels,
  getEffectiveBoosterUnlockLevel,
  isRecordGenuinelyCleared,
  type SaveManager,
  THEME_TIER_PRICES,
} from '../storage/save-manager';
import { renderStructuredBannerText } from './mode-and-booster-icons';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type ModalId = 'victory' | 'failure' | 'pause' | 'save-transfer' | 'install';

export const MAX_ENDLESS_LEVEL = 999_999;

export interface AppHistoryState {
  __shredblocksNav: true;
  view: 'title' | 'home' | 'game' | 'themes';
  levelId?: number;
}

export interface ShredBlocksDebugBridge {
  getBoard: () => BoardState;
  getSave: () => SavePayloadV1;
  patchSave: (patch: Partial<SavePayloadV1>) => void;
  loadLevel: (levelId: number) => void;
  commitMove: (blockId: number, targetRow: number, targetCol: number) => CommitMoveOutcome;
  autoSolveCurrentLevel: () => boolean;
  setPlayMode: (mode: PlayMode) => void;
  setColorblindMode: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  setQualityTier: (tier: QualityTier) => void;
  setTheme: (skin: SkinId, tray: TrayId, particle: ParticleStyleId) => void;
  activateBooster: (type: BoosterType) => void;
  openModal: (id: ModalId) => void;
  closeAllModals: () => void;
  openTitleScreen: () => void;
  dismissTitleScreen: (targetScreen?: 'game' | 'home' | 'themes', animateAwakening?: boolean) => void;
  isTitleScreenOpen: () => boolean;
  getBlueprintMix: () => number;
  setPwaUpdateBannerVisible: (visible: boolean) => void;
  previewSaveImport: (code: string) => boolean;
  getTelemetry: () => PerfTelemetry;
  run120HzBenchmark: (frames?: number) => Promise<Benchmark120HzResult>;
  simulateContextLoss: () => void;
  boardToScreen: (boardX: number, boardY: number) => { x: number; y: number };
  getHoverState: () => HoverState;
  getActivePathTraceCount: () => number;
  getParticleTelemetry: () => {
    activeParticles: number;
    activeGateBursts: number;
    gateBurstModes: string[];
    meanParticleZ: number;
  };
  /** VISUAL-GOLDEN-01: pause the rAF loop and render one frame at a fixed shader time (`null` resumes live time) */
  freezeTime: (timeSec: number | null) => void;
  /** VISUAL-GOLDEN-01: while frozen, deterministically step simulation + render `frames` frames of `dtSec` */
  advanceFrozenFrames: (frames: number, dtSec?: number) => void;
  /** VISUAL-GOLDEN-01: seed cosmetic FX randomness (`null` restores `Math.random`) */
  setFxRandomSeed: (seed: number | null) => void;
  /** Sync in-game DOM HUD immediately from current `board` + `save` state */
  syncHud: () => void;
}

declare global {
  interface Window {
    __SHREDBLOCKS_DEBUG__: ShredBlocksDebugBridge;
  }
}

export const UI_BOOSTER_PRICES: Record<BoosterType, number> = BOOSTER_COIN_COSTS;

export const BOOSTER_DISPLAY_NAMES: Record<BoosterType, string> = {
  UNDO: 'Undo',
  HINT: 'Hint',
  HAMMER: 'Hammer',
  ROCKET: 'Rocket',
  VACUUM: 'Color Vacuum',
};

export type UnlockBannerKind = 'guide' | 'unlock';

export const BOOSTER_DEBUT_NOTES: Partial<Record<number, string>> = {
  2: '💡 UNCOMMON Power-Up Unlocked: Hint! Highlights the optimal move (+2 Free Moves in Challenge Mode, or +10s Freeze in Speed Rush).',
  8: '🔨 RARE Power-Up Unlocked: Hammer! Tap any block, crate, or locked gate to shatter it.',
  18: '🚀 EPIC Power-Up Unlocked: Rocket! Blasts an entire row or column of blocks.',
  30: '🧲 LEGENDARY Power-Up Unlocked: Color Vacuum! Sweeps all unlocked blocks of a chosen color off the board.',
};

/** Calm helper-guide phrasing shown when revisiting a Power-Up debut stage after it was already unlocked/seen. */
export const BOOSTER_GUIDE_NOTES: Partial<Record<number, string>> = {
  2: '💡 Power-Up Guide — Hint: Highlights the optimal move (+2 Free Moves in Challenge Mode, or +10s Freeze in Speed Rush).',
  8: '🔨 Power-Up Guide — Hammer: Tap any block, crate, or locked gate to shatter it.',
  18: '🚀 Power-Up Guide — Rocket: Blasts an entire row or column of blocks.',
  30: '🧲 Power-Up Guide — Color Vacuum: Sweeps all unlocked blocks of a chosen color off the board.',
};

const LOCKED_BOOSTER_GUIDANCE_NOTES: Partial<Record<number, (cleared: number) => string>> = {
  2: () => '💡 UNCOMMON Power-Up: Hint — clear 1 stage to unlock!',
  8: (c) => `🔨 RARE Power-Up: Hammer — clear 7 stages (${c}/7) to unlock!`,
  18: (c) => `🚀 EPIC Power-Up: Rocket — clear 17 stages (${c}/17) to unlock!`,
  30: (c) => `🧲 LEGENDARY Power-Up: Color Vacuum — clear 29 stages (${c}/29) to unlock!`,
};

export const SEEN_BOOSTER_DEBUTS_STORAGE_KEY = 'shredblocks.seen_booster_debuts.v1';

function readSeenBoosterDebutLevels(): Set<number> {
  const seen = new Set<number>();
  try {
    if (typeof localStorage === 'undefined') return seen;
    const raw = localStorage.getItem(SEEN_BOOSTER_DEBUTS_STORAGE_KEY);
    if (!raw) return seen;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'number' && Number.isInteger(item) && item >= 1) {
          seen.add(item);
        }
      }
    }
  } catch {
    // Ignore storage quota/privacy restrictions
  }
  return seen;
}

export function hasSeenBoosterDebutNote(levelId: number): boolean {
  return readSeenBoosterDebutLevels().has(levelId);
}

/** Records that a one-time Power-Up unlock celebration banner was shown on screen (`BANNER-CLEANUP-01`). */
export function markBoosterDebutNoteSeen(levelId: number): void {
  if (!BOOSTER_DEBUT_NOTES[levelId]) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const seen = readSeenBoosterDebutLevels();
    if (seen.has(levelId)) return;
    seen.add(levelId);
    localStorage.setItem(SEEN_BOOSTER_DEBUTS_STORAGE_KEY, JSON.stringify(Array.from(seen)));
  } catch {
    // Ignore storage quota/privacy restrictions
  }
}

export function clearSeenBoosterDebutNotes(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SEEN_BOOSTER_DEBUTS_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

/**
 * Returns the Power-Up milestone banner text once genuine progression unlocks `levelId` (`ZEN-SKIP-GUARD-01`):
 * - First fresh arrival (`effectiveLevel === levelId`, not yet cleared, not yet celebrated): celebratory `"Unlocked!"` copy.
 * - Subsequent visits / replays (e.g., refreshing on Stage 8 or handing the device to a new player to try earlier stages):
 *   calm `"Power-Up Guide"` helper copy so tutorial guidance stays available without re-announcing a fake unlock.
 */
export function resolveBoosterDebutToastNote(save: SavePayloadV1, levelId: number): string | undefined {
  const unlockNote = BOOSTER_DEBUT_NOTES[levelId];
  if (!unlockNote) return undefined;
  const effectiveLevel = getEffectiveBoosterUnlockLevel(save, levelId);
  if (effectiveLevel < levelId) return undefined;
  const isFirstUnlockCelebration =
    effectiveLevel === levelId &&
    !isRecordGenuinelyCleared(save.levelRecords[levelId]) &&
    !hasSeenBoosterDebutNote(levelId);
  return isFirstUnlockCelebration ? unlockNote : (BOOSTER_GUIDE_NOTES[levelId] ?? unlockNote);
}

/**
 * Resolves the stage-intro `#unlock-toast` payload, distinguishing calm `'guide'` tutorial plaques
 * (mechanic intros and revisited Power-Up guides) from one-time golden `'unlock'` milestone banners.
 */
export function resolveStageUnlockBanner(
  save: SavePayloadV1,
  levelId: number,
  specUnlockNote?: string
): { note?: string; kind: UnlockBannerKind; boosterDebutLevelId?: number } {
  if (specUnlockNote) return { note: specUnlockNote, kind: 'guide' };
  const note = resolveBoosterDebutToastNote(save, levelId);
  if (!note) return { kind: 'guide' };
  const isFirstUnlock = note === BOOSTER_DEBUT_NOTES[levelId];
  return isFirstUnlock ? { note, kind: 'unlock', boosterDebutLevelId: levelId } : { note, kind: 'guide' };
}

/** Shows truthful clear-count guidance on roadmap debut nodes when skipped ahead in Zen Mode. */
export function resolveRoadmapBoosterDebutNote(save: SavePayloadV1, levelId: number): string | undefined {
  const debutNote = BOOSTER_DEBUT_NOTES[levelId];
  if (!debutNote) return undefined;
  if (getEffectiveBoosterUnlockLevel(save, levelId) >= levelId) return debutNote;
  if (save.settings.playMode !== 'ZEN') return debutNote;
  const formatter = LOCKED_BOOSTER_GUIDANCE_NOTES[levelId];
  if (!formatter) return undefined;
  const cleared = Math.min(levelId - 1, countUniqueClearedLevels(save));
  return formatter(cleared);
}

export const SANCTUARY_AWAKENING_MILESTONES: ReadonlyArray<{ levelId: number; label: string }> = [
  { levelId: 2, label: 'Hint Power-Up' },
  { levelId: 8, label: 'Hammer Power-Up' },
  { levelId: 11, label: 'Axis-Lock Guide Rails' },
  { levelId: 14, label: 'Sculpted Sanctuary Courtyards' },
  { levelId: 18, label: 'Rocket Power-Up & Stepped Gates' },
  { levelId: 21, label: 'Interior Stone Pillars' },
  { levelId: 25, label: 'Twin Sanctum Portcullis Chamber' },
  { levelId: 28, label: 'Sealed Mystery Vaults' },
  { levelId: 30, label: 'Color Vacuum Power-Up' },
  { levelId: 31, label: 'Multi-Layer Block Shells' },
  { levelId: 41, label: 'Chapter III · Frozen Ice Blocks' },
  { levelId: 51, label: 'Star Blocks & Star Gates' },
  { levelId: 61, label: 'Padlock & Key Chains' },
  { levelId: 71, label: 'Movable Stone Monoliths' },
  { levelId: 81, label: 'Chapter IV · Wooden Crates' },
  { levelId: 91, label: 'Countdown Bombs' },
  { levelId: 101, label: 'Glued Linked Assemblies' },
  { levelId: 111, label: 'Colored Ropes & Scissors' },
  { levelId: 121, label: 'Color-Changing Queue Gates' },
  { levelId: 131, label: 'Frozen Exit Gates' },
  { levelId: 141, label: 'Chapter V · Jewel & Toggling Shutters' },
  { levelId: 151, label: 'Sliding & Breathing Gates' },
  { levelId: 161, label: 'Block Spawner Generators' },
  { levelId: 171, label: 'Chromatic Floor Carpets' },
  { levelId: 181, label: 'Moving Courtyard Elevators' },
  { levelId: 221, label: 'Chapter VI · Grand Citadel' },
  { levelId: 301, label: 'Endless Citadel Mastery' },
];

export function getNextSanctuaryAwakeningText(currentLevelId: number): string {
  for (const m of SANCTUARY_AWAKENING_MILESTONES) {
    if (m.levelId > currentLevelId) {
      const delta = m.levelId - currentLevelId;
      return `Next Awakening: Lvl ${m.levelId} · ${m.label} (${delta} ${delta === 1 ? 'stage' : 'stages'} away)`;
    }
  }
  const nextDecade = Math.ceil((currentLevelId + 1) / 10) * 10;
  const delta = nextDecade - currentLevelId;
  return `Next Sanctuary Milestone: Lvl ${nextDecade} Chest (${delta} ${delta === 1 ? 'stage' : 'stages'} away)`;
}

export interface ChapterMeta {
  chapterNum: string;
  title: string;
  subtitle: string;
  startLevel: number;
  endLevel: number;
}

export const CAMPAIGN_CHAPTERS: ReadonlyArray<ChapterMeta> = [
  {
    chapterNum: 'CHAPTER I',
    title: 'Sanctuary Courtyard',
    subtitle: '5×5–6×6 Foundations · Corridor Staging & Axis Rails',
    startLevel: 1,
    endLevel: 15,
  },
  {
    chapterNum: 'CHAPTER II',
    title: 'Vaults & Sanctums',
    subtitle: '6×6–8×6 Sanctums · Portcullises, Mystery Vaults & Multi-Layer',
    startLevel: 16,
    endLevel: 40,
  },
  {
    chapterNum: 'CHAPTER III',
    title: 'Frost & Starlight',
    subtitle: '6×7–9×7 Terraces · Ice, Star Gates, Padlocks & Stone Monoliths',
    startLevel: 41,
    endLevel: 80,
  },
  {
    chapterNum: 'CHAPTER IV',
    title: 'Clockwork Crucible',
    subtitle: '7×7–9×7 Spires · Crates, Bombs, Glued Links, Ropes & Queues',
    startLevel: 81,
    endLevel: 140,
  },
  {
    chapterNum: 'CHAPTER V',
    title: 'Astral Observatory',
    subtitle: '7×8–9×8 Halls · Shutters, Sliding Gates, Generators & Elevators',
    startLevel: 141,
    endLevel: 220,
  },
  {
    chapterNum: 'CHAPTER VI',
    title: 'Grand Citadel',
    subtitle: '8×8–10×8 Citadel · Masterwork Multi-Mechanic Synthesis',
    startLevel: 221,
    endLevel: 300,
  },
];

export function getChapterMetaForLevel(levelId: number): ChapterMeta {
  for (const ch of CAMPAIGN_CHAPTERS) {
    if (levelId >= ch.startLevel && levelId <= ch.endLevel) {
      return ch;
    }
  }
  return {
    chapterNum: 'ENDLESS CITADEL',
    title: 'Infinite Horizon',
    subtitle: '8×8–9×9 Procedural Sanctuary Mastery',
    startLevel: 301,
    endLevel: MAX_ENDLESS_LEVEL,
  };
}

export const THEME_UNLOCK_PRICE = 250;

export function getThemeItemPrice(catalogIndex: number): number {
  if (catalogIndex <= 0) return 0;
  return THEME_TIER_PRICES[Math.min(catalogIndex, THEME_TIER_PRICES.length - 1)] ?? 250;
}

export const SKIN_CATALOG: ReadonlyArray<{ id: SkinId; name: string; desc: string }> = [
  { id: 'classic_studs', name: 'Classic Studs', desc: 'Tactile toy-box blocks with raised top studs' },
  {
    id: 'relic_stone',
    name: 'Relic Stone',
    desc: 'Aged worn stone slabs with weathered edges & subtle runes',
  },
  {
    id: 'gummy_jelly',
    name: 'Gummy Jelly',
    desc: 'Glossy translucent candy blocks with glowing cores & bubbles',
  },
  {
    id: 'carved_wood',
    name: 'Carved Wood',
    desc: 'Fine straight-grained hardwood blocks with natural knots',
  },
  {
    id: 'neon_cyber',
    name: 'Neon Cyber',
    desc: 'Glossy black glass with neon edges & pulsing circuit traces',
  },
];

export const TRAY_CATALOG: ReadonlyArray<{ id: TrayId; name: string; desc: string }> = [
  {
    id: 'industrial_slate',
    name: 'Industrial Slate',
    desc: 'Cleft slate flagstones framed by dressed ashlar stone walls',
  },
  {
    id: 'warm_birch',
    name: 'Warm Birch',
    desc: 'Joined Scandinavian birch planks with stained timber beam rims',
  },
  {
    id: 'midnight_arcade',
    name: 'Midnight Arcade',
    desc: 'Polished obsidian floor with glowing cyan-magenta neon grid',
  },
  {
    id: 'frosted_quartz',
    name: 'Frosted Quartz',
    desc: 'Faceted glacial crystal ice tiles with frost veins & glints',
  },
  {
    id: 'mint_studio',
    name: 'Mint Studio',
    desc: 'Polished jade terrazzo with marble flecks & gold rim inlay',
  },
];

export const PARTICLE_CATALOG: ReadonlyArray<{ id: ParticleStyleId; name: string; desc: string }> = [
  {
    id: 'micro_cubes',
    name: 'Micro Cubes',
    desc: 'Beveled 3D voxel cubes bouncing off the courtyard',
  },
  {
    id: 'star_confetti',
    name: 'Star Confetti',
    desc: '5-point golden & matching foil stars fluttering down',
  },
  {
    id: 'pixel_sparks',
    name: 'Pixel Sparks',
    desc: 'Velocity-streaked incandescent sparks with crisp ricochets',
  },
  {
    id: 'soap_bubbles',
    name: 'Soap Bubbles',
    desc: 'Buoyant rainbow-iridescent bubbles floating skyward',
  },
  {
    id: 'lightning_bolts',
    name: 'Lightning Bolts',
    desc: 'Crackling plasma bolts & electric gate threshold arcs',
  },
];

export const PARTICLE_GLYPHS: Readonly<Record<ParticleStyleId, string>> = {
  micro_cubes: '◆',
  star_confetti: '✦',
  pixel_sparks: '✴',
  soap_bubbles: '◎',
  lightning_bolts: '↯',
};

export const PWA_INSTALLED_STORAGE_KEY = 'shredblocks_pwa_installed_v1';

/**
 * Returns `true` when actively running in a chromeless standalone/fullscreen PWA window,
 * iOS Home Screen WebClip (`navigator.standalone`), or Android TWA (`android-app://` referrer).
 */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneMedia =
    window.matchMedia?.(
      '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)'
    ).matches ?? false;
  const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  const twaReferrer = typeof document !== 'undefined' && document.referrer.startsWith('android-app://');
  return standaloneMedia || iosStandalone || twaReferrer;
}

export interface AppViewContext {
  readonly saveManager: SaveManager;
  readonly sound: SoundEngine;
  readonly renderer: Renderer3D;
  readonly inputController: BoardInputController;
  board: BoardState;
  boardPlayMode: PlayMode;
  activeScreen: 'home' | 'game' | 'themes';
  titleOverlayOpen: boolean;
  themesEnteredFromGame: boolean;
  blueprintMix: number;
  activeRoadmapRange: string;
  expandedEndlessRanges: Array<[number, number]>;
  freeUndosRemaining: number;
  runTouchedZen: boolean;
  levelOutcomeHandled: boolean;
  /** TIMED fuse clock: accumulates seconds toward the next `getTimedBombTickSec` bomb tick (`TIMED-BOMB-01`) */
  bombTickAccumulatorSec: number;
  lastPointerActivityMs: number;
  toastTimerId: ReturnType<typeof setTimeout> | null;
  unlockToastTimerId: ReturnType<typeof setTimeout> | null;
  currentLevelHasUnlockNote: boolean;
  /** Tracks whether the current board instance has already presented its intro `#unlock-toast` on `#screen-game`. */
  boardUnlockNoteShown: boolean;
  cachedAutoGuideMove: { blockId: number; targetRow: number; targetCol: number } | null;
  commitMove(blockId: number, targetRow: number, targetCol: number): CommitMoveOutcome;
  pushUndoSnapshot(boardState: BoardState): void;
  checkWinOrLossAfterAction(): void;
  autoSolveCurrentLevel(): boolean;
  pendingImportPayload: SavePayloadV1 | null;
  pendingImportRawCode: string | null;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  pwaInstalledDetected: boolean;
  swRegistration: ServiceWorkerRegistration | null;
  waitingServiceWorker: ServiceWorker | null;
  pwaUpdateAvailable: boolean;
  pwaUpdateDismissedInSession: boolean;
  lastSwUpdateCheckMs: number;
  lastBackgroundedAtMs: number;
  hasUserInteracted: boolean;
  isApplyingPopstate: boolean;
  historyInitialized: boolean;
  canResumeBoard(levelId?: number): boolean;
  resumeOrLoadLevel(levelId: number, switchToGameScreen?: boolean, persistLevel?: boolean): void;
  loadLevel(levelId: number, switchToGameScreen?: boolean, persistLevel?: boolean): void;
  switchPlayMode(nextMode: PlayMode, silent?: boolean): void;
  restartCurrentLevel(): void;
  skipCurrentLevel(): void;
  continueFailedLevel(): void;
  useZenBlessingContinue(): void;
  activateBooster(type: BoosterType): void;
  openTitleScreen(): void;
  dismissTitleScreen(targetScreen?: 'game' | 'home' | 'themes', animateAwakening?: boolean): void;
  switchScreen(screen: 'home' | 'game' | 'themes'): void;
  syncAllUiFromSave(): void;
  syncInGameHud(): void;
  syncTimerPillOnly(): void;
  syncTitleOverlayDom(): void;
  requestModalBackdropRefresh?(): void;
  syncBoosterTargetingBanner(hoverState: HoverState): void;
  syncInstallUiVisibility(): void;
  syncViewportGeometry(): void;
  syncPwaUpdateBanner(): void;
  checkForPwaUpdate(force?: boolean): void;
  renderRoadmap(focusStageId?: number): void;
  renderThemesStudio(): void;
  renderNow(dtSec?: number, timeSec?: number): void;
  freezeTime(timeSec: number | null): void;
  advanceFrozenFrames(frames: number, dtSec?: number): void;
  openModal(id: ModalId): void;
  closeAllModals(): void;
  isAnyModalOpen(): boolean;
  previewSaveImport(rawInput: string): boolean;
  confirmPendingSaveImport(): void;
  checkUrlHashForSaveImport(): void;
  showGameToast(message: string, durationMs?: number): void;
  showUnlockNoteIfPresent(note?: string, kind?: UnlockBannerKind): void;
  isNewPlayerSave(save?: SavePayloadV1): boolean;
  isPwaInstalled(): boolean;
  markPwaInstalled(): void;
  handleInstallAction(): Promise<void>;
}

/**
 * Dismisses the global `#game-toast` notification and clears any pending auto-hide timer (`BANNER-CLEANUP-01`).
 */
export function dismissGameToastImpl(app: Pick<AppViewContext, 'toastTimerId'>): void {
  if (app.toastTimerId !== null) {
    clearTimeout(app.toastTimerId);
    app.toastTimerId = null;
  }
  const toast = typeof document !== 'undefined' ? document.getElementById('game-toast') : null;
  if (toast) {
    toast.hidden = true;
  }
}

/**
 * Dismisses the in-game `#unlock-toast` banner and clears any pending auto-hide timer (`BANNER-CLEANUP-01`).
 */
export function dismissUnlockToastImpl(app: Pick<AppViewContext, 'unlockToastTimerId'>): void {
  if (app.unlockToastTimerId !== null) {
    clearTimeout(app.unlockToastTimerId);
    app.unlockToastTimerId = null;
  }
  const banner = typeof document !== 'undefined' ? document.getElementById('unlock-toast') : null;
  if (banner) {
    banner.hidden = true;
  }
}

/**
 * Displays the global `#game-toast` notification and arms a fresh auto-hide timer (`BANNER-CLEANUP-01`).
 */
export function showGameToastImpl(
  app: Pick<AppViewContext, 'toastTimerId'>,
  message: string,
  durationMs = 3000
): void {
  const toast = typeof document !== 'undefined' ? document.getElementById('game-toast') : null;
  if (!toast) return;
  renderStructuredBannerText(toast, message);
  toast.hidden = false;
  if (app.toastTimerId !== null) {
    clearTimeout(app.toastTimerId);
  }
  app.toastTimerId = setTimeout(() => {
    app.toastTimerId = null;
    toast.hidden = true;
  }, durationMs);
}

/**
 * Displays the in-game `#unlock-toast` stage guide / Power-Up unlock banner strictly while on `#screen-game`
 * with `#title-overlay` dismissed, so off-screen level preloads never arm stale countdowns (`BANNER-CLEANUP-01`).
 */
export function showUnlockNoteIfPresentImpl(
  app: Pick<AppViewContext, 'unlockToastTimerId' | 'activeScreen' | 'titleOverlayOpen'>,
  note?: string,
  kind: UnlockBannerKind = 'guide'
): void {
  const banner = typeof document !== 'undefined' ? document.getElementById('unlock-toast') : null;
  const textEl = typeof document !== 'undefined' ? document.getElementById('unlock-toast-text') : null;
  if (!banner || !textEl) return;

  dismissUnlockToastImpl(app);

  if (!note || app.activeScreen !== 'game' || app.titleOverlayOpen) {
    return;
  }

  banner.dataset.bannerKind = kind;
  renderStructuredBannerText(textEl, note);
  banner.hidden = false;
  app.unlockToastTimerId = setTimeout(() => {
    app.unlockToastTimerId = null;
    banner.hidden = true;
  }, 6400);
}

/**
 * Resolves and displays the stage-intro `#unlock-toast` banner for `levelId` (and records first-time
 * Power-Up milestone celebration views) strictly when `#screen-game` is active (`BANNER-CLEANUP-01`).
 */
export function presentStageUnlockBannerImpl(
  app: Pick<AppViewContext, 'saveManager' | 'activeScreen' | 'titleOverlayOpen' | 'boardUnlockNoteShown'> & {
    showUnlockNoteIfPresent?: AppViewContext['showUnlockNoteIfPresent'];
  },
  levelId: number,
  specUnlockNote?: string
): void {
  if (app.activeScreen !== 'game' || app.titleOverlayOpen) return;
  const banner = resolveStageUnlockBanner(app.saveManager.getPayload(), levelId, specUnlockNote);
  app.boardUnlockNoteShown = true;
  app.showUnlockNoteIfPresent?.(banner.note, banner.kind);
  if (banner.note && banner.boosterDebutLevelId !== undefined) {
    markBoosterDebutNoteSeen(banner.boosterDebutLevelId);
  }
}

/**
 * Clears all transient gameplay notification banners (`#game-toast`, `#unlock-toast`) and their timers
 * whenever leaving gameplay, switching screens, opening the Title Screen, loading/restarting a stage,
 * or ending a run (`BANNER-CLEANUP-01`).
 */
export function clearTransientBannersImpl(
  app: Pick<AppViewContext, 'toastTimerId' | 'unlockToastTimerId'>
): void {
  dismissGameToastImpl(app);
  dismissUnlockToastImpl(app);
}

export function getPlayModeMeta(mode: PlayMode): {
  icon: string;
  shortLabel: string;
  badgeLabel: string;
} {
  if (mode === 'ZEN') {
    return { icon: '🌿', shortLabel: 'Zen', badgeLabel: '🌿 ZEN' };
  }
  if (mode === 'TIMED') {
    return { icon: '⏱️', shortLabel: 'Speed Rush', badgeLabel: '⏱️ SPEED RUSH' };
  }
  return { icon: '⚔️', shortLabel: 'Challenge', badgeLabel: '⚔️ CHALLENGE' };
}

export {
  BOOSTER_TOKENS,
  type ButtonActionGlyphKind,
  buildNodesWithModeIcons,
  createBoosterIconSvg,
  createInlineBoosterIconSpan,
  createInlineModeIconSpan,
  createModeIconSvg,
  formatCompactLevelRef,
  renderNavPlayLabel,
  renderStructuredBannerText,
  type StructuredButtonParts,
  setButtonIconLabel,
  setModeIconElement,
  setRichModeText,
} from './mode-and-booster-icons';

let zoomLockInstalled = false;

/**
 * Installs capture-phase anti-zoom guards (`VIEWPORT-ZOOM-LOCK-01`) across all screens and
 * Top-Layer `<dialog>` modals so iOS Safari, iOS Home Screen WebClips, iPadOS, Android PWAs, and
 * Desktop trackpads never accidentally pinch-zoom or double-tap-zoom parts of the game offscreen.
 */
export function installNativeAppZoomLock(onViewportReset: () => void): void {
  if (zoomLockInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  zoomLockInstalled = true;

  const preventGestureZoom = (e: Event) => {
    if (e.cancelable) {
      e.preventDefault();
    }
  };

  // 1. iOS / iPadOS / macOS WebKit GestureEvents (blocks split-element & standalone WebClip pinch-zoom)
  document.addEventListener('gesturestart', preventGestureZoom, { passive: false, capture: true });
  document.addEventListener('gesturechange', preventGestureZoom, { passive: false, capture: true });
  document.addEventListener('gestureend', preventGestureZoom, { passive: false, capture: true });

  // 2. Multi-touch pinch guard (`touches.length > 1` or WebKit `TouchEvent.scale !== 1`)
  const blockMultiTouchPinch = (e: TouchEvent) => {
    const scale = (e as TouchEvent & { scale?: number }).scale;
    if (e.touches.length > 1 || (typeof scale === 'number' && scale > 0 && Math.abs(scale - 1) > 0.01)) {
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  };
  document.addEventListener('touchstart', blockMultiTouchPinch, { passive: false, capture: true });
  document.addEventListener('touchmove', blockMultiTouchPinch, { passive: false, capture: true });

  // 3. Desktop trackpad pinch-zoom & Ctrl+wheel zoom guard (leaves 2-finger scrolling `ctrlKey: false` intact)
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (e.ctrlKey && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  // 4. Legacy double-click zoom guard (leaves editable `<input>` / `<textarea>` word selection intact)
  document.addEventListener(
    'dblclick',
    (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  // 5. iOS virtual-keyboard dismiss scroll recovery (`#level-jump-input`, `#save-code-input`, `#select-quality-tier`)
  document.addEventListener(
    'focusout',
    (e: FocusEvent) => {
      const prev = e.target;
      if (
        !(prev instanceof HTMLInputElement) &&
        !(prev instanceof HTMLTextAreaElement) &&
        !(prev instanceof HTMLSelectElement)
      ) {
        return;
      }
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        ) {
          return;
        }
        window.scrollTo(0, 0);
        onViewportReset();
      });
    },
    { passive: true, capture: true }
  );
}
