import { describe, expect, it } from 'vitest';
import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  cloneBoardState,
  commitBlockMove,
  computeEarnedStars,
  createBoardState,
  isBoardFailed,
  isBoardWon,
} from '../../src/core/board';
import {
  autoAdvanceColorQueues,
  checkBlockGateClearance,
  checkMidDragGateCapture,
  findEligibleGateForBlockAt,
  resolveClearCascade,
} from '../../src/core/gate-clearance';
import {
  canGroupOccupyOffset,
  getReachableAnchors,
  isBlockMovable,
  snapGroupToNearestGrid,
  sweepBlockToTarget,
} from '../../src/core/physics';
import { getActiveColor, getLayersRemaining, getShape, POLYOMINO_SHAPES } from '../../src/core/polyomino';
import type { LevelSpec } from '../../src/core/types';
import { buildCommittedMoveTrace } from '../../src/input/targeting-and-keyboard';
import { getLevelSpec } from '../../src/levels/catalog';
import { findNextHintMove } from '../../src/levels/solver';
import {
  buildTraceSegments,
  getShapeAnchorCellOffset,
  spawnPathTraceImpl,
  stepPathTracesImpl,
  type VisualPathTrace,
} from '../../src/render/pass2-drag-fx';
import { fillTraceUniformWindow, MAX_TRACE_UNIFORM_PTS } from '../../src/render/path-trace-ribbon';
import { QualityGovernor, type RenderPassContext } from '../../src/render/render-types';

describe('Polyomino Shape Catalog (37 Orientations)', () => {
  it('contains all 37 canonical polyomino orientations with accurate non-convex flags', () => {
    const keys = Object.keys(POLYOMINO_SHAPES);
    expect(keys.length).toBe(37);

    // Convex shapes (1x1, 1x2, 2x1, 1x3, 3x1, 1x4, 4x1, 2x2)
    expect(getShape('1x1').isNonConvex).toBe(false);
    expect(getShape('1x2').isNonConvex).toBe(false);
    expect(getShape('2x2').isNonConvex).toBe(false);
    expect(getShape('1x4').isNonConvex).toBe(false);

    // Non-convex shapes (L, J, T, S/Z, Plus, Big-L, U)
    expect(getShape('L3_BL').isNonConvex).toBe(true);
    expect(getShape('L4_0').isNonConvex).toBe(true);
    expect(getShape('T4_D').isNonConvex).toBe(true);
    expect(getShape('PLUS_5').isNonConvex).toBe(true);
    expect(getShape('U5_U').isNonConvex).toBe(true);
    expect(getShape('BIGL_TL').isNonConvex).toBe(true);
  });

  it('tracks active color and remaining layers accurately', () => {
    expect(getActiveColor([2, 5], 0)).toBe(2);
    expect(getActiveColor([2, 5], 1)).toBe(5);
    expect(getLayersRemaining([2, 5], 0)).toBe(2);
    expect(getLayersRemaining([2, 5], 1)).toBe(1);
  });
});

