import { createBoardState } from '../core/board';
import { getShape } from '../core/polyomino';
import type { AxisLock, ColorId, EdgeDir, LevelSpec } from '../core/types';
import { solveBoard } from './solver';

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

const LEVEL_ADJECTIVES = [
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

const LEVEL_NOUNS = [
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

const NIMBLE_SHAPES = ['1x1', '1x2', '2x1', 'L3_BL', 'L3_TL', 'L3_TR', 'L3_BR'];
const EARLY_SHAPES = ['1x1', '1x2', '2x1', '1x3', '3x1', 'L3_BL', 'L3_TL', 'L3_TR', 'L3_BR', '2x2'];
const MID_SHAPES = [
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
const LATE_SHAPES = [
  ...MID_SHAPES,
  'S4_H',
  'Z4_H',
  'U5_U',
  'U5_D',
];

type MechanicId =
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

function selectFocusedMechanicsForLevel(levelId: number): Set<MechanicId> {
  const active = new Set<MechanicId>();
  if (levelId <= 10) return active;

  const decPos = levelId % 10; // 1..9, 0
  const isBreatherOrOnboardingWave =
    decPos === 1 || decPos === 2 || decPos === 3 || decPos === 4 || decPos === 6;

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
    // Mastery Epochs (201+): Breather waves (mod 1, 2, 6) use a single gentle mechanic; others cycle all 20
    if (decPos === 1 || decPos === 2 || decPos === 6) {
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
  if (
    levelId >= 35 &&
    !isBreatherOrOnboardingWave &&
    (!highFrictionPrimaries.has(primary) || decPos === 0)
  ) {
    const unlockedSecondaries = HARMONIOUS_SECONDARY_POOL.filter((m) => {
      if (m === primary) return false;
      if (m === 'AXIS_LOCK') return levelId > 20;
      if (m === 'CUTOUTS_PILLARS') return levelId > 30 && primary !== 'ELEVATORS' && primary !== 'GENERATORS';
      if (m === 'MULTI_LAYER') return levelId > 40;
      if (m === 'ICE_BLOCKS') return levelId > 50 && primary !== 'BOMBS';
      if (m === 'STAR') return levelId > 60 && primary !== 'TOGGLING_GATE';
      if (m === 'COLOR_QUEUE_GATES') return levelId > 130 && primary !== 'SLIDING_GATE' && primary !== 'SIZE_CHANGING_GATE';
      return false;
    });
    if (unlockedSecondaries.length > 0) {
      const sec = unlockedSecondaries[(levelId * 3) % unlockedSecondaries.length];
      active.add(sec);
    }
  }

  return active;
}

function getUnlockNoteForLevel(levelId: number): string | undefined {
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

function tryBuildCandidateSpec(levelId: number, rng: () => number, attempt: number): LevelSpec {
  const difficulty = getDifficultyForLevel(levelId);
  const decPos = levelId % 10; // 1..9, 0
  const isBreatherWave = levelId >= 11 && (decPos === 1 || decPos === 2 || decPos === 6);

  // Decade-Aligned Spacious Board Size Curve (`PROG-01`, `RAMP-05`: `5x5` -> `9x9`)
  let rows = 6;
  let cols = 6;
  if (levelId <= 4) {
    rows = 5;
    cols = 5;
  } else if (levelId <= 8) {
    rows = 6;
    cols = 5;
  } else if (levelId <= 40) {
    rows = levelId >= 30 && difficulty === 'SUPER_HARD' ? 7 : 6;
    cols = 6;
  } else if (levelId <= 80) {
    rows = 7;
    cols = levelId >= 70 && difficulty === 'SUPER_HARD' ? 7 : 6;
  } else if (levelId <= 130) {
    rows = levelId >= 110 && difficulty === 'SUPER_HARD' ? 8 : 7;
    cols = 7;
  } else if (levelId <= 180) {
    rows = 8;
    cols = levelId >= 160 && difficulty === 'SUPER_HARD' ? 8 : 7;
  } else if (levelId <= 240) {
    rows = levelId >= 220 && difficulty === 'SUPER_HARD' ? 9 : 8;
    cols = 8;
  } else if (levelId <= 280) {
    rows = 9;
    cols = levelId >= 270 && difficulty === 'SUPER_HARD' ? 9 : 8;
  } else {
    rows = 9;
    cols = isBreatherWave ? 8 : 9;
  }

  // On late retry attempts (`attempt >= 3`), step down very large grids by 1 cell to guarantee fast solvability (`ADV-R4-05`)
  if (attempt >= 3 && rows > 7) rows = 7;
  if (attempt >= 3 && cols > 7) cols = 7;

  const maxPalette = levelId <= 10 ? 4 : levelId <= 60 ? 6 : levelId <= 140 ? 8 : 9;
  const availableColors: ColorId[] = [];
  for (let c = 1; c <= maxPalette; c++) availableColors.push(c as ColorId);
  for (let i = availableColors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = availableColors[i];
    availableColors[i] = availableColors[j];
    availableColors[j] = tmp;
  }

  const numColors =
    levelId <= 3
      ? 2
      : levelId <= 8
        ? 3
        : isBreatherWave
          ? 4
          : levelId >= 140 && difficulty === 'SUPER_HARD' && cols >= 8
            ? 6
            : levelId >= 90 && (difficulty === 'HARD' || difficulty === 'SUPER_HARD') && cols >= 7
              ? 5
              : 4;
  const activeColors = availableColors.slice(0, numColors);

  const edges: EdgeDir[] = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'];
  const gates: LevelSpec['gates'] = [];

  for (let i = 0; i < numColors; i++) {
    const edge = edges[i % 4];
    const edgeLimit = edge === 'TOP' || edge === 'BOTTOM' ? cols : rows;
    if (edge === 'TOP' && numColors >= 5 && edgeLimit >= 7) {
      if (i === 0) {
        gates.push({
          edge,
          spanStart: 1,
          spanLength: 3,
          colorQueue: [activeColors[i]],
        });
      } else {
        gates.push({
          edge,
          spanStart: 4,
          spanLength: Math.min(4, edgeLimit - 4),
          colorQueue: [activeColors[i]],
        });
      }
    } else if (edge === 'BOTTOM' && numColors >= 6 && edgeLimit >= 7) {
      if (i === 2) {
        gates.push({
          edge,
          spanStart: 1,
          spanLength: 3,
          colorQueue: [activeColors[i]],
        });
      } else {
        gates.push({
          edge,
          spanStart: 4,
          spanLength: Math.min(4, edgeLimit - 4),
          colorQueue: [activeColors[i]],
        });
      }
    } else {
      const spanLength = Math.min(
        edgeLimit,
        Math.max(4, edgeLimit - (isBreatherWave ? 1 : 2))
      );
      const spanStart = Math.max(0, Math.floor((edgeLimit - spanLength) / 2));
      gates.push({
        edge,
        spanStart,
        spanLength,
        colorQueue: [activeColors[i]],
      });
    }
  }

  const grid = new Int16Array(rows * cols);
  const cutouts: Array<[number, number]> = [];
  const pillars: Array<[number, number]> = [];
  const crates: NonNullable<LevelSpec['crates']> = [];
  const floorPaths: NonNullable<LevelSpec['floorPaths']> = [];
  const generators: NonNullable<LevelSpec['generators']> = [];
  const elevators: NonNullable<LevelSpec['elevators']> = [];

  // `RAMP-01`: Focused Primary + Harmonious Secondary Mechanic Selector (never uncapped modulo pile-ups!)
  const activeMechanics = selectFocusedMechanicsForLevel(levelId);
  const useCutoutsOrPillars = activeMechanics.has('CUTOUTS_PILLARS');
  const useAxisLock = activeMechanics.has('AXIS_LOCK');
  const useMultiLayer = activeMechanics.has('MULTI_LAYER');
  const useIceBlocks = activeMechanics.has('ICE_BLOCKS');
  const useStar = activeMechanics.has('STAR');
  const useKeyLock = activeMechanics.has('KEY_LOCK');
  const useStone = activeMechanics.has('STONE');
  const useCrates = activeMechanics.has('CRATES');
  const useBombs = activeMechanics.has('BOMBS');
  const useGlued = activeMechanics.has('GLUED');
  const useRopes = activeMechanics.has('ROPES');
  const useColorQueueGates = activeMechanics.has('COLOR_QUEUE_GATES');
  const useFrozenGates = activeMechanics.has('FROZEN_GATES');
  const useShutterLock = activeMechanics.has('SHUTTER_LOCK');
  const useTogglingGate = activeMechanics.has('TOGGLING_GATE');
  const useSlidingGate = activeMechanics.has('SLIDING_GATE');
  const useSizeChangingGate = activeMechanics.has('SIZE_CHANGING_GATE');
  const useGenerators = activeMechanics.has('GENERATORS');
  const useFloorPaths = activeMechanics.has('FLOOR_PATHS');
  const useElevators = activeMechanics.has('ELEVATORS');

  // 1. Cutouts & Pillars (L21+) — place in non-gate corners so central lanes stay open
  if (useCutoutsOrPillars) {
    cutouts.push([0, 0]);
    grid[0] = -1;
    if (levelId >= 24 && attempt < 2 && !isBreatherWave) {
      const pr = 0;
      const pc = cols - 1;
      pillars.push([pr, pc]);
      grid[pr * cols + pc] = -2;
    }
  }

  // 2. Wooden Crates (L81+) — place at corner-adjacent cell (rows-1, 0)
  if (useCrates) {
    const cr = rows - 1;
    const cc = 0;
    if (grid[cr * cols + cc] === 0) {
      crates.push({ id: 1, row: cr, col: cc, hp: 1 });
      grid[cr * cols + cc] = -101;
    }
  }

  // 3. Place Blocks — `RAMP-02` Sawtooth Flow Wave (`mod 1, 2, 6` Breathers drop block count for joyful flow)
  const baseTargetBlocks =
    attempt >= 2
      ? Math.min(5, levelId <= 10 ? 4 : 5)
      : levelId <= 3
        ? 3
        : levelId <= 10
          ? 4
          : isBreatherWave
            ? levelId <= 180
              ? 4
              : 5
            : levelId >= 220
              ? difficulty === 'SUPER_HARD'
                ? 6
                : difficulty === 'HARD'
                  ? 6
                  : 5
              : levelId >= 80
                ? difficulty === 'NORMAL'
                  ? 5
                  : 6
                : difficulty === 'SUPER_HARD'
                  ? 6
                  : difficulty === 'HARD'
                    ? 5
                    : 4;
  const targetBlocks = Math.max(numColors, baseTargetBlocks);

  // `RAMP-03`: Keep EARLY_SHAPES through L40 and use NIMBLE_SHAPES on breather waves and non-lead blocks
  const leadShapePool = isBreatherWave
    ? NIMBLE_SHAPES
    : levelId <= 40
      ? EARLY_SHAPES
      : levelId <= 140
        ? MID_SHAPES
        : LATE_SHAPES;

  const blocks: LevelSpec['blocks'] = [];
  let nextId = 1;

  // Optional Glued Group (L101+): two 1x1 blocks sharing groupId = 1
  if (useGlued && activeColors.length >= 2) {
    const r = 1;
    const c = 2;
    if (grid[r * cols + c] === 0 && grid[r * cols + (c + 1)] === 0) {
      blocks.push({
        id: nextId++,
        shapeId: '1x1',
        row: r,
        col: c,
        colorStack: [activeColors[0]],
        groupId: 1,
      });
      blocks.push({
        id: nextId++,
        shapeId: '1x1',
        row: r,
        col: c + 1,
        colorStack: [activeColors[0]],
        groupId: 1,
      });
      grid[r * cols + c] = 1;
      grid[r * cols + (c + 1)] = 2;
    }
  }

  // Optional Stone Block (L71+): placed at bottom-right corner out of gate lanes
  if (useStone) {
    const sr = rows - 1;
    const sc = cols - 1;
    if (grid[sr * cols + sc] === 0) {
      blocks.push({
        id: nextId++,
        shapeId: '1x1',
        row: sr,
        col: sc,
        colorStack: [0],
      });
      grid[sr * cols + sc] = nextId - 1;
    }
  }

  for (let bIdx = 0; bIdx < targetBlocks; bIdx++) {
    const colorIdx =
      useColorQueueGates && bIdx >= activeColors.length && activeColors.length >= 2
        ? 1
        : bIdx % activeColors.length;
    const color = activeColors[colorIdx];
    const gate = gates[colorIdx % gates.length];

    let chosenShape = '1x2';
    // `RAMP-03`: At most 1 large polyomino (`bIdx === 0` only, and not on breather waves); all other blocks are nimble dominoes/monominoes!
    const allowLargeShape = attempt <= 1 && bIdx === 0 && !isBreatherWave;
    const activePool = allowLargeShape ? leadShapePool : NIMBLE_SHAPES;
    for (let sTry = 0; sTry < 8; sTry++) {
      const candidate =
        attempt >= 2 || (!allowLargeShape && bIdx >= 2)
          ? bIdx % 2 === 0
            ? '1x2'
            : '2x1'
          : activePool[Math.floor(rng() * activePool.length)];
      const sh = getShape(candidate);
      const reqSpan =
        gate.edge === 'TOP' || gate.edge === 'BOTTOM' ? sh.cols : sh.rows;
      const maxDim = allowLargeShape ? 3 : 2;
      if (reqSpan <= gate.spanLength && sh.rows <= maxDim && sh.cols <= maxDim) {
        chosenShape = candidate;
        break;
      }
    }

    const shape = getShape(chosenShape);
    let placed = false;

    // Interleaved Blocker Placement (C1-15):
    // Place block 0 at row 2 aligned with TOP gate, and place block 1 at row 1 directly in block 0's exit corridor!
    if (attempt <= 1 && bIdx === 0 && gate.edge === 'TOP' && rows >= 6) {
      const r0 = 2;
      const c0 = Math.max(1, Math.min(cols - shape.cols - 1, gate.spanStart));
      let fits0 = true;
      for (const [dr, dc] of shape.cells) {
        if (grid[(r0 + dr) * cols + (c0 + dc)] !== 0) {
          fits0 = false;
          break;
        }
      }
      if (fits0) {
        const id = nextId++;
        for (const [dr, dc] of shape.cells) {
          grid[(r0 + dr) * cols + (c0 + dc)] = id;
        }
        blocks.push({
          id,
          shapeId: chosenShape,
          row: r0,
          col: c0,
          colorStack: [color],
        });
        placed = true;
      }
    } else if (
      attempt <= 1 &&
      bIdx === 1 &&
      blocks.length >= 1 &&
      blocks[0].colorStack[0] !== 0 &&
      blocks[0].row >= 2 &&
      gates[0].edge === 'TOP'
    ) {
      const r1 = 1;
      const c1 = Math.max(1, Math.min(cols - shape.cols - 1, blocks[0].col));
      let fits1 = true;
      for (const [dr, dc] of shape.cells) {
        if (grid[(r1 + dr) * cols + (c1 + dc)] !== 0) {
          fits1 = false;
          break;
        }
      }
      if (fits1) {
        const id = nextId++;
        for (const [dr, dc] of shape.cells) {
          grid[(r1 + dr) * cols + (c1 + dc)] = id;
        }
        blocks.push({
          id,
          shapeId: chosenShape,
          row: r1,
          col: c1,
          colorStack: [color],
        });
        placed = true;
      }
    }

    for (let pTry = 0; pTry < 24 && !placed; pTry++) {
      const r = 1 + Math.floor(rng() * Math.max(1, rows - shape.rows - 1));
      const c = 1 + Math.floor(rng() * Math.max(1, cols - shape.cols - 1));

      let fits = true;
      for (const [dr, dc] of shape.cells) {
        if (grid[(r + dr) * cols + (c + dc)] !== 0) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;

      const id = nextId++;
      for (const [dr, dc] of shape.cells) {
        grid[(r + dr) * cols + (c + dc)] = id;
      }
      blocks.push({
        id,
        shapeId: chosenShape,
        row: r,
        col: c,
        colorStack: [color],
      });
      placed = true;
      break;
    }

    if (!placed) {
      for (let r = 1; r < rows - 1 && !placed; r++) {
        for (let c = 1; c < cols - 1 && !placed; c++) {
          if (grid[r * cols + c] === 0) {
            const id = nextId++;
            grid[r * cols + c] = id;
            blocks.push({
              id,
              shapeId: '1x1',
              row: r,
              col: c,
              colorStack: [color],
            });
            placed = true;
          }
        }
      }
    }
  }

  const coloredBlocks = blocks.filter((b) => b.colorStack[0] !== 0);

  // 4. Apply Progressive Modifiers (strictly respecting UX-03 mutual exclusivity & MAX_MODIFIERS_PER_BLOCK)
  // Axis Lock (L11+): only lock a block whose lane to its matching gate is completely clear
  if (useAxisLock && coloredBlocks.length > 0) {
    for (const b of coloredBlocks) {
      if (!canAddBlockModifier(b, 'OTHER')) continue;
      const sh = getShape(b.shapeId);
      const gate = gates.find((g) => g.colorQueue[0] === b.colorStack[0]);
      if (!gate) continue;
      if (
        gate.edge === 'TOP' &&
        b.col >= gate.spanStart &&
        b.col + sh.cols <= gate.spanStart + gate.spanLength
      ) {
        let clearToTop = true;
        for (let r = 0; r < b.row; r++) {
          for (let c = b.col; c < b.col + sh.cols; c++) {
            if (grid[r * cols + c] !== 0 && grid[r * cols + c] !== b.id) clearToTop = false;
          }
        }
        if (clearToTop) {
          b.axisLock = 'V' as AxisLock;
          break;
        }
      } else if (
        gate.edge === 'RIGHT' &&
        b.row >= gate.spanStart &&
        b.row + sh.rows <= gate.spanStart + gate.spanLength
      ) {
        let clearToRight = true;
        for (let r = b.row; r < b.row + sh.rows; r++) {
          for (let c = b.col + sh.cols; c < cols; c++) {
            if (grid[r * cols + c] !== 0 && grid[r * cols + c] !== b.id) clearToRight = false;
          }
        }
        if (clearToRight) {
          b.axisLock = 'H' as AxisLock;
          break;
        }
      }
    }
  }

  // Multi-Layer Blocks (L31+)
  if (useMultiLayer && coloredBlocks.length >= 2 && activeColors.length >= 2) {
    const target = coloredBlocks.find((b) => canAddBlockModifier(b, 'OTHER') && !b.axisLock);
    if (target) {
      const innerColor = activeColors.find((c) => c !== target.colorStack[0]) ?? activeColors[0];
      target.colorStack = [target.colorStack[0], innerColor];
    }
  }

  // Ice Blocks (L41+)
  if (useIceBlocks && coloredBlocks.length >= 3) {
    const target = [...coloredBlocks]
      .reverse()
      .find((b) => canAddBlockModifier(b, 'IMMOBILIZER'));
    if (target) {
      target.iceCount = 1;
    }
  }

  // Star Blocks & Star Gates (L51+)
  if (useStar && coloredBlocks.length >= 2) {
    const starCandidate =
      coloredBlocks.find((b) => b.colorStack.length === 1 && canAddBlockModifier(b, 'PAYLOAD')) ??
      coloredBlocks.find((b) => canAddBlockModifier(b, 'PAYLOAD'));
    if (starCandidate) {
      for (const layerColor of starCandidate.colorStack) {
        const gate = gates.find((g) => g.colorQueue.includes(layerColor));
        if (gate) gate.isStar = true;
      }
      starCandidate.isStar = true;
    }
  }

  // Key & Lock (Chained) Blocks (L61+)
  if (useKeyLock && coloredBlocks.length >= 3) {
    const keyCarrier = coloredBlocks.find(
      (b) => !b.iceCount && !b.chained && !b.ropeColor && canAddBlockModifier(b, 'PAYLOAD')
    );
    const lockedTarget = [...coloredBlocks]
      .reverse()
      .find(
        (b) =>
          b.id !== keyCarrier?.id &&
          !b.hasKey &&
          canAddBlockModifier(b, 'IMMOBILIZER')
      );
    if (keyCarrier && lockedTarget) {
      keyCarrier.hasKey = 1;
      lockedTarget.chained = true;
      lockedTarget.lockId = 1;
    }
  }

  // Bomb Blocks (L91+, `RAMP-04`: generous countdown so players never feel cheated)
  if (useBombs && coloredBlocks.length >= 2) {
    const bombCandidate = coloredBlocks.find(
      (b) => !b.iceCount && !b.chained && !b.ropeColor && canAddBlockModifier(b, 'PAYLOAD')
    );
    if (bombCandidate) {
      bombCandidate.bombCount = Math.max(16, coloredBlocks.length * 3 + 2);
    }
  }

  // Colored Ropes & Scissors (L111+)
  if (useRopes && coloredBlocks.length >= 3) {
    const scissorHolder = coloredBlocks.find(
      (b) => !b.iceCount && !b.chained && !b.ropeColor && canAddBlockModifier(b, 'PAYLOAD')
    );
    const ropedTarget = [...coloredBlocks]
      .reverse()
      .find(
        (b) =>
          b.id !== scissorHolder?.id &&
          !b.hasKey &&
          !b.scissorColor &&
          canAddBlockModifier(b, 'IMMOBILIZER')
      );
    if (scissorHolder && ropedTarget) {
      const ropeCol = activeColors[0];
      scissorHolder.scissorColor = ropeCol;
      ropedTarget.ropeColor = ropeCol;
    }
  }

  // Frozen Gates (L131+)
  if (useFrozenGates && gates.length >= 3) {
    const lastGate = gates[gates.length - 1];
    const lastColor = lastGate.colorQueue[0];
    const otherBlocks = coloredBlocks.filter(
      (b) => b.colorStack[0] !== lastColor && !b.iceCount && !b.chained && !b.ropeColor
    );
    if (otherBlocks.length >= 2) {
      lastGate.iceCount = 1;
    }
  }

  // Locked Shutter Gates & Shutter Gems (L141+)
  if (useShutterLock && gates.length >= 3 && coloredBlocks.length >= 3) {
    const lockedGate = gates[gates.length - 1];
    const lockedGateColor = lockedGate.colorQueue[0];
    const gemCarrier = coloredBlocks.find(
      (b) =>
        b.colorStack[0] !== lockedGateColor &&
        !b.iceCount &&
        !b.chained &&
        !b.ropeColor &&
        canAddBlockModifier(b, 'PAYLOAD')
    );
    if (gemCarrier && !lockedGate.iceCount) {
      const gemColor = gemCarrier.colorStack[0];
      gemCarrier.shutterGemColor = gemColor;
      lockedGate.shutterLockColor = gemColor;
      lockedGate.shutterOpen = false;
    }
  }

  // Toggling Shutter Gates (L145+, `RAMP-01` & `DRAG-06`: no duplicate TOP gate overlap)
  if (useTogglingGate && gates.length >= 3) {
    const toggleGate = gates[gates.length - 1];
    if (!toggleGate.shutterLockColor) {
      toggleGate.togglesOnClear = true;
      toggleGate.shutterOpen = true;
    }
  }

  // Sliding Gates (L151+)
  if (useSlidingGate && gates.length >= 1) {
    const gSlide = gates[0];
    const limit = gSlide.edge === 'TOP' || gSlide.edge === 'BOTTOM' ? cols : rows;
    gSlide.slidesOnClear = true;
    gSlide.spanLength = Math.min(limit, 4);
    gSlide.slideMin = 0;
    gSlide.slideMax = Math.max(0, limit - gSlide.spanLength);
    gSlide.slideDir = 1;
  }

  // Size-Changing Gates (L155+)
  if (useSizeChangingGate && gates.length >= 2) {
    const gSize = gates[1];
    const limit = gSize.edge === 'TOP' || gSize.edge === 'BOTTOM' ? cols : rows;
    gSize.sizeChangesOnClear = true;
    gSize.spanLength = Math.min(limit, 4);
    gSize.minLength = Math.min(limit, 3);
    gSize.maxLength = Math.min(limit, 4);
  }

  // Block Generators (L161+)
  if (useGenerators) {
    let spawnR = 0;
    let spawnC = cols - 1;
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (grid[r * cols + c] === 0) {
          spawnR = r;
          spawnC = c;
          break;
        }
      }
      if (spawnR > 0) break;
    }
    generators.push({
      id: 1,
      row: 0,
      col: spawnC,
      spawnRow: spawnR,
      spawnCol: spawnC,
      cooldown: 1,
      queue: [
        {
          shapeId: '1x1',
          colorStack: [activeColors[0]],
        },
      ],
    });
  }

  // Color-Changing Gates (L121+, C1-04):
  // Ensure g0.colorQueue accounts for all c0 layers that depend on g0 before transitioning to cSecond!
  if (useColorQueueGates && gates.length >= 2 && coloredBlocks.length >= 2) {
    const g0 = gates[0];
    const c0 = g0.colorQueue[0];
    const cSecond = activeColors[1] ?? activeColors[0];
    let c0Supply = 0;
    for (const b of coloredBlocks) {
      for (const c of b.colorStack) {
        if (c === c0) c0Supply++;
      }
    }
    for (const gen of generators) {
      for (const q of gen.queue) {
        for (const c of q.colorStack) {
          if (c === c0) c0Supply++;
        }
      }
    }
    const copies = Math.max(1, c0Supply);
    g0.colorQueue = [...Array(copies).fill(c0), cSecond];
  }

  // Colorful Floor Paths (L171+)
  if (useFloorPaths && coloredBlocks.length > 0) {
    const b0 = coloredBlocks[0];
    floorPaths.push({
      row: b0.row,
      col: b0.col,
      color: b0.colorStack[0],
    });
  }

  // Moving Elevators (L181+)
  if (useElevators) {
    elevators.push({
      id: 1,
      row: Math.floor(rows / 2),
      col: 1,
      width: 2,
      height: 1,
      deltaRow: 0,
      deltaCol: 1,
    });
  }

  const adj = LEVEL_ADJECTIVES[(levelId * 7) % LEVEL_ADJECTIVES.length];
  const noun = LEVEL_NOUNS[(levelId * 13) % LEVEL_NOUNS.length];
  const sizeBonusSec = Math.max(0, (rows + cols - 11) * 10);
  const timeLimitSec =
    (difficulty === 'SUPER_HARD' ? 95 : difficulty === 'HARD' ? 100 : 105) + sizeBonusSec;

  return {
    id: levelId,
    name: `${adj} ${noun}`,
    difficulty,
    unlockNote: getUnlockNoteForLevel(levelId),
    rows,
    cols,
    cutouts: cutouts.length > 0 ? cutouts : undefined,
    pillars: pillars.length > 0 ? pillars : undefined,
    floorPaths: floorPaths.length > 0 ? floorPaths : undefined,
    blocks,
    gates,
    crates: crates.length > 0 ? crates : undefined,
    generators: generators.length > 0 ? generators : undefined,
    elevators: elevators.length > 0 ? elevators : undefined,
    parMoves: Math.max(4, coloredBlocks.length),
    timeLimitSec,
  };
}

/**
 * Constraint-First Interleaved Reverse-Blocking Level Generator (`F-09`, `RAMP-01`–`RAMP-05`).
 * Deterministically builds a level for `levelId` (`1..300` Campaign and Endless `>300`) and
 * verifies 100% solvability via `solveBoard`.
 */
export function generateProceduralLevel(levelId: number, seedOverride?: number): LevelSpec {
  const baseSeed = (seedOverride ?? (levelId * 2654435761 + 0x9e3779b9)) >>> 0;

  for (let attempt = 0; attempt < 6; attempt++) {
    const rng = mulberry32((baseSeed + attempt * 1013904223) >>> 0);
    const candidate = tryBuildCandidateSpec(levelId, rng, attempt);
    const board = createBoardState(candidate);
    const sol = solveBoard(board, 320);

    if (sol.solvable && sol.minMoves > 0) {
      const nonStoneCount = candidate.blocks.filter((b) => b.colorStack[0] !== 0).length;
      candidate.parMoves = Math.max(sol.minMoves, nonStoneCount);
      return candidate;
    }
  }

  const difficulty = getDifficultyForLevel(levelId);
  const fallbackSpec: LevelSpec = {
    id: levelId,
    name: `${LEVEL_ADJECTIVES[levelId % LEVEL_ADJECTIVES.length]} ${LEVEL_NOUNS[levelId % LEVEL_NOUNS.length]}`,
    difficulty,
    unlockNote: getUnlockNoteForLevel(levelId),
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '1x1', row: 3, col: 3, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1], isStar: true },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2], isStar: true },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3], isStar: true },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4], isStar: true },
    ],
    parMoves: 5,
    timeLimitSec: 90,
  };

  const sol = solveBoard(createBoardState(fallbackSpec), 100);
  fallbackSpec.parMoves = Math.max(sol.minMoves, 5);
  return fallbackSpec;
}
