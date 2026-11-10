import type { LevelSpec } from '../core/types';
import { generateProceduralLevel } from './generator';

export const TOTAL_CAMPAIGN_LEVELS = 300;

const CURATED_LEVELS: Record<number, LevelSpec> = {
  1: {
    id: 1,
    name: 'First Shred',
    difficulty: 'NORMAL',
    unlockNote: 'Drag blocks into matching color shredder gates!',
    rows: 5,
    cols: 5,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 3, colorStack: [2] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 3, colorQueue: [2] },
    ],
    parMoves: 2,
    timeLimitSec: 90,
  },

  2: {
    id: 2,
    name: 'Dual Lanes',
    difficulty: 'NORMAL',
    rows: 5,
    cols: 5,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 3, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 3, col: 1, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 3, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 3, colorQueue: [3] },
    ],
    parMoves: 3,
    timeLimitSec: 90,
  },

  3: {
    id: 3,
    name: 'Clear the Way',
    difficulty: 'NORMAL',
    rows: 5,
    cols: 5,
    blocks: [
      { id: 1, shapeId: '1x3', row: 1, col: 1, colorStack: [2] },
      { id: 2, shapeId: '2x1', row: 2, col: 2, colorStack: [1] },
      { id: 3, shapeId: '1x2', row: 4, col: 1, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 0, spanLength: 3, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 3, colorQueue: [3] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  4: {
    id: 4,
    name: 'Corner Pocket',
    difficulty: 'NORMAL',
    rows: 5,
    cols: 5,
    blocks: [
      { id: 1, shapeId: 'L3_BL', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 1, col: 3, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 3, col: 1, colorStack: [3] },
      { id: 4, shapeId: '1x1', row: 3, col: 3, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 0, spanLength: 3, colorQueue: [2] },
      { edge: 'LEFT', spanStart: 2, spanLength: 3, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 2, spanLength: 3, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  5: {
    id: 5,
    name: 'Square Jam',
    difficulty: 'HARD',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '2x2', row: 2, col: 2, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 0, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 105,
  },

  6: {
    id: 6,
    name: 'Tetromino Turn',
    difficulty: 'NORMAL',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: 'L3_TL', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 1, col: 3, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 1, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 3, col: 4, colorStack: [4] },
    ],
    gates: [
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'TOP', spanStart: 2, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 0, spanLength: 4, colorQueue: [3] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 110,
  },

  7: {
    id: 7,
    name: 'Four-Way Intersection',
    difficulty: 'NORMAL',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '1x1', row: 2, col: 2, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 5,
    timeLimitSec: 90,
  },

  8: {
    id: 8,
    name: 'Interlock',
    difficulty: 'NORMAL',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: 'L3_TL', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: 'L3_BR', row: 2, col: 2, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 1, col: 4, colorStack: [4] },
      { id: 5, shapeId: '1x1', row: 4, col: 4, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 5,
    timeLimitSec: 90,
  },

  9: {
    id: 9,
    name: 'Tight Squeeze',
    difficulty: 'HARD',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '2x2', row: 2, col: 2, colorStack: [3] },
      { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 3, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 4, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 5, shapeId: '1x2', row: 4, col: 2, colorStack: [1] },
      { id: 6, shapeId: '1x1', row: 1, col: 4, colorStack: [2] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 6,
    timeLimitSec: 85,
  },

  10: {
    id: 10,
    name: 'Chromatic Crucible',
    difficulty: 'SUPER_HARD',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: 'L3_TL', row: 1, col: 1, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 1, col: 3, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: 'L3_BL', row: 3, col: 1, colorStack: [4] },
      { id: 5, shapeId: '1x2', row: 4, col: 3, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 0, spanLength: 3, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 3, spanLength: 3, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 5,
    timeLimitSec: 105,
  },

  11: {
    id: 11,
    name: 'Rail Runner',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Axis-Locked Blocks slide only along their arrow axis.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 2, col: 2, colorStack: [1], axisLock: 'H' },
      { id: 2, shapeId: '2x1', row: 1, col: 1, colorStack: [2], axisLock: 'V' },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '1x1', row: 2, col: 4, colorStack: [4] },
    ],
    gates: [
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'TOP', spanStart: 0, spanLength: 3, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'TOP', spanStart: 3, spanLength: 3, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  14: {
    id: 14,
    name: 'Cruciform Atrium',
    difficulty: 'NORMAL',
    layoutId: 'CROSS_ATRIUM',
    unlockNote:
      '🏛️ New Architecture: Sculpted Courtyards! Corner voids carve open the sanctuary—maneuver blocks through the central cross-atrium.',
    rows: 6,
    cols: 6,
    cutouts: [
      [0, 0],
      [0, 5],
      [5, 0],
      [5, 5],
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 95,
  },

  18: {
    id: 18,
    name: 'East Wing Alcove',
    difficulty: 'NORMAL',
    layoutId: 'L_WING',
    unlockNote:
      '📐 Stepped Exit Gate! Exit Gates can anchor directly along recessed courtyard wings.',
    rows: 6,
    cols: 6,
    cutouts: [
      [0, 4],
      [0, 5],
      [1, 4],
      [1, 5],
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 3, col: 4, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 1, col: 1, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 1, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 4, spanLength: 2, edgeLine: 2, colorQueue: [1] },
      { edge: 'TOP', spanStart: 0, spanLength: 4, edgeLine: 0, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 95,
  },

  21: {
    id: 21,
    name: 'Pillar Courtyard',
    difficulty: 'NORMAL',
    layoutId: 'HOURGLASS_BRIDGE',
    unlockNote: 'New Obstacle: Corner Cutouts & Interior Stone Pillars reshape the board.',
    rows: 6,
    cols: 6,
    cutouts: [
      [0, 0],
      [5, 5],
    ],
    pillars: [[2, 2]],
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 1, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  22: {
    id: 22,
    name: 'Terrace Pavilion',
    difficulty: 'NORMAL',
    layoutId: 'T_PAVILION',
    unlockNote: '🏛️ Terrace Pavilion: Dual lower alcoves shape a T-courtyard with stepped walls.',
    rows: 6,
    cols: 6,
    cutouts: [
      [4, 0],
      [5, 0],
      [4, 5],
      [5, 5],
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 1, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 1, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 0, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 0, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 95,
  },

  25: {
    id: 25,
    name: 'Twin Sanctum',
    difficulty: 'HARD',
    layoutId: 'TWIN_SANCTUM',
    unlockNote:
      '⛩️ Multi-Room Sanctum! Shred 2 blocks in the South Courtyard to raise the Golden Portcullis and awaken the North Chamber!',
    rows: 7,
    cols: 6,
    cutouts: [
      [0, 0],
      [0, 5],
    ],
    pillars: [
      [2, 0],
      [2, 5],
    ],
    barriers: [
      {
        id: 1,
        cells: [
          [2, 1],
          [2, 2],
          [2, 3],
          [2, 4],
        ],
        orientation: 'H',
        shredsRemaining: 2,
        unlocksRoomId: 1,
        roomCells: [
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
          [1, 0],
          [1, 1],
          [1, 2],
          [1, 3],
          [1, 4],
          [1, 5],
        ],
      },
    ],
    blocks: [
      { id: 1, shapeId: '1x2', row: 5, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 3, col: 4, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 3, col: 1, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 1, col: 2, colorStack: [4] },
    ],
    gates: [
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 3, spanLength: 4, colorQueue: [2] },
      { edge: 'LEFT', spanStart: 3, spanLength: 4, colorQueue: [3] },
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 105,
  },

  31: {
    id: 31,
    name: 'Double Shell',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Multi-Layer Blocks peel their outer shell to reveal an inner core.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1, 2] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
      { id: 4, shapeId: '1x1', row: 2, col: 1, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 2, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 0, spanLength: 2, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 5,
    timeLimitSec: 90,
  },

  41: {
    id: 41,
    name: 'Frostbite Thaw',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Frozen Ice Blocks thaw by 1 with every block shredded.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3], iceCount: 2 },
      { id: 4, shapeId: '1x1', row: 2, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  51: {
    id: 51,
    name: 'Starlight Express',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Star Blocks can only exit through matching Star Gates.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 2, col: 2, colorStack: [1], isStar: true },
      { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x1', row: 4, col: 2, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1], isStar: true },
      { edge: 'LEFT', spanStart: 0, spanLength: 3, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [1], isStar: false },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  61: {
    id: 61,
    name: 'Lock & Key',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Padlocked Chained Blocks unlock when a Key Block is shredded.',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1], hasKey: 1 },
      { id: 2, shapeId: '1x2', row: 4, col: 2, colorStack: [2], chained: true, lockId: 1 },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  71: {
    id: 71,
    name: 'Stone Monolith',
    difficulty: 'NORMAL',
    unlockNote: 'New Obstacle: Charcoal Stone Blocks never shred—slide them out of the way!',
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [0] },
      { id: 2, shapeId: '1x2', row: 3, col: 2, colorStack: [1] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
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
      { id: 1, shapeId: '1x2', row: 2, col: 2, colorStack: [1], bombCount: 10 },
      { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'LEFT', spanStart: 0, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1, 2] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3], iceCount: 2 },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [2], shutterLockColor: 1, shutterOpen: false },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1], togglesOnClear: true, shutterOpen: true },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 85,
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
    parMoves: 4,
    timeLimitSec: 90,
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
    parMoves: 4,
    timeLimitSec: 85,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4] },
    ],
    parMoves: 4,
    timeLimitSec: 90,
  },

  200: {
    id: 200,
    name: 'Omega Shredder',
    difficulty: 'SUPER_HARD',
    unlockNote: 'Grand Finale: Master all 18 ShredBlocks mechanics!',
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
      { id: 6, shapeId: '1x1', row: 4, col: 4, colorStack: [2], bombCount: 18 },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1, 1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4], isStar: true },
    ],
    parMoves: 7,
    timeLimitSec: 125,
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
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 6, colorQueue: [1, 1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 6, colorQueue: [2, 2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 6, colorQueue: [3, 3] },
      { edge: 'LEFT', spanStart: 1, spanLength: 6, colorQueue: [4, 4], isStar: true },
    ],
    parMoves: 8,
    timeLimitSec: 145,
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
      { id: 8, shapeId: '1x1', row: 5, col: 2, colorStack: [4], bombCount: 18 },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 7, colorQueue: [1, 1] },
      { edge: 'RIGHT', spanStart: 1, spanLength: 7, colorQueue: [2, 2, 2] },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 7, colorQueue: [3, 3], shutterLockColor: 3 },
      { edge: 'LEFT', spanStart: 1, spanLength: 7, colorQueue: [4, 4], isStar: true },
    ],
    parMoves: 9,
    timeLimitSec: 165,
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
          roomCells: bar.roomCells
            ? bar.roomCells.map(([r, c]) => [r, c] as [number, number])
            : undefined,
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