describe('Swept Collision Physics & F-04 Clamping / Floor-Path Exemption', () => {
  it('clamps exactly to integer obstacle edges (F-04) without tunneling', () => {
    const spec: LevelSpec = {
      id: 901,
      name: 'Clamp Test',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      pillars: [[2, 4]],
      blocks: [{ id: 1, shapeId: '1x2', row: 2, col: 0, colorStack: [1] }],
      gates: [{ edge: 'TOP', spanStart: 0, spanLength: 4, colorQueue: [1] }],
    };
    const board = createBoardState(spec);
    // Block 1 is 1x2 at (row=2, col=0..1). Pillar at (row=2, col=4) stops lead.x at col=2.0
    const res = sweepBlockToTarget(board, 1, 5.0, 2.0);
    expect(res.leadX).toBeCloseTo(2.0, 4);
    expect(res.leadY).toBeCloseTo(2.0, 4);
  });

  it('applies corner bevel assist + immediate same-substep retry within CORNER_BEVEL_THRESHOLD (0.35 cell)', () => {
    const spec: LevelSpec = {
      id: 902,
      name: 'Corner Bevel Test',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      pillars: [[1, 2]],
      blocks: [{ id: 1, shapeId: '1x1', row: 2, col: 1, colorStack: [1] }],
      gates: [{ edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [1] }],
    };
    const board = createBoardState(spec);
    const blk = board.blocks[0];
    // Position block slightly misaligned into row 1.78 (within 0.22 <= 0.35 of lane row=2)
    blk.x = 1.0;
    blk.y = 1.78;
    // Sweep right toward x=4.0: X hits pillar at (1, 2) unless corner bevel snaps y -> 2.0 and retries X!
    const res = sweepBlockToTarget(board, 1, 4.0, 1.78);
    expect(res.leadY).toBeCloseTo(2.0, 4);
    expect(res.leadX).toBeGreaterThan(2.5);
  });

  it('prevents corner-bevel channel ping-pong / vibration when holding or jittering diagonally near an open crossroads', () => {
    const spec: LevelSpec = {
      id: 9021,
      name: 'Diagonal Hysteresis Stability Test',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      pillars: [[2, 2]],
      blocks: [{ id: 1, shapeId: '1x1', row: 1, col: 1, colorStack: [1] }],
      gates: [{ edge: 'RIGHT', spanStart: 1, spanLength: 2, colorQueue: [1] }],
    };
    const board = createBoardState(spec);

    // Move diagonally into the 0.35 x 0.35 corner bevel zone around (col=1, row=1)
    const first = sweepBlockToTarget(board, 1, 1.24, 1.26);
    // Block should choose the dominant Y channel cleanly (x=1.0, y=1.26)
    expect(first.leadX).toBeCloseTo(1.0, 4);
    expect(first.leadY).toBeCloseTo(1.26, 4);

    // Repeatedly call sweepBlockToTarget at the same or slightly jittering diagonal pointer coords:
    // The block must stay locked in the Y channel and NEVER flip-flop to (1.24, 1.0)!
    const jitterTargets: Array<[number, number]> = [
      [1.24, 1.26],
      [1.25, 1.25],
      [1.26, 1.23],
      [1.23, 1.25],
      [1.24, 1.26],
    ];
    for (const [tx, ty] of jitterTargets) {
      const next = sweepBlockToTarget(board, 1, tx, ty);
      expect(next.leadX).toBeCloseTo(1.0, 4);
      expect(next.leadY).toBeCloseTo(ty, 4);
    }

    // Only when the user pulls deliberately past the hysteresis threshold along X (e.g. tx=1.40, ty=1.22)
    // should the block cleanly switch to the X channel and stay there without oscillating back.
    const switched = sweepBlockToTarget(board, 1, 1.42, 1.22);
    expect(switched.leadY).toBeCloseTo(1.0, 4);
    expect(switched.leadX).toBeCloseTo(1.42, 4);

    const holdSwitched = sweepBlockToTarget(board, 1, 1.25, 1.24);
    expect(holdSwitched.leadY).toBeCloseTo(1.0, 4);
    expect(holdSwitched.leadX).toBeCloseTo(1.25, 4);
  });

  it('exempts a block’s current integer footprint on a mismatched colorful floor path after peeling (F-04)', () => {
    const spec: LevelSpec = {
      id: 903,
      name: 'Floor Exemption Test',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      floorPaths: [{ row: 0, col: 2, color: 1 }],
      blocks: [{ id: 1, shapeId: '1x1', row: 0, col: 2, colorStack: [1, 2] }],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 3, colorQueue: [2] },
      ],
    };
    const board = createBoardState(spec);
    // Commit at (0, 2) to peel outer layer (color 1 -> color 2) while sitting on floorColor=1 tile
    const peelOut = commitBlockMove(board, 1, 0, 2, 'ZEN');
    expect(peelOut.peeledBlockIds).toContain(1);
    expect(getActiveColor(board.blocks[0].colorStack, board.blocks[0].colorCursor)).toBe(2);

    // Even though activeColor is now 2 and (0, 2) has floorColor=1, F-04 allows staying in/sliding out of (0, 2)!
    expect(canGroupOccupyOffset(board, [board.blocks[0]], 0, 0)).toBe(true);
    expect(canGroupOccupyOffset(board, [board.blocks[0]], 1, 0)).toBe(true);
  });
});

