export type ColorId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ColorThemeEntry {
  id: ColorId;
  name: string;
  symbol: string;
  primaryHex: string;
  highlightHex: string;
  lipHex: string;
  highContrastPrimaryHex: string;
  highContrastLipHex: string;
  rgb: [number, number, number];
  hcRgb: [number, number, number];
}

export const COLOR_PALETTE: Record<ColorId, ColorThemeEntry> = {
  0: {
    id: 0,
    name: 'Charcoal Stone',
    symbol: '▨',
    primaryHex: '#7C8BA1',
    highlightHex: '#B0BECF',
    lipHex: '#475569',
    highContrastPrimaryHex: '#94A3B8',
    highContrastLipHex: '#334155',
    rgb: [0.486, 0.545, 0.631],
    hcRgb: [0.58, 0.639, 0.722],
  },
  1: {
    id: 1,
    name: 'Crimson Red',
    symbol: '●',
    primaryHex: '#F42C38',
    highlightHex: '#FF7A72',
    lipHex: '#A8141E',
    highContrastPrimaryHex: '#E11D48',
    highContrastLipHex: '#881337',
    rgb: [0.957, 0.173, 0.22],
    hcRgb: [0.882, 0.114, 0.282],
  },
  2: {
    id: 2,
    name: 'Cobalt Blue',
    symbol: '▲',
    primaryHex: '#2074F8',
    highlightHex: '#6AB3FF',
    lipHex: '#0F4CAC',
    highContrastPrimaryHex: '#2563EB',
    highContrastLipHex: '#1E3A8A',
    rgb: [0.125, 0.455, 0.973],
    hcRgb: [0.145, 0.388, 0.922],
  },
  3: {
    id: 3,
    name: 'Emerald Green',
    symbol: '■',
    primaryHex: '#24C254',
    highlightHex: '#6EE799',
    lipHex: '#147A31',
    highContrastPrimaryHex: '#16A34A',
    highContrastLipHex: '#14532D',
    rgb: [0.141, 0.761, 0.329],
    hcRgb: [0.086, 0.639, 0.29],
  },
  4: {
    id: 4,
    name: 'Sunny Yellow',
    symbol: '★',
    primaryHex: '#FFC400',
    highlightHex: '#FFE570',
    lipHex: '#B88600',
    highContrastPrimaryHex: '#FACC15',
    highContrastLipHex: '#854D0E',
    rgb: [1.0, 0.769, 0.0],
    hcRgb: [0.98, 0.8, 0.082],
  },
  5: {
    id: 5,
    name: 'Royal Purple',
    symbol: '◆',
    primaryHex: '#9B51E0',
    highlightHex: '#C48AF5',
    lipHex: '#5E239D',
    highContrastPrimaryHex: '#7C3AED',
    highContrastLipHex: '#4C1D95',
    rgb: [0.608, 0.318, 0.878],
    hcRgb: [0.486, 0.227, 0.929],
  },
  6: {
    id: 6,
    name: 'Tangerine Orange',
    symbol: '✚',
    primaryHex: '#FF7315',
    highlightHex: '#FFAE66',
    lipHex: '#B84300',
    highContrastPrimaryHex: '#F97316',
    highContrastLipHex: '#9A3412',
    rgb: [1.0, 0.451, 0.082],
    hcRgb: [0.976, 0.451, 0.086],
  },
  7: {
    id: 7,
    name: 'Electric Cyan',
    symbol: '⬢',
    primaryHex: '#06C4D8',
    highlightHex: '#74F2F2',
    lipHex: '#007C8C',
    highContrastPrimaryHex: '#22D3EE',
    highContrastLipHex: '#155E75',
    rgb: [0.024, 0.769, 0.847],
    hcRgb: [0.133, 0.827, 0.933],
  },
  8: {
    id: 8,
    name: 'Bubblegum Pink',
    symbol: '♥',
    primaryHex: '#F84E9E',
    highlightHex: '#FF99C8',
    lipHex: '#AD1C62',
    highContrastPrimaryHex: '#F472B6',
    highContrastLipHex: '#831843',
    rgb: [0.973, 0.306, 0.62],
    hcRgb: [0.957, 0.447, 0.714],
  },
  9: {
    id: 9,
    name: 'Chartreuse Lime',
    symbol: '═',
    primaryHex: '#8CE014',
    highlightHex: '#BDF56E',
    lipHex: '#528A04',
    highContrastPrimaryHex: '#A3E635',
    highContrastLipHex: '#3F6212',
    rgb: [0.549, 0.878, 0.078],
    hcRgb: [0.639, 0.902, 0.208],
  },
};

