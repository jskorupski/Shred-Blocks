import { describe, expect, it } from 'vitest';
import { applyBoosterHammer, commitBlockMove, createBoardState, isBoardWon } from '../../src/core/board';
import {
  checkBlockGateClearance,
  checkMidDragGateCapture,
  findEligibleGateForBlockAt,
  resolveClearCascade,
  stepDynamicGatesOnShred,
  stepMovingElevators,
} from '../../src/core/gate-clearance';
import {
  isBlockInLockedRoom,
  isContinuousOffsetValid,
  isRoomUnlocked,
  sweepBlockToTarget,
} from '../../src/core/physics';
import { getShape } from '../../src/core/polyomino';
import type { LevelSpec } from '../../src/core/types';
import { getAllCampaignLevels, getLevelSpec, TOTAL_CAMPAIGN_LEVELS } from '../../src/levels/catalog';
import {
  countBlockCenterPayloads,
  countBlockImmobilizers,
  countBlockModifiers,
  getDifficultyForLevel,
  MAX_MODIFIERS_PER_BLOCK,
} from '../../src/levels/generator';
import { computeAdmissibleHeuristic, computeStateHash, solveBoard } from '../../src/levels/solver';

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
    let sculptedOrMultiRoomCount = 0;
    let multiRoomCount = 0;

    // Verify milestone architectural debuts
    expect(getLevelSpec(14).layoutId).toBe('CROSS_ATRIUM');
    expect(getLevelSpec(18).layoutId).toBe('L_WING');
    expect(getLevelSpec(18).gates[0].edgeLine).toBe(2);
    expect(getLevelSpec(22).layoutId).toBe('T_PAVILION');
    expect(getLevelSpec(25).layoutId).toBe('TWIN_SANCTUM');
    expect(getLevelSpec(25).barriers?.length).toBe(1);

    for (const spec of campaign) {
      expect(spec.difficulty).toBe(getDifficultyForLevel(spec.id));
      if (spec.id <= 13) {
        expect(spec.cutouts ?? []).toHaveLength(0);
        expect(spec.barriers ?? []).toHaveLength(0);
      }
      if (
        (spec.layoutId && spec.layoutId !== 'RECTANGLE') ||
        (spec.cutouts && spec.cutouts.length > 0) ||
        (spec.barriers && spec.barriers.length > 0)
      ) {
        sculptedOrMultiRoomCount++;
      }
      if (spec.barriers && spec.barriers.length > 0) {
        multiRoomCount++;
      }
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
      const barrierAndVaultCells = new Set<string>();
      for (const bar of spec.barriers ?? []) {
        for (const [br, bc] of bar.cells) {
          const key = `${br},${bc}`;
          expect(occupiedCells.has(key), `Level ${spec.id} barrier overlaps at (${key})`).toBe(false);
          expect(
            barrierAndVaultCells.has(key),
            `Level ${spec.id} barrier overlaps another barrier at (${key})`
          ).toBe(false);
          barrierAndVaultCells.add(key);
          if (!bar.isVault) {
            occupiedCells.add(key);
          }
        }
      }
      for (const crate of spec.crates ?? []) {
        const key = `${crate.row},${crate.col}`;
        expect(
          occupiedCells.has(key) || barrierAndVaultCells.has(key),
          `Level ${spec.id} crate overlaps at (${key})`
        ).toBe(false);
        occupiedCells.add(key);
      }
      for (const blk of spec.blocks) {
        const sh = getShape(blk.shapeId);
        for (const [dr, dc] of sh.cells) {
          const r = blk.row + dr;
          const c = blk.col + dc;
          expect(
            r >= 0 && r < spec.rows && c >= 0 && c < spec.cols,
            `Level ${spec.id} block ${blk.id} out of bounds`
          ).toBe(true);
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

      // Architectural Topology & Gate Invariant Checks (`MECH-16`..`MECH-18`):
      // 1. Verify no two gates on the same `(edge, edgeLine)` overlap in span, and no gate span or sliding range overlaps a VOID cutout (`occupancy === -1`)
      for (let gi = 0; gi < board.gates.length; gi++) {
        const g = board.gates[gi];
        const minCheck = g.slidesOnClear ? g.slideMin : g.spanStart;
        const maxCheck = g.slidesOnClear ? g.slideMax + g.spanLength : g.spanStart + g.spanLength;
        for (let s = minCheck; s < maxCheck; s++) {
          const r = g.edge === 'TOP' || g.edge === 'BOTTOM' ? g.edgeLine : s;
          const c = g.edge === 'TOP' || g.edge === 'BOTTOM' ? s : g.edgeLine;
          expect(
            board.occupancy[r * board.cols + c],
            `Level ${spec.id} gate ${gi} (${g.edge} line ${g.edgeLine}) cell (${r},${c}) overlaps VOID cutout`
          ).not.toBe(-1);
        }
        for (let gj = gi + 1; gj < board.gates.length; gj++) {
          const g2 = board.gates[gj];
          if (g.edge === g2.edge && g.edgeLine === g2.edgeLine) {
            const overlaps =
              g.spanStart < g2.spanStart + g2.spanLength && g2.spanStart < g.spanStart + g.spanLength;
            expect(
              overlaps,
              `Level ${spec.id} gates ${gi} and ${gj} overlap on ${g.edge} (line ${g.edgeLine})`
            ).toBe(false);
          }
        }
      }

      // 2. Verify no generator housing/spawn cell or elevator footprint overlaps cutouts, pillars, or barriers
      for (const gen of board.generators) {
        expect(board.occupancy[gen.row * board.cols + gen.col]).toBeGreaterThanOrEqual(0);
        expect(board.occupancy[gen.spawnRow * board.cols + gen.spawnCol]).toBeGreaterThanOrEqual(0);
        expect(isRoomUnlocked(board, board.roomMap[gen.row * board.cols + gen.col])).toBe(true);
      }
      for (const elev of board.elevators) {
        for (const step of [0, 1]) {
          for (let dr = 0; dr < elev.height; dr++) {
            for (let dc = 0; dc < elev.width; dc++) {
              const er = elev.row + elev.deltaRow * step + dr;
              const ec = elev.col + elev.deltaCol * step + dc;
              expect(
                board.occupancy[er * board.cols + ec],
                `Level ${spec.id} elevator overlaps obstacle at (${er},${ec})`
              ).toBeGreaterThanOrEqual(0);
              expect(isRoomUnlocked(board, board.roomMap[er * board.cols + ec])).toBe(true);
            }
          }
        }
      }

      // 3. On multi-room TWIN_SANCTUM levels, verify carrier payloads and bombs start in unlocked Room 0
      if (board.barriers.length > 0) {
        for (const blk of board.blocks) {
          if (blk.hasKey > 0 || blk.scissorColor > 0 || blk.shutterGemColor > 0 || blk.bombCount > 0) {
            expect(
              isBlockInLockedRoom(board, blk),
              `Level ${spec.id} block ${blk.id} carrier/bomb must start in unlocked room`
            ).toBe(false);
          }
        }
      }

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
    expect(sculptedOrMultiRoomCount).toBeGreaterThanOrEqual(120);
    expect(multiRoomCount).toBeGreaterThanOrEqual(15);

    // Verify Endless Mastery levels 301..330 (including 310, 315, 320, 330)
    for (let eid = 301; eid <= 330; eid++) {
      const endlessSpec = getLevelSpec(eid);
      const eBoard = createBoardState(endlessSpec);
      for (let gi = 0; gi < eBoard.gates.length; gi++) {
        const g = eBoard.gates[gi];
        const minCheck = g.slidesOnClear ? g.slideMin : g.spanStart;
        const maxCheck = g.slidesOnClear ? g.slideMax + g.spanLength : g.spanStart + g.spanLength;
        for (let s = minCheck; s < maxCheck; s++) {
          const r = g.edge === 'TOP' || g.edge === 'BOTTOM' ? g.edgeLine : s;
          const c = g.edge === 'TOP' || g.edge === 'BOTTOM' ? s : g.edgeLine;
          expect(eBoard.occupancy[r * eBoard.cols + c]).not.toBe(-1);
        }
        for (let gj = gi + 1; gj < eBoard.gates.length; gj++) {
          const g2 = eBoard.gates[gj];
          if (g.edge === g2.edge && g.edgeLine === g2.edgeLine) {
            const overlaps =
              g.spanStart < g2.spanStart + g2.spanLength && g2.spanStart < g.spanStart + g.spanLength;
            expect(overlaps, `Endless Level ${eid} gates ${gi} and ${gj} overlap on ${g.edge}`).toBe(false);
          }
        }
      }
      const endlessRes = solveBoard(eBoard, 600);
      expect(endlessRes.solvable).toBe(true);
    }
  }, 25_000);
});