describe('4-Part Gate Clearance Law, Non-Convex Raycast & F-01 / F-07', () => {
  it('rejects non-convex U-block exit when another block sits inside its concave pocket', () => {
    const spec: LevelSpec = {
      id: 904,
      name: 'U-Pocket Raycast Test',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      blocks: [
        // U5_D has cells (0,0),(0,1),(0,2),(1,0),(1,2) -> pocket at (row+1, col+1)
        { id: 1, shapeId: 'U5_D', row: 4, col: 1, colorStack: [1] },
        // Blocker sitting inside the pocket at (5, 2)
        { id: 2, shapeId: '1x1', row: 5, col: 2, colorStack: [2] },
      ],
      gates: [{ edge: 'BOTTOM', spanStart: 0, spanLength: 5, colorQueue: [1] }],
    };
    const board = createBoardState(spec);
    const uBlock = board.blocks[0];
    const gate = board.gates[0];

    // Blocked by pocket occupant id=2 at (5, 2)
    expect(checkBlockGateClearance(board, uBlock, gate, 4, 1)).toBe(false);

    // Move U-block up to (3, 1), slide blocker id=2 out of the pocket to (5, 5), then re-test clearance at (4, 1)
    expect(commitBlockMove(board, 1, 3, 1, 'ZEN').moved).toBe(true);
    expect(commitBlockMove(board, 2, 5, 5, 'ZEN').moved).toBe(true);
    expect(checkBlockGateClearance(board, uBlock, gate, 4, 1)).toBe(true);
  });

  it('enforces F-01 mid-drag gate capture only when aligned and moving toward gate', () => {
    const spec: LevelSpec = {
      id: 905,
      name: 'Mid-Drag Capture Test',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      blocks: [{ id: 1, shapeId: '1x2', row: 0, col: 1, colorStack: [1] }],
      gates: [{ edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] }],
    };
    const board = createBoardState(spec);
    // Moving away from TOP gate (stepVecY = +0.2 -> dot < 0) should NOT capture
    expect(checkMidDragGateCapture(board, 1, 0, 0.2)).toBeNull();
    // Moving toward TOP gate (stepVecY = -0.2 -> dot > 0) captures immediately
    const cap = checkMidDragGateCapture(board, 1, 0, -0.2);
    expect(cap).toEqual({ capturedBlockId: 1, gateIndex: 0 });
  });

  it('resolves F-07 corner tie-breaker deterministically using velocity dot product then gate index', () => {
    const spec: LevelSpec = {
      id: 906,
      name: 'Corner Tie-Breaker Test',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      blocks: [{ id: 1, shapeId: '1x1', row: 0, col: 0, colorStack: [1] }],
      gates: [
        { edge: 'TOP', spanStart: 0, spanLength: 2, colorQueue: [1] },
        { edge: 'LEFT', spanStart: 0, spanLength: 2, colorQueue: [1] },
      ],
    };
    const board = createBoardState(spec);
    const blk = board.blocks[0];

    // Moving left (velX = -1, velY = 0) favors LEFT gate (index 1)
    expect(findEligibleGateForBlockAt(board, blk, 0, 0, -1, 0)).toBe(1);
    // Moving up (velX = 0, velY = -1) favors TOP gate (index 0)
    expect(findEligibleGateForBlockAt(board, blk, 0, 0, 0, -1)).toBe(0);
    // Zero velocity tie-breaks by lowest gate.index (0)
    expect(findEligibleGateForBlockAt(board, blk, 0, 0, 0, 0)).toBe(0);
  });
});