export type AxisLock = 'NONE' | 'H' | 'V';
export type EdgeDir = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';
export type PlayMode = 'ZEN' | 'TIMED';
export type BoosterType = 'UNDO' | 'FREEZE' | 'HAMMER' | 'ROCKET' | 'VACUUM';
export type InputMode = 'DRAG' | 'TARGET_HAMMER' | 'TARGET_ROCKET' | 'TARGET_VACUUM';
export type RocketAxis = 'ROW' | 'COL';
export type QualityTier = 'AUTO' | 'ULTRA_120' | 'BALANCED_60';

export type SkinId = 'classic_studs' | 'smooth_bevel' | 'gummy_jelly' | 'carved_wood' | 'neon_cyber';
export type TrayId = 'industrial_slate' | 'warm_birch' | 'midnight_arcade' | 'frosted_quartz' | 'mint_studio';
export type ParticleStyleId = 'micro_cubes' | 'star_confetti' | 'pixel_sparks' | 'soap_bubbles' | 'lightning_bolts';

export interface BlockState {
  id: number;
  shapeId: string;
  /** Integer grid coordinates (top-left of shape bounding box) */
  row: number;
  col: number;
  /** Continuous floating-point world coordinates during drag/snap */
  x: number;
  y: number;
  /** Visual lift (0 = resting, 1 = fully lifted +0.35Z) */
  liftAlpha: number;
  /** Active color stack: index [colorCursor] is outer/active color; last index is inner core */
  colorStack: ColorId[];
  colorCursor: number;
  axisLock: AxisLock;
  /** Ice countdown (0 = thawed) */
  iceCount: number;
  /** Star block (can only exit matching Star Gate) */
  isStar: boolean;
  /** Chained/padlocked (unlocked by Key of matching lockId, or any Key if lockId=1) */
  chained: boolean;
  lockId: number;
  /** Carries a Key that unlocks chained blocks with matching lockId */
  hasKey: number;
  /** Bomb countdown: seconds in TIMED mode, moves in ZEN mode (0 = not a bomb) */
  bombCount: number;
  bombMax: number;
  /** Combined / Glued group ID (0 = independent; >0 = moves as rigid assembly with siblings sharing groupId) */
  groupId: number;
  /** Colored rope tying the block in place (0 = none; 1..9 = rope ColorId) */
  ropeColor: ColorId;
  /** Colored scissors carried by this block (0 = none; 1..9 = cuts ropes of scissorColor) */
  scissorColor: ColorId;
  /** Carries a Shutter Gem that opens locked shutter gates of matching gemColor */
  shutterGemColor: ColorId;
  /** Lifecycle status */
  status: 'ACTIVE' | 'SHREDDING' | 'CLEARED';
  shredGateIndex: number;
  shredProgress: number;
  reboundTimerMs: number;
}

export interface GateState {
  index: number;
  edge: EdgeDir;
  /** Start row (for LEFT/RIGHT) or start col (for TOP/BOTTOM), inclusive */
  spanStart: number;
  /** Length in grid cells (1..4) */
  spanLength: number;
  /** Queue of active colors; index [colorCursor] is front color */
  colorQueue: ColorId[];
  colorCursor: number;
  isStar: boolean;
  /** Frozen gate counter (0 = thawed) */
  iceCount: number;
  /** Locked shutter color (0 = unlocked; 1..9 = requires shutterGemColor clear) */
  shutterLockColor: ColorId;
  /** Toggling shutter gate: flips open <-> closed after every clear */
  togglesOnClear: boolean;
  shutterOpen: boolean;
  /** Sliding / Size-changing gate parameters */
  slidesOnClear: boolean;
  slideMin: number;
  slideMax: number;
  slideDir: 1 | -1;
  sizeChangesOnClear: boolean;
  minLength: number;
  maxLength: number;
  sizeDir: 1 | -1;
  /** Visual roller animation angle */
  rollerPhase: number;
}