describe('Physics, Gate Cascade & Solver Edge-Case Invariants', () => {
  it('prevents diagonal wall-slide paralysis, respects axis lock in corner bevel, and enforces substep floor exemption', () => {
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

    // Substep floor exemption: Block 2 (color 2) starts on mismatched floor tile (2, 1) (color 1).
    // At current substep (exemptDx=0, exemptDy=0), it can slide right to dx=1.0 (col 2).
    // Once at (exemptDx=1.0, exemptDy=0), it can NO LONGER re-enter col 1 (dx=0.5)!
    const blk2 = board.blocks[1];
    expect(isContinuousOffsetValid(board, [blk2], 0.5, 0, 0, 0)).toBe(true);
    expect(isContinuousOffsetValid(board, [blk2], 0.5, 0, 1.0, 0)).toBe(false);
  });

  it('steps all dynamic gates globally on shred, hammers Stone & non-convex blocks by blockId, and triggers full booster cascade', () => {
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

  it('detaches glued multi-layer blocks on peel, checks shifted glued siblings in gate raycast, jams elevator on glued shear, and grants +2 bomb bonus on peel', () => {
    const spec: LevelSpec = {
      id: 952,
      name: 'Glued Peel, Raycast & Elevator Jam',
      difficulty: 'NORMAL',
      rows: 6,
      cols: 6,
      elevators: [{ id: 1, row: 3, col: 1, width: 1, height: 1, deltaRow: 0, deltaCol: 1 }],
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

    // Shifted glued sibling raycast check:
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

    // Stepping elevators must jam Elevator 1 because passenger Block 3 is glued to outside sibling Block 4
    stepMovingElevators(board);
    expect(board.elevators[0].col).toBe(1);
    expect(board.blocks[2].col).toBe(1);

    // Peel multi-layer Block 1 at TOP gate (0, 2) -> grants +2 bomb bonus (5 -> 7) and detaches groupId 1!
    board.blocks[0].row = 0;
    board.blocks[1].row = 1;
    resolveClearCascade(board, board.blocks[0], 0);
    expect(board.blocks[0].colorCursor).toBe(1);
    expect(board.blocks[0].bombCount).toBe(7);
    expect(board.blocks[0].groupId).toBe(0);
    expect(board.blocks[1].groupId).toBe(0);
  });

  it('validates F-08 queued-only auto-advance, corridor reachability, Zobrist hash fields, and F-01/F-07 tie-breaking', () => {
    const spec: LevelSpec = {
      id: 953,
      name: 'F-08, Reachability, Hash & Tie-Breaker',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      pillars: [
        [1, 0],
        [1, 1],
        [1, 2],
        [1, 3],
        [1, 4],
      ], // Complete wall across row 1
      blocks: [{ id: 1, shapeId: '1x1', row: 0, col: 0, colorStack: [1] }],
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

    // Even though 3 gates show color 1 and supply[1] === 1, only 1 gate is a queued gate (Gate 0),
    // so Gate 0 must NOT auto-advance prematurely while supply[1] === 1!
    expect(board.gates[0].colorCursor).toBe(0);

    // Block 1 at (0, 0) cannot teleport across the pillar wall at row 1 to (2, 0)
    expect(commitBlockMove(board, 1, 2, 0, 'ZEN').moved).toBe(false);

    // Perpendicular walk-by (stepVecX = +0.15, stepVecY = 0) along TOP gate must NOT capture an unlocked block
    expect(checkMidDragGateCapture(board, 1, 0.15, 0)).toBeNull();
    // F-07 Resource Priority Tie-Breaker at (0, 0) with zero velocity prefers Static Normal Gate (index 2) over Star Gate (index 1) and Queued Gate (index 0)
    expect(findEligibleGateForBlockAt(board, board.blocks[0], 0, 0, 0, 0)).toBe(2);

    // computeStateHash distinguishes scissorColor, shutterGemColor, groupId, and sizeDir
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

  it('F-02, DRAG-01, DRAG-02 & DRAG-06: prevents stationary unmoved block auto-shred, enforces axis-lock gate exit direction, locks diagonal sweep to orthogonal channels, and prevents dynamic gate softlocks', () => {
    const spec: LevelSpec = {
      id: 954,
      name: 'Cascade Isolation & Orthogonal Sweep Invariants',
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
    // Strict Cascade Isolation: Stationary unmoved Block 2 at (5, 2) must remain ACTIVE on the board!
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

  it('COURTYARD-01 & GATE-STEP-01: validates Sculpted Non-Rectangular Courtyards, exterior VOID cutouts, and Stepped-Edge Exit Gates (edgeLine)', () => {
    // 6x6 L_WING courtyard where top-right 3x3 quadrant (r=0..2, c=3..5) is exterior VOID (-1)
    const cutouts: Array<[number, number]> = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 3; c < 6; c++) {
        cutouts.push([r, c]);
      }
    }

    const spec: LevelSpec = {
      id: 960,
      name: 'East Wing Stepped Gate',
      difficulty: 'NORMAL',
      layoutId: 'L_WING',
      rows: 6,
      cols: 6,
      cutouts,
      blocks: [
        // Block 1: Red 2x2 at (4, 3) -> slides up to (3, 3) to exit stepped TOP gate at edgeLine=3
        { id: 1, shapeId: '2x2', row: 4, col: 3, colorStack: [1] },
        // Block 2: Blue non-convex L3_TL at (2, 0) -> slides right & up to (0, 1) to exit stepped RIGHT gate
        { id: 2, shapeId: 'L3_TL', row: 2, col: 0, colorStack: [2] },
      ],
      gates: [
        // Stepped TOP gate along the inner East Wing roof (c=3..5, auto-detects edgeLine=3)
        { edge: 'TOP', spanStart: 3, spanLength: 3, colorQueue: [1, 2], iceCount: 1 },
        // Stepped RIGHT gate along the West Tower upper wall (r=0..2, auto-detects edgeLine=2)
        { edge: 'RIGHT', spanStart: 0, spanLength: 3, colorQueue: [2] },
      ],
    };

    const board = createBoardState(spec);
    expect(board.layoutId).toBe('L_WING');
    // Auto-detected stepped edgeLine: row 3 for East Wing TOP gate, col 2 for West Tower RIGHT gate
    expect(board.gates[0].edgeLine).toBe(3);
    expect(board.gates[1].edgeLine).toBe(2);

    // Hammer at (3, 4) shatters the iced stepped-edge TOP gate
    expect(applyBoosterHammer(board, 3, 4)).toBe(true);
    expect(board.gates[0].iceCount).toBe(0);

    // Solver finds optimal 2-move solution on the L_WING stepped-gate board
    const solved = solveBoard(board, 400);
    expect(solved.solvable).toBe(true);
    expect(solved.minMoves).toBe(2);

    // Execute Move 1: Red 2x2 slides from (4, 3) to (3, 3) and shreds out stepped TOP gate (edgeLine=3)
    const m1 = commitBlockMove(board, 1, 3, 3, 'ZEN');
    expect(m1.moved).toBe(true);
    expect(m1.clearedBlockIds).toContain(1);
    expect(board.gates[0].colorCursor).toBe(1); // Advances to Blue (2)

    // Execute Move 2: Blue corner_tl_2x2 slides to (0, 1) to shred out stepped RIGHT gate (edgeLine=2)
    const m2 = commitBlockMove(board, 2, 0, 1, 'ZEN');
    expect(m2.moved).toBe(true);
    expect(m2.clearedBlockIds).toContain(2);
    expect(isBoardWon(board)).toBe(true);
  });
});
