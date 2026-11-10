import type { CourtyardLayoutId, LevelSpec } from '../core/types';

export const MAX_MODIFIERS_PER_BLOCK = 2;

/**
 * Deterministic 32-bit PRNG (`mulberry32`).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 10-Level Sawtooth Difficulty Curve:
 * - Level % 10 === 5 or 9 -> 'HARD'
 * - Level % 10 === 0 -> 'SUPER_HARD'
 * - Otherwise -> 'NORMAL'
 */
export function getDifficultyForLevel(levelId: number): 'NORMAL' | 'HARD' | 'SUPER_HARD' {
  const mod = ((levelId % 10) + 10) % 10;
  if (mod === 0) return 'SUPER_HARD';
  if (mod === 5 || mod === 9) return 'HARD';
  return 'NORMAL';
}

/**
 * Counts how many distinct obstacle modifiers are attached to a single block (`UX-03`).
 */
export function countBlockModifiers(block: LevelSpec['blocks'][number]): number {
  let count = 0;
  if (block.axisLock && block.axisLock !== 'NONE') count++;
  if (block.colorStack.length > 1) count++;
  if (block.iceCount && block.iceCount > 0) count++;
  if (block.isStar) count++;
  if (block.chained) count++;
  if (block.hasKey && block.hasKey > 0) count++;
  if (block.bombCount && block.bombCount > 0) count++;
  if (block.groupId && block.groupId > 0) count++;
  if (block.ropeColor && block.ropeColor > 0) count++;
  if (block.scissorColor && block.scissorColor > 0) count++;
  if (block.shutterGemColor && block.shutterGemColor > 0) count++;
  return count;
}

export function countBlockImmobilizers(block: LevelSpec['blocks'][number]): number {
  let count = 0;
  if (block.iceCount && block.iceCount > 0) count++;
  if (block.chained) count++;
  if (block.ropeColor && block.ropeColor > 0) count++;
  return count;
}

export function countBlockCenterPayloads(block: LevelSpec['blocks'][number]): number {
  let count = 0;
  if (block.isStar) count++;
  if (block.hasKey && block.hasKey > 0) count++;
  if (block.bombCount && block.bombCount > 0) count++;
  if (block.scissorColor && block.scissorColor > 0) count++;
  if (block.shutterGemColor && block.shutterGemColor > 0) count++;
  return count;
}

export function canAddBlockModifier(
  block: LevelSpec['blocks'][number],
  kind: 'IMMOBILIZER' | 'PAYLOAD' | 'OTHER'
): boolean {
  const maxMods = block.shapeId === '1x1' ? 1 : MAX_MODIFIERS_PER_BLOCK;
  if (countBlockModifiers(block) >= maxMods) return false;
  if (kind === 'IMMOBILIZER') {
    if (countBlockImmobilizers(block) >= 1) return false;
    if (block.bombCount && block.bombCount > 0) return false;
  }
  if (kind === 'PAYLOAD') {
    if (countBlockCenterPayloads(block) >= 1) return false;
  }
  return true;
}

export const LEVEL_ADJECTIVES = [
  'Prism',
  'Kinetic',
  'Velvet',
  'Neon',
  'Crystal',
  'Cobalt',
  'Crimson',
  'Emerald',
  'Solar',
  'Quantum',
  'Chromatic',
  'Turbo',
  'Cascade',
  'Vortex',
  'Zenith',
  'Apex',
  'Hyper',
  'Stellar',
  'Radiant',
  'Clockwork',
];

export const LEVEL_NOUNS = [
  'Shift',
  'Loom',
  'Matrix',
  'Conduit',
  'Junction',
  'Vault',
  'Grid',
  'Chamber',
  'Corridor',
  'Shredder',
  'Gateway',
  'Relay',
  'Foundry',
  'Nexus',
  'Lockbox',
  'Carousel',
  'Turbine',
  'Crucible',
  'Citadel',
  'Odyssey',
];

export const NIMBLE_SHAPES = ['1x1', '1x2', '2x1', 'L3_BL', 'L3_TL', 'L3_TR', 'L3_BR'];
export const EARLY_SHAPES = ['1x1', '1x2', '2x1', '1x3', '3x1', 'L3_BL', 'L3_TL', 'L3_TR', 'L3_BR', '2x2'];
export const MID_SHAPES = [
  ...EARLY_SHAPES,
  'L4_0',
  'L4_90',
  'L4_180',
  'L4_270',
  'J4_0',
  'J4_90',
  'T4_D',
  'T4_U',
  'T4_R',
  'T4_L',
];
export const LATE_SHAPES = [...MID_SHAPES, 'S4_H', 'Z4_H', 'U5_U', 'U5_D'];

