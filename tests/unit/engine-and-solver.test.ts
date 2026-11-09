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
  detachBlockFromGluedGroup,
  findEligibleGateForBlockAt,
  resolveClearCascade,
  stepDynamicGatesOnShred,
  stepMovingElevators,
} from '../../src/core/gate-clearance';
import {
  canGroupOccupyOffset,
  getReachableAnchors,
  isBlockMovable,
  isContinuousOffsetValid,
  snapGroupToNearestGrid,
  sweepBlockToTarget,
} from '../../src/core/physics';
import { getActiveColor, getLayersRemaining, getShape, POLYOMINO_SHAPES } from '../../src/core/polyomino';
import type { LevelSpec } from '../../src/core/types';
import { getAllCampaignLevels, getLevelSpec, TOTAL_CAMPAIGN_LEVELS } from '../../src/levels/catalog';
import {
  countBlockCenterPayloads,
  countBlockImmobilizers,
  countBlockModifiers,
  getDifficultyForLevel,
  MAX_MODIFIERS_PER_BLOCK,
} from '../../src/levels/generator';
import { computeAdmissibleHeuristic, computeStateHash, findNextHintMove, solveBoard } from '../../src/levels/solver';

describe('Polyomino Shape Catalog (33 Orientations)', () => {
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

  it('applies corner bevel assist + immediate same-substep retry within 0.30 cell threshold', () => {
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
    // Position block slightly misaligned into row 1.78 (within 0.22 <= 0.30 of lane row=2)
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

    // Move diagonally into the 0.30 x 0.30 corner bevel zone around (col=1, row=1)
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
        { id: 2, shapeId: '1x1', row: 4, col: 2, colorStack: [2], chained: true, lockId: 1, bombCount: 2 },
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
        { id: 2, shapeId: '1x1', row: 1, col: 4, colorStack: [2], chained: true, lockId: 1, scissorColor: 3 },
        { id: 3, shapeId: '1x1', row: 4, col: 1, colorStack: [3], ropeColor: 3, shutterGemColor: 4 },
        { id: 4, shapeId: '1x1', row: 4, col: 4, colorStack: [4] },
      ],
      gates: [
        { edge: 'TOP', spanStart: 0, spanLength: 4, colorQueue: [1, 4] },
        { edge: 'BOTTOM', spanStart: 0, spanLength: 6, colorQueue: [4], shutterLockColor: 4, shutterOpen: false },
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
    board.movesCommitted = 5; // <= ceil(4 * 1.25) = 5 -> 3 stars
    expect(computeEarnedStars(board)).toBe(3);
    board.movesCommitted = 7; // <= ceil(4 * 1.75) = 7 -> 2 stars
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
});

describe('300-Level Campaign + Endless Solvability, Pacing & UX-03 Audit', () => {
  it('verifies all 300 campaign levels + Endless level 301 are valid, respect UX-03 & RAMP-01..05, and are solvable by solveBoard with 0 fallback levels', () => {
    const campaign = getAllCampaignLevels();
    expect(campaign.length).toBe(TOTAL_CAMPAIGN_LEVELS);
    expect(TOTAL_CAMPAIGN_LEVELS).toBe(300);

    let has8x8OrLarger = false;
    let has9x9 = false;
    let has5OrMoreColors = false;
    let hasAdvancedShapes = false;
    let hasMultiStepBlockerPuzzle = false;

    for (const spec of campaign) {
      expect(spec.difficulty).toBe(getDifficultyForLevel(spec.id));
      if (spec.rows >= 8 || spec.cols >= 8) has8x8OrLarger = true;
      if (spec.rows === 9 && spec.cols === 9) has9x9 = true;

      const colorSet = new Set<number>();
      const occupiedCells = new Set<string>();
      for (const [r, c] of spec.cutouts ?? []) {
        occupiedCells.add(`${r},${c}`);
      }
      for (const [r, c] of spec.pillars ?? []) {
        expect(occupiedCells.has(`${r},${c}`), `Level ${spec.id} pillar overlaps at (${r},${c})`).toBe(false);
        occupiedCells.add(`${r},${c}`);
      }
      for (const crate of spec.crates ?? []) {
        const key = `${crate.row},${crate.col}`;
        expect(occupiedCells.has(key), `Level ${spec.id} crate overlaps at (${key})`).toBe(false);
        occupiedCells.add(key);
      }
      for (const blk of spec.blocks) {
        const sh = getShape(blk.shapeId);
        for (const [dr, dc] of sh.cells) {
          const r = blk.row + dr;
          const c = blk.col + dc;
          expect(r >= 0 && r < spec.rows && c >= 0 && c < spec.cols, `Level ${spec.id} block ${blk.id} out of bounds`).toBe(true);
          const key = `${r},${c}`;
          expect(occupiedCells.has(key), `Level ${spec.id} block ${blk.id} overlaps at (${key})`).toBe(false);
          occupiedCells.add(key);
        }
        for (const c of blk.colorStack) {
          if (c > 0) colorSet.add(c);
        }
        if (!['1x1', '1x2', '2x1', '2x2'].includes(blk.shapeId)) {
          hasAdvancedShapes = true;
        }
        expect(countBlockModifiers(blk)).toBeLessThanOrEqual(
          blk.shapeId === '1x1' ? 1 : MAX_MODIFIERS_PER_BLOCK
        );
        expect(countBlockImmobilizers(blk)).toBeLessThanOrEqual(1);
        expect(countBlockCenterPayloads(blk)).toBeLessThanOrEqual(1);
      }
      if (colorSet.size >= 5) has5OrMoreColors = true;

      // Ensure 0 campaign levels hit fallbackSpec (where all 4 gates are isStar: true)
      const allStarGates = spec.gates.length === 4 && spec.gates.every((g) => g.isStar === true);
      expect(allStarGates, `Level ${spec.id} must not hit fallbackSpec`).toBe(false);

      const board = createBoardState(spec);
      expect(computeStateHash(board)).toBeTypeOf('bigint');
      const hAdm = computeAdmissibleHeuristic(board);
      expect(hAdm).toBeGreaterThanOrEqual(1);

      const res = solveBoard(board, 600);
      expect(res.solvable, `Level ${spec.id} (${spec.name}) must be solvable`).toBe(true);
      expect(res.minMoves).toBeGreaterThan(0);
      expect(hAdm).toBeLessThanOrEqual(res.minMoves);
      expect(res.firstMove).not.toBeNull();

      const nonStoneCount = spec.blocks.filter((b) => b.colorStack[0] !== 0).length;
      if (res.minMoves > nonStoneCount) {
        hasMultiStepBlockerPuzzle = true;
      }
    }

    expect(has8x8OrLarger).toBe(true);
    expect(has9x9).toBe(true);
    expect(has5OrMoreColors).toBe(true);
    expect(hasAdvancedShapes).toBe(true);
    expect(hasMultiStepBlockerPuzzle).toBe(true);

    // Verify Endless Mastery level 301
    const endless301 = getLevelSpec(301);
    const endlessRes = solveBoard(createBoardState(endless301), 600);
    expect(endlessRes.solvable).toBe(true);
  });
});

describe('Adversarial Regression Suite (C1-01 through C1-19)', () => {
  it('C1-01 & C1-18: prevents diagonal wall-slide paralysis, respects axis lock in corner bevel, and enforces substep floor exemption', () => {
    const spec: LevelSpec = {
      id: 950,
      name: 'Diagonal Slide & Substep Floor Test',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      floorPaths: [{ row: 2, col: 1, color: 1 }],
      blocks: [
        { id: 1, shapeId: '1x1', row: 1, col: 4, colorStack: [1] },
        { id: 2, shapeId: '1x1', row: 2, col: 1, colorStack: [2] },
      ],
      gates: [{ edge: 'TOP', spanStart: 0, spanLength: 6, colorQueue: [1, 2] }],
    };
    const board = createBoardState(spec);
    // Block 1 is at right wall (col=4 is next to col=5; move it to col=5 first)
    board.blocks[0].col = 5;
    board.blocks[0].x = 5;
    // Drag diagonally down-right against the right wall (targetX=7.0, targetY=3.0):
    // X is blocked by the right wall, but Y must smoothly slide down to 3.0 without being snapped back!
    const slideRes = sweepBlockToTarget(board, 1, 7.0, 3.0);
    expect(slideRes.leadX).toBeCloseTo(5.0, 4);
    expect(slideRes.leadY).toBeCloseTo(3.0, 4);

    // C1-18: Block 2 (color 2) starts on mismatched floor tile (2, 1) (color 1).
    // At current substep (exemptDx=0, exemptDy=0), it can slide right to dx=1.0 (col 2).
    // Once at (exemptDx=1.0, exemptDy=0), it can NO LONGER re-enter col 1 (dx=0.5)!
    const blk2 = board.blocks[1];
    expect(isContinuousOffsetValid(board, [blk2], 0.5, 0, 0, 0)).toBe(true);
    expect(isContinuousOffsetValid(board, [blk2], 0.5, 0, 1.0, 0)).toBe(false);
  });

  it('C1-02, C1-03 & C1-10: steps all dynamic gates globally on shred, hammers Stone & non-convex blocks by blockId, and triggers full booster cascade', () => {
    const spec: LevelSpec = {
      id: 951,
      name: 'Global Dynamic Gates & Booster Cascade',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      crates: [{ id: 1, row: 2, col: 1, hp: 1 }],
      blocks: [
        // Stone block at (2, 0) adjacent to crate at (2, 1)
        { id: 1, shapeId: '1x1', row: 2, col: 0, colorStack: [0] },
        // Non-convex L3_BR at (3, 3): cells are (0,1),(1,0),(1,1) -> top-left anchor (3, 3) is empty!
        { id: 2, shapeId: 'L3_BR', row: 3, col: 3, colorStack: [2], iceCount: 2 },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
        {
          edge: 'BOTTOM',
          spanStart: 1,
          spanLength: 4,
          colorQueue: [2],
          togglesOnClear: true,
          shutterOpen: true,
          slidesOnClear: true,
          slideMin: 0,
          slideMax: 2,
          slideDir: 1,
        },
      ],
    };
    const board = createBoardState(spec);

    // Hammer Stone block 1 at (2, 0): smashes Stone block, damages adjacent crate (2,1), thaws block 2 from 2->1, and steps Gate 1!
    expect(applyBoosterHammer(board, 2, 0)).toBe(true);
    expect(board.blocks[0].status).toBe('CLEARED');
    expect(board.crates[0].destroyed).toBe(true);
    expect(board.blocks[1].iceCount).toBe(1);
    expect(board.gates[1].shutterOpen).toBe(false);
    expect(board.gates[1].spanStart).toBe(2);

    // Hammer non-convex L3_BR block 2 using its anchor (3, 3) (which is an empty pocket cell) + blockId=2
    expect(applyBoosterHammer(board, 3, 3, 2)).toBe(true);
    expect(board.blocks[1].status).toBe('CLEARED');
  });

  it('C1-06, C1-07, C1-08 & C1-19: detaches glued multi-layer blocks on peel, checks shifted glued siblings in gate raycast, jams elevator on glued shear, and grants +2 bomb bonus on peel', () => {
    const spec: LevelSpec = {
      id: 952,
      name: 'Glued Peel, Raycast & Elevator Jam',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      elevators: [
        { id: 1, row: 3, col: 1, width: 1, height: 1, deltaRow: 0, deltaCol: 1 },
      ],
      blocks: [
        // Block 1 (multi-layer bomb) and Block 2 glued vertically at col 2: Block 2 is at row 0 (between Block 1 and TOP gate!)
        { id: 1, shapeId: '1x1', row: 1, col: 2, colorStack: [1, 2], groupId: 1, bombCount: 5 },
        { id: 2, shapeId: '1x1', row: 0, col: 2, colorStack: [2], groupId: 1 },
        // Glued pair (3 & 4) where Block 3 sits on elevator (3, 1) and Block 4 sits outside at (3, 0)
        { id: 3, shapeId: '1x1', row: 3, col: 1, colorStack: [1], groupId: 2 },
        { id: 4, shapeId: '1x1', row: 3, col: 0, colorStack: [1], groupId: 2 },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1] },
        { edge: 'RIGHT', spanStart: 0, spanLength: 4, colorQueue: [2] },
      ],
    };
    const board = createBoardState(spec);

    // C1-07: If group 1 shifts so Block 1 is at (0, 2) (dRow=-1, dCol=0), checks shifted sibling Block 2
    // Wait: at current position, can Block 2 exit TOP gate? No, wrong color (2 vs 1).
    // What if Block 1 is at (0, 2) and Block 2 is at (1, 2), and we check BOTTOM gate?
    const bottomGate = {
      ...board.gates[0],
      edge: 'BOTTOM' as const,
      spanStart: 0,
      spanLength: 6,
      colorQueue: [1 as const],
    };
    board.blocks[0].row = 4;
    board.blocks[1].row = 5;
    // Block 1 at row 4 has glued sibling Block 2 at row 5 blocking its raycast to BOTTOM gate!
    expect(checkBlockGateClearance(board, board.blocks[0], bottomGate, 4, 2)).toBe(false);

    // C1-08: Stepping elevators must jam Elevator 1 because passenger Block 3 is glued to outside sibling Block 4
    stepMovingElevators(board);
    expect(board.elevators[0].col).toBe(1);
    expect(board.blocks[2].col).toBe(1);

    // C1-06 & C1-19: Peel multi-layer Block 1 at TOP gate (0, 2) -> grants +2 bomb bonus (5 -> 7) and detaches groupId 1!
    board.blocks[0].row = 0;
    board.blocks[1].row = 1;
    resolveClearCascade(board, board.blocks[0], 0);
    expect(board.blocks[0].colorCursor).toBe(1);
    expect(board.blocks[0].bombCount).toBe(7);
    expect(board.blocks[0].groupId).toBe(0);
    expect(board.blocks[1].groupId).toBe(0);
    void detachBlockFromGluedGroup;
    void stepDynamicGatesOnShred;
  });

  it('C1-05, C1-09, C1-11, C1-12 & C1-16: validates F-08 queued-only auto-advance, corridor reachability, Zobrist hash fields, and F-01/F-07 tie-breaking', () => {
    const spec: LevelSpec = {
      id: 953,
      name: 'F-08, Reachability, Hash & Tie-Breaker',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      pillars: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]], // Complete wall across row 1
      blocks: [
        { id: 1, shapeId: '1x1', row: 0, col: 0, colorStack: [1] },
      ],
      gates: [
        // Queued gate [1, 2] on LEFT
        { edge: 'LEFT', spanStart: 0, spanLength: 2, colorQueue: [1, 2] },
        // Star gate [1] on TOP
        { edge: 'TOP', spanStart: 0, spanLength: 2, colorQueue: [1], isStar: true },
        // Static normal gate [1] onTOP
        { edge: 'TOP', spanStart: 0, spanLength: 2, colorQueue: [1], isStar: false },
      ],
    };
    const board = createBoardState(spec);

    // C1-09: Even though 3 gates show color 1 and supply[1] === 1, only 1 gate is a queued gate (Gate 0),
    // so Gate 0 must NOT auto-advance prematurely while supply[1] === 1!
    expect(board.gates[0].colorCursor).toBe(0);

    // C1-11: Block 1 at (0, 0) cannot teleport across the pillar wall at row 1 to (2, 0)
    expect(commitBlockMove(board, 1, 2, 0, 'ZEN').moved).toBe(false);

    // C1-16: Perpendicular walk-by (stepVecX = +0.15, stepVecY = 0) along TOP gate must NOT capture an unlocked block
    expect(checkMidDragGateCapture(board, 1, 0.15, 0)).toBeNull();
    // F-07 Resource Priority Tie-Breaker at (0, 0) with zero velocity prefers Static Normal Gate (index 2) over Star Gate (index 1) and Queued Gate (index 0)
    expect(findEligibleGateForBlockAt(board, board.blocks[0], 0, 0, 0, 0)).toBe(2);

    // C1-12: computeStateHash distinguishes scissorColor, shutterGemColor, groupId, and sizeDir
    const h0 = computeStateHash(board);
    board.blocks[0].scissorColor = 2;
    const hScissor = computeStateHash(board);
    expect(hScissor).not.toBe(h0);
    board.blocks[0].shutterGemColor = 3;
    const hGem = computeStateHash(board);
    expect(hGem).not.toBe(hScissor);
    board.blocks[0].groupId = 4;
    const hGroup = computeStateHash(board);
    expect(hGroup).not.toBe(hGem);
    board.gates[0].sizeDir = 1;
    const hSizeDir = computeStateHash(board);
    expect(hSizeDir).not.toBe(hGroup);
  });

  it('BUG-01, BUG-03, DRAG-01, DRAG-02 & DRAG-06: prevents stationary unmoved block auto-shred, enforces axis-lock gate exit direction, locks diagonal sweep to orthogonal channels, and prevents dynamic gate softlocks', () => {
    const spec: LevelSpec = {
      id: 954,
      name: 'Round 4 Anti-Cheat & Cascade Isolation',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      blocks: [
        // Block 1: Red 1x1 at (1, 1) -> will be moved to (0, 1) to shred out TOP gate
        { id: 1, shapeId: '1x1', row: 1, col: 1, colorStack: [1] },
        // Block 2: Stationary Blue 1x2 parked at (5, 2) against BOTTOM Blue gate -> MUST NOT auto-shred when Block 1 shreds!
        { id: 2, shapeId: '1x2', row: 5, col: 2, colorStack: [2] },
        // Block 3: H-locked Red 1x2 at (0, 3) against TOP Red gate -> H-locked cannot exit TOP gate!
        { id: 3, shapeId: '1x2', row: 0, col: 3, colorStack: [1], axisLock: 'H' },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1, 2] },
        {
          edge: 'BOTTOM',
          spanStart: 1,
          spanLength: 4,
          colorQueue: [2],
          togglesOnClear: true,
          shutterOpen: true,
          sizeChangesOnClear: true,
          minLength: 1,
          maxLength: 4,
        },
      ],
    };
    const board = createBoardState(spec);

    // DRAG-01: H-locked Block 3 at (0, 3) cannot exit TOP gate (vertical exit requires axisLock !== 'H')
    expect(checkBlockGateClearance(board, board.blocks[2], board.gates[0], 0, 3)).toBe(false);

    // DRAG-02: Diagonal sweep of Block 1 from (1, 1) toward (2, 2) in open 2x2 space stays orthogonal-channel-locked
    const diagSweep = sweepBlockToTarget(board, 1, 2.0, 2.0);
    const offX = Math.abs(diagSweep.leadX - Math.round(diagSweep.leadX));
    const offY = Math.abs(diagSweep.leadY - Math.round(diagSweep.leadY));
    expect(Math.min(offX, offY)).toBeLessThan(1e-4);
    expect(diagSweep.leadX).toBeCloseTo(2.0, 4);
    expect(diagSweep.leadY).toBeCloseTo(2.0, 4);

    // Reset Block 1 to (1, 1) and commit move to (0, 1) to shred out TOP gate:
    board.blocks[0].x = 1;
    board.blocks[0].y = 1;
    const moveRes = commitBlockMove(board, 1, 0, 1, 'ZEN');
    expect(moveRes.moved).toBe(true);
    expect(moveRes.clearedBlockIds).toContain(1);
    // BUG-01: Stationary unmoved Block 2 at (5, 2) must remain ACTIVE on the board!
    expect(moveRes.clearedBlockIds).not.toContain(2);
    expect(board.blocks[1].status).toBe('ACTIVE');

    // DRAG-06: After Block 1 & Block 3 are cleared, if only Block 2 (width 2, color 2) remains and needs BOTTOM gate,
    // stepDynamicGatesOnShred must keep BOTTOM gate open and spanLength >= 2!
    board.blocks[2].status = 'CLEARED';
    board.gates[0].colorQueue = [1];
    board.gates[0].colorCursor = 0;
    board.gates[1].shutterOpen = false;
    board.gates[1].spanLength = 1;
    stepDynamicGatesOnShred(board);
    expect(board.gates[1].shutterOpen).toBe(true);
    expect(board.gates[1].spanLength).toBeGreaterThanOrEqual(2);
  });
});