export interface CrateState {
  id: number;
  row: number;
  col: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface GeneratorSpecBlock {
  shapeId: string;
  colorStack: ColorId[];
  axisLock?: AxisLock;
  isStar?: boolean;
  hasKey?: number;
  scissorColor?: ColorId;
  shutterGemColor?: ColorId;
}

export interface GeneratorState {
  id: number;
  /** Wall edge or interior spawner coordinates */
  row: number;
  col: number;
  spawnRow: number;
  spawnCol: number;
  cooldown: number;
  maxCooldown: number;
  queue: GeneratorSpecBlock[];
  queueCursor: number;
  state: 'COUNTING' | 'READY_TO_SPAWN' | 'DEPLETED';
}

export interface ElevatorState {
  id: number;
  row: number;
  col: number;
  width: number;
  height: number;
  deltaRow: number;
  deltaCol: number;
  atAlternatePos: boolean;
}

export interface BoardState {
  levelId: number;
  name: string;
  difficulty: 'NORMAL' | 'HARD' | 'SUPER_HARD';
  rows: number;
  cols: number;
  /** 81-element flat occupancy: 0=empty, -1=cutout, -2=pillar, -100-id=crate, >0=blockId */
  occupancy: Int16Array;
  /** 81-element colorful floor path: 0=normal floor, 1..9=restricted to ColorId */
  floorColor: Uint8Array;
  blocks: BlockState[];
  gates: GateState[];
  crates: CrateState[];
  generators: GeneratorState[];
  elevators: ElevatorState[];
  parMoves: number;
  timeLimitSec: number;
  timeRemainingSec: number;
  freezeRemainingSec: number;
  timerRunning: boolean;
  movesCommitted: number;
  sessionBlocksShredded: number;
  nextDynamicBlockId: number;
  hintMove: { blockId: number; targetRow: number; targetCol: number; exitsGateIndex: number } | null;
}

export interface LevelSpec {
  id: number;
  name: string;
  difficulty: 'NORMAL' | 'HARD' | 'SUPER_HARD';
  unlockNote?: string;
  rows: number;
  cols: number;
  cutouts?: Array<[number, number]>;
  pillars?: Array<[number, number]>;
  floorPaths?: Array<{ row: number; col: number; color: ColorId }>;
  blocks: Array<{
    id: number;
    shapeId: string;
    row: number;
    col: number;
    colorStack: ColorId[];
    axisLock?: AxisLock;
    iceCount?: number;
    isStar?: boolean;
    chained?: boolean;
    lockId?: number;
    hasKey?: number;
    bombCount?: number;
    groupId?: number;
    ropeColor?: ColorId;
    scissorColor?: ColorId;
    shutterGemColor?: ColorId;
  }>;
  gates: Array<{
    edge: EdgeDir;
    spanStart: number;
    spanLength: number;
    colorQueue: ColorId[];
    isStar?: boolean;
    iceCount?: number;
    shutterLockColor?: ColorId;
    togglesOnClear?: boolean;
    shutterOpen?: boolean;
    slidesOnClear?: boolean;
    slideMin?: number;
    slideMax?: number;
    slideDir?: 1 | -1;
    sizeChangesOnClear?: boolean;
    minLength?: number;
    maxLength?: number;
  }>;
  crates?: Array<{ id: number; row: number; col: number; hp: number }>;
  generators?: Array<{
    id: number;
    row: number;
    col: number;
    spawnRow: number;
    spawnCol: number;
    cooldown: number;
    queue: GeneratorSpecBlock[];
  }>;
  elevators?: Array<{
    id: number;
    row: number;
    col: number;
    width: number;
    height: number;
    deltaRow: number;
    deltaCol: number;
  }>;
  parMoves?: number;
  timeLimitSec?: number;
}

export interface LevelRecord {
  stars: number; // 0 = skipped, 1..3 = earned stars
  bestMoves: number;
  bestTimeSec: number;
  skipped?: boolean;
}

export interface SavePayloadV1 {
  schemaVersion: 1;
  appId: 'shredblocks-color-jam';
  writeSeq: number;
  updatedAt: number;
  highestLevelUnlocked: number;
  currentLevelId: number;
  coins: number;
  totalStars: number;
  winStreak: number;
  bestWinStreak: number;
  totalBlocksShredded: number;
  totalMovesCommitted: number;
  shredderChestProgress: number;
  milestoneChestLevel: number;
  boosters: Record<BoosterType, number>;
  unlockedSkins: SkinId[];
  unlockedTrays: TrayId[];
  unlockedParticles: ParticleStyleId[];
  equippedSkin: SkinId;
  equippedTray: TrayId;
  equippedParticle: ParticleStyleId;
  settings: {
    playMode: PlayMode;
    sfxEnabled: boolean;
    musicEnabled: boolean;
    hapticsEnabled: boolean;
    colorblindSymbols: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
    qualityTier: QualityTier;
  };
  levelRecords: Record<number, LevelRecord>;
}

export interface PerfTelemetry {
  fps: number;
  avgWorkMs: number;
  p95WorkMs: number;
  p99WorkMs: number;
  maxWorkMs: number;
  activeTier: 'ULTRA_120' | 'BALANCED_60';
  rendererBackend: 'WEBGPU' | 'WEBGL2' | 'CANVAS2D';
  activeParticles: number;
  dpr: number;
}

export interface Benchmark120HzResult {
  framesExecuted: number;
  avgWorkMs: number;
  p95WorkMs: number;
  p99WorkMs: number;
  maxWorkMs: number;
  passes120HzBudget: boolean;
  passes60HzBudget: boolean;
}