export type MechanicId =
  | 'NONE'
  | 'AXIS_LOCK'
  | 'CUTOUTS_PILLARS'
  | 'MULTI_LAYER'
  | 'ICE_BLOCKS'
  | 'STAR'
  | 'KEY_LOCK'
  | 'STONE'
  | 'CRATES'
  | 'BOMBS'
  | 'GLUED'
  | 'ROPES'
  | 'COLOR_QUEUE_GATES'
  | 'FROZEN_GATES'
  | 'SHUTTER_LOCK'
  | 'TOGGLING_GATE'
  | 'SLIDING_GATE'
  | 'SIZE_CHANGING_GATE'
  | 'GENERATORS'
  | 'FLOOR_PATHS'
  | 'ELEVATORS';

const HARMONIOUS_SECONDARY_POOL: MechanicId[] = [
  'AXIS_LOCK',
  'MULTI_LAYER',
  'ICE_BLOCKS',
  'STAR',
  'CUTOUTS_PILLARS',
  'COLOR_QUEUE_GATES',
];

const MASTERY_PRIMARY_POOL: MechanicId[] = [
  'AXIS_LOCK',
  'CUTOUTS_PILLARS',
  'MULTI_LAYER',
  'ICE_BLOCKS',
  'STAR',
  'KEY_LOCK',
  'STONE',
  'CRATES',
  'BOMBS',
  'GLUED',
  'ROPES',
  'COLOR_QUEUE_GATES',
  'FROZEN_GATES',
  'SHUTTER_LOCK',
  'TOGGLING_GATE',
  'SLIDING_GATE',
  'SIZE_CHANGING_GATE',
  'GENERATORS',
  'FLOOR_PATHS',
  'ELEVATORS',
];

export function selectFocusedMechanicsForLevel(levelId: number): Set<MechanicId> {
  const active = new Set<MechanicId>();
  if (levelId <= 10) return active;

  const decPos = levelId % 10; // 1..9, 0
  const isBreatherOrOnboardingWave = (levelId <= 185 && decPos === 1) || decPos === 6;

  let primary: MechanicId = 'NONE';
  if (levelId <= 20) primary = 'AXIS_LOCK';
  else if (levelId <= 30) primary = 'CUTOUTS_PILLARS';
  else if (levelId <= 40) primary = 'MULTI_LAYER';
  else if (levelId <= 50) primary = 'ICE_BLOCKS';
  else if (levelId <= 60) primary = 'STAR';
  else if (levelId <= 70) primary = 'KEY_LOCK';
  else if (levelId <= 80) primary = 'STONE';
  else if (levelId <= 90) primary = 'CRATES';
  else if (levelId <= 100) primary = 'BOMBS';
  else if (levelId <= 110) primary = 'GLUED';
  else if (levelId <= 120) primary = 'ROPES';
  else if (levelId <= 130) primary = 'COLOR_QUEUE_GATES';
  else if (levelId <= 140) primary = 'FROZEN_GATES';
  else if (levelId <= 144 || (levelId >= 147 && levelId <= 148)) primary = 'SHUTTER_LOCK';
  else if (levelId <= 150) primary = 'TOGGLING_GATE';
  else if (levelId <= 154 || (levelId >= 157 && levelId <= 158)) primary = 'SLIDING_GATE';
  else if (levelId <= 160) primary = 'SIZE_CHANGING_GATE';
  else if (levelId <= 170) primary = 'GENERATORS';
  else if (levelId <= 180) primary = 'FLOOR_PATHS';
  else if (levelId <= 200) primary = 'ELEVATORS';
  else {
    // Mastery Epochs (201+): Only the single decade breather (mod 6) uses the flow-state pool; others cycle all 20
    if (decPos === 6) {
      primary = HARMONIOUS_SECONDARY_POOL[levelId % HARMONIOUS_SECONDARY_POOL.length];
    } else {
      primary = MASTERY_PRIMARY_POOL[levelId % MASTERY_PRIMARY_POOL.length];
    }
  }

  if (primary !== 'NONE') active.add(primary);

  // `RAMP-01`: During onboarding/breather waves (`mod 1, 2, 3, 4, 6`), focus 100% on the primary mechanic!
  // On late-decade / peak waves (`mod 5, 7, 8, 9, 0`) from L35+, pair with at most 1 harmonious secondary mechanic.
  const highFrictionPrimaries = new Set<MechanicId>([
    'BOMBS',
    'GENERATORS',
    'TOGGLING_GATE',
    'SLIDING_GATE',
    'SIZE_CHANGING_GATE',
  ]);
  if (levelId >= 35 && !isBreatherOrOnboardingWave && (!highFrictionPrimaries.has(primary) || decPos === 0)) {
    const unlockedSecondaries = HARMONIOUS_SECONDARY_POOL.filter((m) => {
      if (m === primary) return false;
      if (m === 'AXIS_LOCK') return levelId > 20;
      if (m === 'CUTOUTS_PILLARS') return levelId > 30 && primary !== 'ELEVATORS' && primary !== 'GENERATORS';
      if (m === 'MULTI_LAYER') return levelId > 40;
      if (m === 'ICE_BLOCKS') return levelId > 50 && primary !== 'BOMBS';
      if (m === 'STAR') return levelId > 60 && primary !== 'TOGGLING_GATE';
      if (m === 'COLOR_QUEUE_GATES')
        return levelId > 130 && primary !== 'SLIDING_GATE' && primary !== 'SIZE_CHANGING_GATE';
      return false;
    });
    if (unlockedSecondaries.length > 0) {
      const sec = unlockedSecondaries[(levelId * 3) % unlockedSecondaries.length];
      active.add(sec);
    }
  }

  return active;
}

