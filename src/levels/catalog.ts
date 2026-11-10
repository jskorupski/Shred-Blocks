import type { LevelSpec } from '../core/types';
import { CURATED_EARLY_LEVELS } from './curated-early';
import { generateProceduralLevel } from './generator';

export const TOTAL_CAMPAIGN_LEVELS = 300;

const CURATED_LEVELS: Record<number, LevelSpec> = {
  ...CURATED_EARLY_LEVELS,
  81: {
    id: 81,
    name: 'Crate Breaker',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Wooden Crates crack when adjacent blocks shred.',
    rows: 6,
    cols: 6,
    crates: [{ id: 1, row: 1, col: 2, hp: 1 }],
    blocks: [
      { id: 1, shapeId: '1x1', row: 0, col: 2, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 3, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
      { id: 5, shapeId: '2x1', row: 2, col: 0, colorStack: [2] },
      { id: 6, shapeId: '2x1', row: 2, col: 5, colorStack: [3] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 105,
  },

  91: {
    id: 91,
    name: 'Defuse Squad',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Time-Bomb Blocks must be shredded before their countdown hits 0!',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 2, col: 2, colorStack: [1], bombCount: 18 },
      { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
      { id: 5, shapeId: '1x2', row: 0, col: 2, colorStack: [1] },
      { id: 6, shapeId: '2x1', row: 2, col: 0, colorStack: [2] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 0, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 105,
  },

  101: {
    id: 101,
    name: 'Tandem Link',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Glued Blocks move together as a rigid linked assembly.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x1', row: 2, col: 2, colorStack: [1], groupId: 1 },
      { id: 2, shapeId: '1x1', row: 2, col: 3, colorStack: [2], groupId: 1 },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '2x1', row: 2, col: 0, colorStack: [4] },
      { id: 6, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 7, shapeId: '2x1', row: 2, col: 5, colorStack: [2] },
      { id: 8, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 8,
    timeLimitSec: 95,
  },

  111: {
    id: 111,
    name: 'Snip the Cord',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Colored Ropes untie when matching Colored Scissors are shredded.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1], scissorColor: 1 },
      { id: 2, shapeId: '1x2', row: 4, col: 2, colorStack: [2], ropeColor: 1 },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '2x2', row: 2, col: 2, colorStack: [1] },
      { id: 6, shapeId: '2x1', row: 2, col: 0, colorStack: [4] },
      { id: 7, shapeId: '2x1', row: 2, col: 5, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  121: {
    id: 121,
    name: 'Spectrum Queue',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Color-Changing Gates cycle to the next color in their queue.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 3, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
      { id: 5, shapeId: '2x1', row: 2, col: 5, colorStack: [3] },
      { id: 6, shapeId: '2x1', row: 1, col: 0, colorStack: [3] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1, 2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  131: {
    id: 131,
    name: 'Glacier Gate',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Frozen Gates thaw as blocks shred through other gates.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '2x2', row: 2, col: 2, colorStack: [1] },
      { id: 6, shapeId: '2x1', row: 2, col: 0, colorStack: [4] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3], iceCount: 2 },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  141: {
    id: 141,
    name: 'Jewel Shutter',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Locked Shutter Gates open when a matching Shutter Gem is shredded.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1], shutterGemColor: 1 },
      { id: 2, shapeId: '1x2', row: 4, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '2x2', row: 2, col: 2, colorStack: [1] },
      { id: 6, shapeId: '2x1', row: 2, col: 0, colorStack: [4] },
      { id: 7, shapeId: '2x1', row: 2, col: 5, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      {
        edge: 'BOTTOM',
        spanStart: 1,
        spanLength: 4,
        colorQueue: [2],
        shutterLockColor: 1,
        shutterOpen: false,
      },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  145: {
    id: 145,
    name: 'Alternating Current',
    difficulty: 'HARD',
    unlockNote: 'New Obstacle: Toggling Shutter Gates flip closed after a block exits.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '2x1', row: 2, col: 0, colorStack: [4] },
      { id: 6, shapeId: '2x1', row: 2, col: 5, colorStack: [2] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
    ],
    gates: [
      {
        edge: 'TOP',
        spanStart: 1,
        spanLength: 4,
        colorQueue: [1],
        togglesOnClear: true,
        shutterOpen: true,
      },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  151: {
    id: 151,
    name: 'Moving Goalposts',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Sliding Gates shift along the wall after each shred.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 3, col: 2, colorStack: [1] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 5, shapeId: '2x1', row: 2, col: 5, colorStack: [2] },
      { id: 6, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
      { id: 7, shapeId: '2x1', row: 2, col: 0, colorStack: [2] },
    ],
    gates: [
      {
        edge: 'TOP',
        spanStart: 1,
        spanLength: 3,
        colorQueue: [1],
        slidesOnClear: true,
        slideMin: 0,
        slideMax: 3,
        slideDir: 1,
      },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  155: {
    id: 155,
    name: 'Aperture Pulse',
    difficulty: 'HARD',
    unlockNote: 'New Obstacle: Size-Changing Gates expand and contract after each shred.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x3', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 3, col: 1, colorStack: [1] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 5, shapeId: '2x1', row: 2, col: 5, colorStack: [2] },
      { id: 6, shapeId: '1x2', row: 5, col: 2, colorStack: [3] },
      { id: 7, shapeId: '2x1', row: 3, col: 0, colorStack: [2] },
    ],
    gates: [
      {
        edge: 'TOP',
        spanStart: 1,
        spanLength: 4,
        colorQueue: [1],
        sizeChangesOnClear: true,
        minLength: 2,
        maxLength: 4,
      },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  161: {
    id: 161,
    name: 'Assembly Line',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Block Generators spawn queued blocks onto the board.',
    rows: 6,
    cols: 6,
    generators: [
      {
        id: 1,
        row: 0,
        col: 0,
        spawnRow: 1,
        spawnCol: 1,
        cooldown: 1,
        queue: [{ shapeId: '1x1', colorStack: [1] }],
      },
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 5, colorStack: [2] },
      { id: 5, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
      { id: 6, shapeId: '2x1', row: 3, col: 0, colorStack: [2] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  171: {
    id: 171,
    name: 'Velvet Carpet',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Colorful Floor Paths only allow matching color blocks to cross.',
    rows: 6,
    cols: 6,
    floorPaths: [
      { row: 1, col: 2, color: 1 },
      { row: 1, col: 3, color: 1 },
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 2, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '2x1', row: 2, col: 0, colorStack: [4] },
      { id: 6, shapeId: '2x1', row: 2, col: 5, colorStack: [2] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  181: {
    id: 181,
    name: 'Sky Lift',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Moving Elevators shift fully contained blocks after each shred.',
    rows: 6,
    cols: 6,
    elevators: [
      {
        id: 1,
        row: 2,
        col: 1,
        width: 2,
        height: 1,
        deltaRow: 0,
        deltaCol: 1,
      },
    ],
    blocks: [
      { id: 1, shapeId: '1x1', row: 2, col: 1, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 1, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '1x1', row: 3, col: 1, colorStack: [4] },
      { id: 5, shapeId: '1x2', row: 0, col: 2, colorStack: [1] },
      { id: 6, shapeId: '2x1', row: 3, col: 4, colorStack: [2] },
      { id: 7, shapeId: '1x3', row: 5, col: 1, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 7,
    timeLimitSec: 95,
  },

  200: {
    id: 200,
    name: 'Omega Shredder',
    difficulty: 'SUPER_HARD',
    unlockNote: 'Epoch IV Complete: Enter the Grand Citadel Masterworks (Levels 201–300)!',
    rows: 7,
    cols: 7,
    cutouts: [[0, 0]],
    elevators: [
      {
        id: 1,
        row: 3,
        col: 2,
        width: 2,
        height: 1,
        deltaRow: 0,
        deltaCol: 1,
      },
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1], hasKey: 1 },
      { id: 2, shapeId: '2x1', row: 2, col: 5, colorStack: [2, 3] },
      { id: 3, shapeId: '1x2', row: 5, col: 2, colorStack: [3], chained: true, lockId: 1 },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4], isStar: true },
      { id: 5, shapeId: '1x1', row: 3, col: 2, colorStack: [1], iceCount: 1 },
      { id: 6, shapeId: '1x1', row: 4, col: 4, colorStack: [2], bombCount: 24 },
      { id: 7, shapeId: '1x2', row: 0, col: 2, colorStack: [1] },
      { id: 8, shapeId: '2x1', row: 2, col: 6, colorStack: [2] },
      { id: 9, shapeId: '1x3', row: 6, col: 2, colorStack: [3] },
      { id: 10, shapeId: '2x1', row: 2, col: 0, colorStack: [4], isStar: true },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1, 1, 1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4], isStar: true },
    ],
    parMoves: 11,
    timeLimitSec: 135,
  },

  250: {
    id: 250,
    name: 'Citadel Sovereign',
    difficulty: 'SUPER_HARD',
    layoutId: 'CITADEL_OCTAGON',
    unlockNote: 'Epoch V Finale: Master the 8×8 Grand Citadel Courtyard!',
    rows: 8,
    cols: 8,
    cutouts: [
      [0, 0],
      [0, 7],
      [7, 0],
      [7, 7],
    ],
    blocks: [
      { id: 1, shapeId: '1x3', row: 1, col: 2, colorStack: [1], axisLock: 'V', hasKey: 1 },
      { id: 2, shapeId: '2x1', row: 3, col: 5, colorStack: [2, 3] },
      { id: 3, shapeId: '1x2', row: 5, col: 3, colorStack: [3], chained: true, lockId: 1 },
      { id: 4, shapeId: '2x2', row: 3, col: 2, colorStack: [4], isStar: true },
      { id: 5, shapeId: '1x2', row: 6, col: 2, colorStack: [1], iceCount: 1 },
      { id: 6, shapeId: '2x1', row: 2, col: 1, colorStack: [2] },
      { id: 7, shapeId: '1x1', row: 5, col: 5, colorStack: [4] },
      { id: 8, shapeId: '1x3', row: 0, col: 2, colorStack: [1] },
      { id: 9, shapeId: '2x1', row: 2, col: 7, colorStack: [2] },
      { id: 10, shapeId: '2x1', row: 4, col: 7, colorStack: [2] },
      { id: 11, shapeId: '2x1', row: 2, col: 0, colorStack: [4], isStar: true },
      { id: 12, shapeId: '1x3', row: 7, col: 2, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 6, colorQueue: [1, 1, 1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 6, colorQueue: [2, 2, 2, 2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 6, colorQueue: [3, 3, 3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 6, colorQueue: [4, 4, 4], isStar: true },
    ],
    parMoves: 13,
    timeLimitSec: 155,
  },

  300: {
    id: 300,
    name: 'Sacred Astrolabe',
    difficulty: 'SUPER_HARD',
    layoutId: 'CITADEL_OCTAGON',
    unlockNote: 'Campaign Finale (Level 300): Conquer the 9×9 Sacred Astrolabe Sanctuary!',
    rows: 9,
    cols: 9,
    cutouts: [
      [0, 0],
      [0, 8],
      [8, 0],
      [8, 8],
    ],
    pillars: [[4, 4]],
    blocks: [
      { id: 1, shapeId: '1x3', row: 1, col: 3, colorStack: [1], hasKey: 1 },
      { id: 2, shapeId: '2x1', row: 2, col: 6, colorStack: [2], scissorColor: 3 },
      { id: 3, shapeId: '1x3', row: 6, col: 3, colorStack: [3], chained: true, lockId: 1 },
      { id: 4, shapeId: '2x2', row: 3, col: 1, colorStack: [4], ropeColor: 3, isStar: true },
      { id: 5, shapeId: '1x2', row: 2, col: 3, colorStack: [1, 2], iceCount: 1 },
      { id: 6, shapeId: '2x1', row: 5, col: 6, colorStack: [2], shutterGemColor: 3 },
      { id: 7, shapeId: '1x2', row: 7, col: 3, colorStack: [3], iceCount: 2 },
      { id: 8, shapeId: '1x1', row: 5, col: 2, colorStack: [4], bombCount: 28 },
      { id: 9, shapeId: '1x3', row: 0, col: 3, colorStack: [1] },
      { id: 10, shapeId: '2x1', row: 2, col: 8, colorStack: [2] },
      { id: 11, shapeId: '2x1', row: 5, col: 8, colorStack: [2] },
      { id: 12, shapeId: '2x1', row: 2, col: 0, colorStack: [4], isStar: true },
      { id: 13, shapeId: '2x1', row: 5, col: 0, colorStack: [4], isStar: true },
      { id: 14, shapeId: '1x3', row: 8, col: 3, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 7, colorQueue: [1, 1, 1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 7, colorQueue: [2, 2, 2, 2, 2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 7, colorQueue: [3, 3, 3], shutterLockColor: 3 },
      { edge: 'LEFT', spanStart: 1, spanLength: 7, colorQueue: [4, 4, 4, 4], isStar: true },
    ],
    parMoves: 15,
    timeLimitSec: 175,
  },
};

const levelCache = new Map<number, LevelSpec>();

function cloneLevelSpec(spec: LevelSpec): LevelSpec {
  return {
    ...spec,
    cutouts: spec.cutouts ? spec.cutouts.map(([r, c]) => [r, c]) : undefined,
    pillars: spec.pillars ? spec.pillars.map(([r, c]) => [r, c]) : undefined,
    floorPaths: spec.floorPaths ? spec.floorPaths.map((fp) => ({ ...fp })) : undefined,
    blocks: spec.blocks.map((b) => ({
      ...b,
      colorStack: [...b.colorStack],
    })),
    gates: spec.gates.map((g) => ({
      ...g,
      colorQueue: [...g.colorQueue],
    })),
    crates: spec.crates ? spec.crates.map((c) => ({ ...c })) : undefined,
    generators: spec.generators
      ? spec.generators.map((gen) => ({
          ...gen,
          queue: gen.queue.map((q) => ({ ...q, colorStack: [...q.colorStack] })),
        }))
      : undefined,
    elevators: spec.elevators ? spec.elevators.map((e) => ({ ...e })) : undefined,
    barriers: spec.barriers
      ? spec.barriers.map((bar) => ({
          ...bar,
          cells: bar.cells.map(([r, c]) => [r, c] as [number, number]),
          roomCells: bar.roomCells ? bar.roomCells.map(([r, c]) => [r, c] as [number, number]) : undefined,
        }))
      : undefined,
  };
}

/**
 * Returns the `LevelSpec` for `levelId` (`1..300` Campaign or `>300` Endless Mastery).
 */
export function getLevelSpec(levelId: number): LevelSpec {
  const normalizedId = Math.max(1, Math.floor(levelId));
  const cached = levelCache.get(normalizedId);
  if (cached) {
    return cloneLevelSpec(cached);
  }

  const curated = CURATED_LEVELS[normalizedId];
  const spec = curated ? cloneLevelSpec(curated) : generateProceduralLevel(normalizedId);
  levelCache.set(normalizedId, spec);
  return cloneLevelSpec(spec);
}

/**
 * Returns all 300 Campaign `LevelSpec` definitions (`1..300`).
 */
export function getAllCampaignLevels(): LevelSpec[] {
  const levels: LevelSpec[] = [];
  for (let id = 1; id <= TOTAL_CAMPAIGN_LEVELS; id++) {
    levels.push(getLevelSpec(id));
  }
  return levels;
}