describe('All 18 Obstacles & Core Mechanics', () => {
  it('handles Axis-Lock (1), Cutouts/Pillars (2), Multi-Layer (3), Ice Block (4), and Star Block (5)', () => {
    const spec: LevelSpec = {
      id: 910,
      name: 'Obstacles 1-5',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      cutouts: [[0, 0]],
      pillars: [[3, 3]],
      blocks: [
        { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1, 2], axisLock: 'V' },
        { id: 2, shapeId: '1x1', row: 4, col: 2, colorStack: [3], iceCount: 1, isStar: true },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [2] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3], isStar: true },
      ],
    };
    const board = createBoardState(spec);

    // Block 2 starts frozen
    expect(isBlockMovable(board, 2)).toBe(false);
    // Block 1 is V-locked so it can only move vertically
    const anchors1 = getReachableAnchors(board, 1);
    expect(anchors1.every((a) => a.col === 2)).toBe(true);

    // Peel Block 1 at TOP gate (0, 2) -> thaws Block 2 from iceCount 1 to 0!
    commitBlockMove(board, 1, 0, 2, 'ZEN');
    expect(board.blocks[1].iceCount).toBe(0);
    expect(isBlockMovable(board, 2)).toBe(true);

    // Exit Star Block 2 through Star Gate at (5, 2)
    commitBlockMove(board, 2, 5, 2, 'ZEN');
    expect(board.blocks[1].status).toBe('CLEARED');
  });

  it('handles Key/Chain (6), Stone Block (7), Wooden Crate (8), and Bomb Block (9)', () => {
    const spec: LevelSpec = {
      id: 911,
      name: 'Obstacles 6-9',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      crates: [{ id: 1, row: 1, col: 2, hp: 1 }],
      blocks: [
        { id: 1, shapeId: '1x1', row: 0, col: 2, colorStack: [1], hasKey: 1 },
        {
          id: 2,
          shapeId: '1x1',
          row: 4,
          col: 2,
          colorStack: [2],
          chained: true,
          lockId: 1,
          bombCount: 2,
        },
        { id: 3, shapeId: '1x1', row: 3, col: 3, colorStack: [0] }, // Stone
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [2] },
      ],
    };
    const board = createBoardState(spec);
    expect(isBlockMovable(board, 2)).toBe(false);
    expect(isBlockMovable(board, 3)).toBe(true); // Movable Neutral Stone Slider (FR-26)
    expect(checkBlockGateClearance(board, board.blocks[2], board.gates[0], 0, 3)).toBe(false); // Stone never exits gates

    // Clear Key block 1 at (0, 2) -> unlocks chained block 2 AND destroys adjacent crate at (1, 2)!
    commitBlockMove(board, 1, 0, 2, 'ZEN');
    expect(board.blocks[1].chained).toBe(false);
    expect(board.crates[0].destroyed).toBe(true);
    expect(board.blocks[1].bombCount).toBe(1);

    // Clear Bomb block 2 at (5, 2) -> board is won even with Stone block 3 still on board!
    commitBlockMove(board, 2, 5, 2, 'ZEN');
    expect(isBoardWon(board)).toBe(true);
  });

  it('handles Glued Blocks (10), Rope/Scissors (11), Color-Changing Gate + F-08 Auto-Advance (12), and Frozen Gate (13)', () => {
    const spec: LevelSpec = {
      id: 912,
      name: 'Obstacles 10-13',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      blocks: [
        { id: 1, shapeId: '1x1', row: 1, col: 2, colorStack: [1], groupId: 1, scissorColor: 2 },
        { id: 2, shapeId: '1x1', row: 1, col: 3, colorStack: [2], groupId: 1 },
        { id: 3, shapeId: '1x1', row: 4, col: 2, colorStack: [3], ropeColor: 2 },
      ],
      gates: [
        // Gate 0 starts with color 9 (zero supply on board -> F-08 auto-advances to color 1!)
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [9, 1, 2] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3], iceCount: 1 },
      ],
    };
    const board = createBoardState(spec);
    // F-08 should have auto-advanced Gate 0 past exhausted color 9 to color 1
    expect(board.gates[0].colorCursor).toBe(1);

    // Move glued group (1 & 2) up to row 0: block 1 clears, cuts rope on block 3, thaws gate 1, and advances gate 0 to color 2, which immediately cascades block 2!
    commitBlockMove(board, 1, 0, 2, 'ZEN');
    expect(board.blocks[0].status).toBe('CLEARED');
    expect(board.blocks[1].status).toBe('CLEARED');
    expect(board.blocks[2].ropeColor).toBe(0);
    expect(board.gates[1].iceCount).toBe(0);
  });

  it('handles Shutter Lock + Gem (14a), Toggling Gate (14b), Sliding & Size-Changing Gate (15)', () => {
    const spec: LevelSpec = {
      id: 913,
      name: 'Obstacles 14-15',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      blocks: [
        { id: 1, shapeId: '1x1', row: 0, col: 2, colorStack: [1], shutterGemColor: 4 },
        { id: 2, shapeId: '1x1', row: 4, col: 2, colorStack: [2] },
      ],
      gates: [
        {
          edge: 'TOP',
          spanStart: 1,
          spanLength: 4,
          colorQueue: [1],
          togglesOnClear: true,
          shutterOpen: true,
          slidesOnClear: true,
          slideMin: 0,
          slideMax: 2,
          slideDir: 1,
          sizeChangesOnClear: true,
          minLength: 2,
          maxLength: 4,
        },
        {
          edge: 'BOTTOM',
          spanStart: 1,
          spanLength: 4,
          colorQueue: [2],
          shutterLockColor: 4,
          shutterOpen: false,
        },
      ],
    };
    const board = createBoardState(spec);
    // Gate 1 starts locked
    expect(board.gates[1].shutterOpen).toBe(false);

    // Clear block 1 at Gate 0 -> unlocks Gate 1, toggles Gate 0 closed, slides Gate 0, shrinks Gate 0
    commitBlockMove(board, 1, 0, 2, 'ZEN');
    expect(board.gates[0].shutterOpen).toBe(false);
    expect(board.gates[0].spanStart).toBe(2);
    expect(board.gates[0].spanLength).toBe(3);
    expect(board.gates[1].shutterLockColor).toBe(0);
    expect(board.gates[1].shutterOpen).toBe(true);
  });

  it('handles Block Generators READY_TO_SPAWN (16, F-06), Floor Paths (17), and Moving Elevators (18, F-05)', () => {
    const spec: LevelSpec = {
      id: 914,
      name: 'Obstacles 16-18',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      floorPaths: [{ row: 2, col: 4, color: 2 }],
      generators: [
        {
          id: 1,
          row: 0,
          col: 0,
          spawnRow: 0,
          spawnCol: 2,
          cooldown: 1,
          queue: [{ shapeId: '1x1', colorStack: [1] }],
        },
      ],
      elevators: [
        {
          id: 1,
          row: 3,
          col: 1,
          width: 2,
          height: 1,
          deltaRow: 0,
          deltaCol: 1,
        },
      ],
      blocks: [
        // Occupies generator spawn cell (0, 2) initially!
        { id: 1, shapeId: '1x1', row: 0, col: 2, colorStack: [1] },
        // Fully contained inside elevator (3, 1..2)
        { id: 2, shapeId: '1x2', row: 3, col: 1, colorStack: [2] },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
        { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2] },
      ],
    };
    const board = createBoardState(spec);
    // Clear block 1 -> generator cooldown reaches 0, spawns new block (id=3) at (0, 2) which auto-clears, and elevator shifts block 2 right!
    commitBlockMove(board, 1, 0, 2, 'ZEN');
    expect(board.generators[0].state).toBe('DEPLETED');
    expect(board.elevators[0].col).toBeGreaterThanOrEqual(1);
    expect(board.blocks[1].col).toBeGreaterThanOrEqual(1);
  });
});

