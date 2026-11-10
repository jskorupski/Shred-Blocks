import type { SoundEngine } from "../audio/synth";
import type { CommitMoveOutcome } from "../core/board";
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
} from "../core/types";
import type { BoardInputController, HoverState } from "../input/pointer-controller";
import type { Renderer3D } from "../render/renderer-3d";
import { BOOSTER_COIN_COSTS, type SaveManager } from "../storage/save-manager";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type ModalId = 'victory' | 'failure' | 'pause' | 'save-transfer' | 'install';

export interface ShredBlocksDebugBridge {
  getBoard: () => BoardState;
  getSave: () => SavePayloadV1;
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
  dismissTitleScreen: (targetScreen?: 'game' | 'home' | 'themes') => void;
  isTitleScreenOpen: () => boolean;
  previewSaveImport: (code: string) => boolean;
  getTelemetry: () => PerfTelemetry;
  run120HzBenchmark: (frames?: number) => Promise<Benchmark120HzResult>;
  simulateContextLoss: () => void;
  boardToScreen: (boardX: number, boardY: number) => { x: number; y: number };
}

declare global {
  interface Window {
    __SHREDBLOCKS_DEBUG__: ShredBlocksDebugBridge;
  }
}

export const UI_BOOSTER_PRICES: Record<BoosterType, number> = BOOSTER_COIN_COSTS;

export const BOOSTER_DISPLAY_NAMES: Record<BoosterType, string> = {
  UNDO: 'Undo',
  FREEZE: 'Hint / Freeze',
  HAMMER: 'Hammer',
  ROCKET: 'Rocket',
  VACUUM: 'Color Vacuum',
};

export const BOOSTER_DEBUT_NOTES: Partial<Record<number, string>> = {
  2: 'UNCOMMON Power-Up Unlocked: Hint / Freeze! Reveals the optimal next move in Zen Mode or freezes timers for +10s.',
  8: 'RARE Power-Up Unlocked: Hammer! Tap any block, crate, or locked gate to shatter it.',
  18: 'EPIC Power-Up Unlocked: Rocket! Blasts an entire row or column of blocks.',
  30: 'LEGENDARY Power-Up Unlocked: Color Vacuum! Sweeps all unlocked blocks of a chosen color off the board.',
};

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
    subtitle: '5×5 Foundations · Pure Sliding & Axis Rails',
    startLevel: 1,
    endLevel: 15,
  },
  {
    chapterNum: 'CHAPTER II',
    title: 'Frost & Forged Iron',
    subtitle: '6×6 Courtyards · Ice, Multi-Layer & Padlocks',
    startLevel: 16,
    endLevel: 40,
  },
  {
    chapterNum: 'CHAPTER III',
    title: 'Terrace of Tethers',
    subtitle: '6×7 Terraces · Ropes, Crates & Countdown Bombs',
    startLevel: 41,
    endLevel: 80,
  },
  {
    chapterNum: 'CHAPTER IV',
    title: 'Clockwork Spires',
    subtitle: '7×7 Spires · Shutters, Rotators & Conveyor Flows',
    startLevel: 81,
    endLevel: 140,
  },
  {
    chapterNum: 'CHAPTER V',
    title: 'Astral Observatory',
    subtitle: '7×8–8×8 Astral Halls · Portals, Magnets & Linked Groups',
    startLevel: 141,
    endLevel: 220,
  },
  {
    chapterNum: 'CHAPTER VI',
    title: 'Grand Citadel',
    subtitle: '8×8–9×9 Citadel · Masterwork Architectural Synthesis',
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
    endLevel: 9999,
  };
}

export const THEME_UNLOCK_PRICE = 150;