export function selectCourtyardTopologyForLevel(
  levelId: number,
  rows: number,
  cols: number,
  attempt: number,
  activeMechanics: Set<MechanicId>
): CourtyardLayoutId {
  if (levelId < 14 || attempt >= 2) return 'RECTANGLE';

  const canUseSanctumOrVault =
    !activeMechanics.has('ELEVATORS') &&
    !activeMechanics.has('GENERATORS') &&
    !activeMechanics.has('GLUED') &&
    !activeMechanics.has('SLIDING_GATE') &&
    !activeMechanics.has('SIZE_CHANGING_GATE');

  if (
    levelId >= 28 &&
    (levelId % 7 === 0 || levelId % 10 === 4 || levelId % 10 === 8) &&
    rows >= 7 &&
    cols >= 6 &&
    canUseSanctumOrVault
  ) {
    return 'MYSTERY_VAULT';
  }

  if (levelId >= 25 && (levelId % 6 === 0 || levelId % 9 === 0) && rows >= 7 && canUseSanctumOrVault) {
    return 'TWIN_SANCTUM';
  }

  if (levelId % 2 === 0 || levelId % 5 === 0 || activeMechanics.has('CUTOUTS_PILLARS')) {
    if (rows >= 8 && cols >= 8 && levelId % 4 === 0) {
      return 'CITADEL_OCTAGON';
    }
    const pool: CourtyardLayoutId[] = [
      'CROSS_ATRIUM',
      'L_WING',
      'T_PAVILION',
      'HOURGLASS_BRIDGE',
      'H_SANCTUM',
    ];
    return pool[Math.floor(levelId / 2) % pool.length];
  }

  return 'RECTANGLE';
}

export function getUnlockNoteForLevel(levelId: number): string | undefined {
  switch (levelId) {
    case 1:
      return 'Drag blocks into matching color shredder gates!';
    case 11:
      return 'New Obstacle: Axis-Locked Blocks slide only along their arrow axis.';
    case 21:
      return 'New Obstacle: Corner Cutouts & Interior Stone Pillars reshape the board.';
    case 31:
      return 'New Obstacle: Multi-Layer Blocks peel their outer shell to reveal an inner core.';
    case 41:
      return 'New Obstacle: Frozen Ice Blocks thaw by 1 with every block shredded.';
    case 51:
      return 'New Obstacle: Star Blocks can only exit through matching Star Gates.';
    case 61:
      return 'New Obstacle: Padlocked Chained Blocks unlock when a Key Block is shredded.';
    case 71:
      return 'New Obstacle: Charcoal Stone Blocks never shred—slide them out of the way!';
    case 81:
      return 'New Obstacle: Wooden Crates crack when adjacent blocks shred.';
    case 91:
      return 'New Obstacle: Time-Bomb Blocks must be shredded before their countdown hits 0!';
    case 101:
      return 'New Obstacle: Glued Blocks move together as a rigid linked assembly.';
    case 111:
      return 'New Obstacle: Colored Ropes untie when matching Colored Scissors are shredded.';
    case 121:
      return 'New Obstacle: Color-Changing Gates cycle to the next color in their queue.';
    case 131:
      return 'New Obstacle: Frozen Gates thaw as blocks shred through other gates.';
    case 141:
      return 'New Obstacle: Locked Shutter Gates open when a matching Shutter Gem is shredded.';
    case 145:
      return 'New Obstacle: Toggling Shutter Gates flip closed after a block exits.';
    case 151:
      return 'New Obstacle: Sliding Gates shift along the wall after each shred.';
    case 155:
      return 'New Obstacle: Size-Changing Gates expand and contract after each shred.';
    case 161:
      return 'New Obstacle: Block Generators spawn queued blocks onto the board.';
    case 171:
      return 'New Obstacle: Colorful Floor Paths only allow matching color blocks to cross.';
    case 181:
      return 'New Obstacle: Moving Elevators shift fully contained blocks after each shred.';
    case 200:
      return 'Epoch IV Complete: Enter the Grand Citadel Masterworks (Levels 201–300)!';
    case 201:
      return 'Epoch V — Grand Citadel: Expanded 8×8 Courtyards & multi-mechanic combos.';
    case 250:
      return 'Epoch V Finale: Master the 8×8 Grand Citadel Courtyard!';
    case 251:
      return 'Epoch VI — Sacred Astrolabe: 9×9 Sanctuary synthesis puzzles.';
    case 300:
      return 'Campaign Finale (Level 300): Conquer the 9×9 Sacred Astrolabe Sanctuary!';
    default:
      return undefined;
  }
}