describe('All 5 Boosters & Zero-Softlock Law', () => {
  it('enforces Zero-Softlock Law when Hammer, Rocket, or Vacuum destroys carrier blocks', () => {
    const spec: LevelSpec = {
      id: 920,
      name: 'Booster Zero-Softlock',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      crates: [{ id: 1, row: 2, col: 2, hp: 2 }],
      blocks: [
        { id: 1, shapeId: '1x1', row: 1, col: 1, colorStack: [1], hasKey: 1 },
        {
          id: 2,
          shapeId: '1x1',
          row: 1,
          col: 4,
          colorStack: [2],
          chained: true,
          lockId: 1,
          scissorColor: 3,
        },
        {
          id: 3,
          shapeId: '1x1',
          row: 4,
          col: 1,
          colorStack: [3],
          ropeColor: 3,
          shutterGemColor: 4,
        },
        { id: 4, shapeId: '1x1', row: 4, col: 4, colorStack: [4] },
      ],
      gates: [
        { edge: 'TOP', spanStart: 0, spanLength: 4, colorQueue: [1, 4] },
        {
          edge: 'BOTTOM',
          spanStart: 0,
          spanLength: 6,
          colorQueue: [4],
          shutterLockColor: 4,
          shutterOpen: false,
        },
      ],
    };
    const board = createBoardState(spec);
    const savedSnapshot = cloneBoardState(board);

    // 1. Hammer on block 1 at (1, 1) -> destroys block 1, triggers Key (unlocking block 2), and F-08 advances Gate 0 to color 4!
    expect(applyBoosterHammer(board, 1, 1)).toBe(true);
    expect(board.blocks[1].chained).toBe(false);
    expect(board.gates[0].colorCursor).toBe(1);

    // 2. Rocket on Row 1 -> destroys block 2, triggering its Scissors (cutting rope on block 3)!
    expect(applyBoosterRocket(board, 1, 0, 'ROW')).toBe(true);
    expect(board.blocks[2].ropeColor).toBe(0);

    // 3. Vacuum on color 3 -> destroys block 3, triggering its Shutter Gem (opening Gate 1)!
    expect(applyBoosterVacuum(board, 3)).toBe(true);
    expect(board.gates[1].shutterOpen).toBe(true);

    // 4. Hammer on Wooden Crate at (2, 2)
    expect(applyBoosterHammer(board, 2, 2)).toBe(true);
    expect(board.crates[0].destroyed).toBe(true);

    // 5. Undo snapshot restoration + Hint/Solver check
    expect(savedSnapshot.blocks[0].status).toBe('ACTIVE');
    expect(findNextHintMove(board)).not.toBeNull();
  });

  it('computes star ratings and loss states accurately', () => {
    const board = createBoardState(getLevelSpec(1));
    board.parMoves = 4;
    board.moveLimit = 10; // slack 6 -> 3★ <= par + 2, 2★ <= par + 4 (STARS-SLACK-01)
    board.movesCommitted = 6;
    expect(computeEarnedStars(board)).toBe(3);
    board.movesCommitted = 8;
    expect(computeEarnedStars(board)).toBe(2);
    board.movesCommitted = 9;
    expect(computeEarnedStars(board)).toBe(1);

    board.timeRemainingSec = 0;
    expect(isBoardFailed(board, 'TIMED')).toEqual({ failed: true, reason: 'TIME_OUT' });
    expect(isBoardFailed(board, 'ZEN').failed).toBe(false);
  });

  it('supports snapGroupToNearestGrid and resolveClearCascade directly', () => {
    const board = createBoardState(getLevelSpec(1));
    board.blocks[0].x = 2.05;
    board.blocks[0].y = 1.02;
    expect(snapGroupToNearestGrid(board, 1)).toBe(true);
    expect(board.blocks[0].col).toBe(2);

    const cascade = resolveClearCascade(board, board.blocks[0], 0);
    expect(cascade.clearedBlockIds).toContain(1);
    expect(autoAdvanceColorQueues(board)).toBe(false);
  });

  it('glides smoothly without hitching or deadzones during curved/diagonal drags into wide gates on Level 1 (DRAG-04 / F-01)', () => {
    const board = createBoardState(getLevelSpec(1));

    // 1. Drag Block 1 (1x2 at row=1, col=1) along a curved trajectory through x=1.50 (half-cell center of the 3-wide TOP gate)
    let capturedGate1 = -1;
    let prevY = board.blocks[0].y;
    const totalFrames = 20;
    for (let f = 1; f <= totalFrames; f++) {
      const t = f / totalFrames;
      // Curved trajectory: swings right to x = 1.52 (right inside the [1.30, 1.70] mid-cell zone) while moving up to y = -0.05
      const targetX = 1.0 + 0.52 * Math.sin(t * Math.PI * 0.65);
      const targetY = 1.0 - 1.05 * t;

      const res = sweepBlockToTarget(board, 1, targetX, targetY, (lx, ly, svx, svy) => {
        const cap = checkMidDragGateCapture(board, 1, svx, svy, targetX - lx, targetY - ly);
        return cap ? cap.gateIndex : -1;
      });

      const stepDeltaY = prevY - res.leadY;
      // Must make smooth monotonic upward progress on every frame before capture (zero stuck frames, zero sudden snap jumps)
      expect(stepDeltaY).toBeGreaterThan(0.02);
      expect(stepDeltaY).toBeLessThan(0.12);
      prevY = res.leadY;

      if (res.capturedGateIndex >= 0) {
        capturedGate1 = res.capturedGateIndex;
        break;
      }
    }
    expect(capturedGate1).toBe(0);

    // 2. Verify zero mid-gate deadzones across the entire continuous aperture of Gate 0 (cols 1..3 for a 1x2 block -> minCol=1, maxCol=2)
    for (let x = 0.6; x <= 2.4 + 1e-6; x += 0.1) {
      const testBoard = createBoardState(getLevelSpec(1));
      testBoard.blocks[0].x = x;
      testBoard.blocks[0].y = 0.08;
      // Upward motion into gate must capture at every continuous X offset (including x = 1.50 dead-center)
      const cap = checkMidDragGateCapture(testBoard, 1, 0, -0.08, 0, -0.15);
      expect(cap).toEqual({ capturedBlockId: 1, gateIndex: 0 });
      // Purely horizontal or nearly-horizontal walk-by slide with slight upward drift must NOT accidentally suck the block in
      const walkBy = checkMidDragGateCapture(testBoard, 1, 0.12, 0, 0.12, 0);
      expect(walkBy).toBeNull();
      const driftedWalkBy = checkMidDragGateCapture(testBoard, 1, 0.18, -0.01, 1.2, -0.01);
      expect(driftedWalkBy).toBeNull();
    }

    // 3. Drag Block 2 (2x1 at row=2, col=3) along a curved diagonal trajectory to y=1.50 (center of 3-tall RIGHT gate)
    let capturedGate2 = -1;
    let prevX = board.blocks[1].x;
    for (let f = 1; f <= totalFrames; f++) {
      const t = f / totalFrames;
      const targetX = 3.0 + 1.05 * t;
      const targetY = 2.0 - 0.5 * Math.sin(t * Math.PI * 0.65);

      const res = sweepBlockToTarget(board, 2, targetX, targetY, (lx, ly, svx, svy) => {
        const cap = checkMidDragGateCapture(board, 2, svx, svy, targetX - lx, targetY - ly);
        return cap ? cap.gateIndex : -1;
      });

      const stepDeltaX = res.leadX - prevX;
      expect(stepDeltaX).toBeGreaterThan(0.02);
      expect(stepDeltaX).toBeLessThan(0.12);
      prevX = res.leadX;

      if (res.capturedGateIndex >= 0) {
        capturedGate2 = res.capturedGateIndex;
        break;
      }
    }
    expect(capturedGate2).toBe(1);
  });

  it('MYSTIC-TRACE-01 & ORIGIN-GHOST-01: simplifies L-turn & diagonal waypoints, picks occupied concave anchors, and honors reducedMotion & 0.50s lifetime', () => {
    // 1. Every polyomino shape's anchor cell offset must lie inside an actually occupied cell (never an empty concave notch)
    for (const shapeId of Object.keys(POLYOMINO_SHAPES)) {
      const shape = getShape(shapeId);
      const anchor = getShapeAnchorCellOffset(shape);
      const cellR = Math.floor(anchor.y);
      const cellC = Math.floor(anchor.x);
      expect(shape.cells.some(([dr, dc]) => dr === cellR && dc === cellC)).toBe(true);
    }

    // 2. Collinear straight steps collapse to 1 GPU segment; 90-degree L-turns curve smoothly around corners via Quadratic Bezier filleting without clipping obstacle corners
    const straight = buildTraceSegments([
      { x: 1.5, y: 2.5 },
      { x: 2.5, y: 2.5 },
      { x: 3.5, y: 2.5 },
      { x: 4.5, y: 2.5 },
    ]);
    expect(straight.segments).toHaveLength(1);
    expect(straight.totalLength).toBeCloseTo(3.0, 4);

    const lTurn = buildTraceSegments([
      { x: 1.5, y: 3.5 },
      { x: 2.5, y: 3.5 },
      { x: 3.5, y: 3.5 },
      { x: 3.5, y: 2.5 },
      { x: 3.5, y: 1.5 },
    ]);
    expect(lTurn.segments).toHaveLength(6); // Entry leg + 4 smooth Bezier corner chords + exit leg
    expect(lTurn.totalLength).toBeGreaterThan(3.6);
    expect(lTurn.totalLength).toBeLessThan(4.0);
    // Every curved vertex stays inside the open corridor (`x > 3.0` or `y > 3.0`), never cutting across obstacle cell `(row 2, col 2)` (`[2..3, 2..3]`)
    for (const seg of lTurn.segments) {
      expect(seg.x1 > 3.0 || seg.y1 > 3.0).toBe(true);
    }

    // 3. Committed shred trace extends outward into the exit gate, and open diagonal glides collapse stair-steps into 1 clean diagonal sweep
    const board = createBoardState(getLevelSpec(1));
    const shredTrace = buildCommittedMoveTrace(board, '1x2', 0, 1, 0, 1, 1, 0);
    expect(shredTrace).not.toBeNull();
    expect((shredTrace?.waypoints.length ?? 0) >= 2).toBe(true);

    commitBlockMove(board, 1, 4, 0, 'CHALLENGE');
    const diagTrace = buildCommittedMoveTrace(board, '1x2', 1, 1, 4, 0, 1, -1);
    expect(diagTrace).not.toBeNull();
    expect(diagTrace?.waypoints).toHaveLength(2);
    // Returning to the starting cell without shredding emits no trace
    expect(buildCommittedMoveTrace(board, '1x2', 4, 0, 4, 0, 1, -1)).toBeNull();

    // Uniform window slices true arc distance `s` (0 at tail -> span at head) for move-length-adaptive comet-tail narrowing
    const uniformBuf = new Float32Array(MAX_TRACE_UNIFORM_PTS * 4);
    const sampleTrace: VisualPathTrace = {
      segments: lTurn.segments,
      totalLength: lTurn.totalLength,
      colorId: 1,
      z: 0,
      age: 0.05,
      maxAge: 0.5,
    };
    const win = fillTraceUniformWindow(sampleTrace, 0.4, 2.9, uniformBuf);
    expect(win.pointCount).toBeGreaterThanOrEqual(3);
    expect(uniformBuf[2]).toBeCloseTo(0, 4);
    expect(uniformBuf[(win.pointCount - 1) * 4 + 2]).toBeCloseTo(2.5, 4);
    expect(win.maxX - win.minX).toBeGreaterThan(1.5);
    expect(win.maxY - win.minY).toBeGreaterThan(1.5);

    // 4. Pool cap, 0.50s motion-blur decay, and complete reducedMotion suppression
    const gov = new QualityGovernor();
    gov.setPreference('ULTRA_120');
    const activePathTraces: VisualPathTrace[] = [];
    const mockCtx = {
      qualityGovernor: gov,
      activePathTraces,
      lastOptions: { reducedMotion: false },
    } as unknown as RenderPassContext;

    for (let i = 0; i < 8; i++) {
      spawnPathTraceImpl(
        mockCtx,
        [
          { x: 0.5, y: 0.5 },
          { x: 2.5, y: 0.5 },
        ],
        1,
        0
      );
    }
    expect(activePathTraces).toHaveLength(5);

    stepPathTracesImpl(mockCtx, 0.25);
    expect(activePathTraces).toHaveLength(5);
    stepPathTracesImpl(mockCtx, 0.3); // 0.55s > 0.50s maxAge -> all expired cleanly
    expect(activePathTraces).toHaveLength(0);

    // Reduced motion blocks spawning AND clears in-flight traces immediately
    spawnPathTraceImpl(
      mockCtx,
      [
        { x: 0.5, y: 0.5 },
        { x: 3.5, y: 0.5 },
      ],
      2,
      0
    );
    expect(activePathTraces).toHaveLength(1);
    mockCtx.lastOptions = { reducedMotion: true };
    stepPathTracesImpl(mockCtx, 1 / 60);
    expect(activePathTraces).toHaveLength(0);
    spawnPathTraceImpl(
      mockCtx,
      [
        { x: 0.5, y: 0.5 },
        { x: 3.5, y: 0.5 },
      ],
      2,
      0
    );
    expect(activePathTraces).toHaveLength(0);
  });
});