export const SKIN_CATALOG: ReadonlyArray<{ id: SkinId; name: string; desc: string }> = [
  { id: 'classic_studs', name: 'Classic Studs', desc: 'Tactile toy-box blocks with raised top studs' },
  { id: 'smooth_bevel', name: 'Smooth Bevel', desc: 'Sleek satin-matte chamfered acrylic blocks' },
  { id: 'gummy_jelly', name: 'Gummy Jelly', desc: 'Glossy translucent subsurface candy blocks' },
  { id: 'carved_wood', name: 'Carved Wood', desc: 'Warm artisan hardwood blocks with grain bands' },
  { id: 'neon_cyber', name: 'Neon Cyber', desc: 'Dark obsidian core with glowing neon rim light' },
];

export const TRAY_CATALOG: ReadonlyArray<{ id: TrayId; name: string; desc: string }> = [
  { id: 'industrial_slate', name: 'Industrial Slate', desc: 'High-contrast dark steel puzzle tray' },
  { id: 'warm_birch', name: 'Warm Birch', desc: 'Cozy Scandinavian wooden tabletop board' },
  { id: 'midnight_arcade', name: 'Midnight Arcade', desc: 'Deep synthwave indigo cabinet frame' },
  { id: 'frosted_quartz', name: 'Frosted Quartz', desc: 'Crisp architectural alabaster stone tray' },
  { id: 'mint_studio', name: 'Mint Studio', desc: 'Refreshing seafoam studio workbench' },
];

export const PARTICLE_CATALOG: ReadonlyArray<{ id: ParticleStyleId; name: string; desc: string }> = [
  { id: 'micro_cubes', name: 'Micro Cubes', desc: 'Crisp 3D voxel cubes flying from the rollers' },
  { id: 'star_confetti', name: 'Star Confetti', desc: 'Celebratory tumbling party bursts' },
  { id: 'pixel_sparks', name: 'Pixel Sparks', desc: 'High-velocity arcade energy sparks' },
  { id: 'soap_bubbles', name: 'Soap Bubbles', desc: 'Floaty iridescent spheres with gentle drift' },
  { id: 'lightning_bolts', name: 'Lightning Bolts', desc: 'Crackling electric shredder surges' },
];

export const PWA_INSTALLED_STORAGE_KEY = "shredblocks_pwa_installed_v1";

export interface AppViewContext {
  readonly saveManager: SaveManager;
  readonly sound: SoundEngine;
  readonly renderer: Renderer3D;
  readonly inputController: BoardInputController;
  board: BoardState;
  activeScreen: "home" | "game" | "themes";
  titleOverlayOpen: boolean;
  blueprintMix: number;
  activeRoadmapRange: string;
  freeUndosRemaining: number;
  levelOutcomeHandled: boolean;
  lastPointerActivityMs: number;
  toastTimerId: ReturnType<typeof setTimeout> | null;
  unlockToastTimerId: ReturnType<typeof setTimeout> | null;
  currentLevelHasUnlockNote: boolean;
  cachedAutoGuideMove: { blockId: number; targetRow: number; targetCol: number } | null;
  commitMove(blockId: number, targetRow: number, targetCol: number): CommitMoveOutcome;
  autoSolveCurrentLevel(): boolean;
  pendingImportPayload: SavePayloadV1 | null;
  pendingImportRawCode: string | null;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  pwaInstalledDetected: boolean;
  waitingServiceWorker: ServiceWorker | null;
  loadLevel(levelId: number, switchToGameScreen?: boolean, persistLevel?: boolean): void;
  restartCurrentLevel(): void;
  skipCurrentLevel(): void;
  continueFailedLevel(): void;
  activateBooster(type: BoosterType): void;
  openTitleScreen(): void;
  dismissTitleScreen(targetScreen?: "game" | "home" | "themes"): void;
  switchScreen(screen: "home" | "game" | "themes"): void;
  syncAllUiFromSave(): void;
  syncInGameHud(): void;
  syncTimerPillOnly(): void;
  syncTitleOverlayDom(): void;
  syncBoosterTargetingBanner(hoverState: HoverState): void;
  syncInstallUiVisibility(): void;
  renderRoadmap(): void;
  renderThemesStudio(): void;
  renderNow(dtSec?: number, timeSec?: number): void;
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
