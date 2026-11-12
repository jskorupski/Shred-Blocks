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
import { BOOSTER_COIN_COSTS, type SaveManager, THEME_TIER_PRICES } from '../storage/save-manager';

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

export const BOOSTER_DEBUT_NOTES: Partial<Record<number, string>> = {
  2: 'UNCOMMON Power-Up Unlocked: Hint! Highlights the optimal move (+2 Free Moves in Challenge Mode, or +10s Freeze in Speed Rush).',
  8: 'RARE Power-Up Unlocked: Hammer! Tap any block, crate, or locked gate to shatter it.',
  18: 'EPIC Power-Up Unlocked: Rocket! Blasts an entire row or column of blocks.',
  30: 'LEGENDARY Power-Up Unlocked: Color Vacuum! Sweeps all unlocked blocks of a chosen color off the board.',
};

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

export const PWA_INSTALLED_STORAGE_KEY = 'shredblocks_pwa_installed_v1';

export interface AppViewContext {
  readonly saveManager: SaveManager;
  readonly sound: SoundEngine;
  readonly renderer: Renderer3D;
  readonly inputController: BoardInputController;
  board: BoardState;
  activeScreen: 'home' | 'game' | 'themes';
  titleOverlayOpen: boolean;
  blueprintMix: number;
  activeRoadmapRange: string;
  freeUndosRemaining: number;
  runTouchedZen: boolean;
  levelOutcomeHandled: boolean;
  /** TIMED fuse clock: accumulates seconds toward the next `getTimedBombTickSec` bomb tick (`TIMED-BOMB-01`) */
  bombTickAccumulatorSec: number;
  lastPointerActivityMs: number;
  toastTimerId: ReturnType<typeof setTimeout> | null;
  unlockToastTimerId: ReturnType<typeof setTimeout> | null;
  currentLevelHasUnlockNote: boolean;
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
  syncBoosterTargetingBanner(hoverState: HoverState): void;
  syncInstallUiVisibility(): void;
  syncViewportGeometry(): void;
  syncPwaUpdateBanner(): void;
  checkForPwaUpdate(force?: boolean): void;
  renderRoadmap(): void;
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
  showUnlockNoteIfPresent(note?: string): void;
  isNewPlayerSave(save?: SavePayloadV1): boolean;
  isPwaInstalled(): boolean;
  markPwaInstalled(): void;
  handleInstallAction(): Promise<void>;
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
    return { icon: '⏱', shortLabel: 'Speed Rush', badgeLabel: '⏱ SPEED RUSH' };
  }
  return { icon: '⚔️', shortLabel: 'Challenge', badgeLabel: '⚔️ CHALLENGE' };
}
