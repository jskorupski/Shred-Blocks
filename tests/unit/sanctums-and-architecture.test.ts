// @ts-expect-error Node built-in module resolved at runtime by Vitest
import fs from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by Vitest
import path from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd: () => string };
import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  commitBlockMove,
  createBoardState,
  isBoardWon,
} from '../../src/core/board';
import {
  getBlockRoomId,
  isBlockInLockedRoom,
  isBlockMovable,
  isRoomUnlocked,
} from '../../src/core/physics';
import type { LevelSpec } from '../../src/core/types';
import { computeStateHash, solveBoard } from '../../src/levels/solver';

describe('Multi-Room Portcullis Sanctums & Architectural Topologies', () => {
  it('SANCTUM-01 & SANCTUM-02: validates Multi-Room Portcullis Barriers (shredsRemaining, Key lockId, dormant room stasis, cross-room archway traversal, and Zero-Softlock Law)', () => {
    // 7x6 TWIN_SANCTUM split across row 3:
    // - South Courtyard (Room 0): rows 4..6
    // - Archway row 3: pillars at [3,0] and [3,5], Portcullis Barrier across [3,1..4] (shredsRemaining: 2)
    // - North Chamber (Room 1): rows 0..2 ( plus archway row 3)
    const room1Cells: Array<[number, number]> = [];
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 6; c++) {
        room1Cells.push([r, c]);
      }
    }

    const spec: LevelSpec = {
      id: 961,
      name: 'Twin Sanctum Portcullis',
      difficulty: 'NORMAL',
      layoutId: 'TWIN_SANCTUM',
      rows: 7,
      cols: 6,
      pillars: [
        [3, 0],
        [3, 5],
      ],
      barriers: [
        {
          id: 1,
          cells: [
            [3, 1],
            [3, 2],
            [3, 3],
            [3, 4],
          ],
          orientation: 'H',
          shredsRemaining: 2,
          unlocksRoomId: 1,
          roomCells: room1Cells,
        },
      ],
      blocks: [
        // South Courtyard (Room 0) blocks:
        { id: 1, shapeId: '1x2', row: 5, col: 1, colorStack: [1] },
        { id: 2, shapeId: '1x2', row: 5, col: 3, colorStack: [2] },
        // North Chamber (Room 1) block: Green 2x2 with bombCount=5 and iceCount=1 -> must stay dormant while Room 1 is sealed!
        { id: 3, shapeId: '2x2', row: 1, col: 2, colorStack: [3], bombCount: 5, iceCount: 1 },
      ],
      gates: [
        // South gates for Red (1), Blue (2), and Green (3)
        { edge: 'BOTTOM', spanStart: 0, spanLength: 3, colorQueue: [1, 3] },
        { edge: 'BOTTOM', spanStart: 3, spanLength: 3, colorQueue: [2] },
      ],
    };

    const board = createBoardState(spec);
    expect(board.barriers.length).toBe(1);
    expect(board.barriers[0].open).toBe(false);
    expect(board.barriers[0].shredsRemaining).toBe(2);
    // Closed barrier writes -3 into occupancy
    expect(board.occupancy[3 * 6 + 2]).toBe(-3);

    // North Chamber block (id=3) is in Room 1 and sealed
    expect(getBlockRoomId(board, board.blocks[2])).toBe(1);
    expect(isRoomUnlocked(board, 1)).toBe(false);
    expect(isBlockInLockedRoom(board, board.blocks[2])).toBe(true);
    expect(isBlockMovable(board, 3)).toBe(false);

    // Vacuum on Green (3) must NOT affect Block 3 while Room 1 is sealed
    expect(applyBoosterVacuum(board, 3)).toBe(false);

    // Shred Block 1 in Room 0 -> portcullis ticks down 2 -> 1
    const hashBefore = computeStateHash(board);
    const out1 = commitBlockMove(board, 1, 6, 1, 'ZEN');
    expect(out1.moved).toBe(true);
    expect(out1.clearedBlockIds).toContain(1);
    expect(out1.unlockedBarrierIds).toEqual([]);
    expect(board.barriers[0].shredsRemaining).toBe(1);
    expect(board.barriers[0].open).toBe(false);
    expect(computeStateHash(board)).not.toBe(hashBefore);

    // Dormant Room Stasis: Block 3's bombCount and iceCount did NOT tick down while Room 1 was locked!
    expect(board.blocks[2].bombCount).toBe(5);
    expect(board.blocks[2].iceCount).toBe(1);

    // Shred Block 2 in Room 0 -> portcullis ticks down 1 -> 0 and OPENS!
    const out2 = commitBlockMove(board, 2, 6, 3, 'ZEN');
    expect(out2.moved).toBe(true);
    expect(out2.clearedBlockIds).toContain(2);
    expect(out2.unlockedBarrierIds).toEqual([1]);
    expect(board.barriers[0].shredsRemaining).toBe(0);
    expect(board.barriers[0].open).toBe(true);
    expect(isRoomUnlocked(board, 1)).toBe(true);
    // Archway cells are now walkable floor (0)
    expect(board.occupancy[3 * 6 + 2]).toBe(0);

    // Clear ice on Block 3 and verify it can now slide from Room 1 (row 1) across the archway (row 3) to South gate (row 5)!
    board.blocks[2].iceCount = 0;
    expect(isBlockMovable(board, 3)).toBe(true);
    const solvedAfterUnlock = solveBoard(board, 300);
    expect(solvedAfterUnlock.solvable).toBe(true);
    const out3 = commitBlockMove(board, 3, 5, 1, 'ZEN');
    expect(out3.moved).toBe(true);
    expect(out3.clearedBlockIds).toContain(3);
    expect(isBoardWon(board)).toBe(true);

    // Also verify Key-Sealed Portcullis (`lockId: 1`) + Zero-Softlock Law
    const keyBarrierBoard = createBoardState({
      ...spec,
      barriers: [
        {
          id: 1,
          cells: [
            [3, 1],
            [3, 2],
            [3, 3],
            [3, 4],
          ],
          orientation: 'H',
          shredsRemaining: 0,
          lockId: 1,
          unlocksRoomId: 1,
          roomCells: room1Cells,
        },
      ],
      blocks: [
        { id: 1, shapeId: '1x2', row: 5, col: 1, colorStack: [1], hasKey: 1 },
        { id: 3, shapeId: '2x2', row: 1, col: 2, colorStack: [3] },
      ],
    });
    expect(keyBarrierBoard.barriers[0].open).toBe(false);
    // Solver solves the Key-Sealed 2-room board in 2 moves (shred Key block 1 -> unlocks Room 1 -> shred block 3)
    const keySolved = solveBoard(keyBarrierBoard, 400);
    expect(keySolved.solvable).toBe(true);
    expect(keySolved.minMoves).toBe(2);

    // Sealed-Room Stasis & Cutout Clamping Invariants (`MECH-16`..`MECH-18`):
    // Verify size-changing gate clamping on cutout edges, dormant gate stasis in locked rooms,
    // Key/Scissor priority in unlocked rooms, and elevator stasis in locked rooms.
    const stasisBoard = createBoardState({
      ...spec,
      cutouts: [
        [6, 0],
        [6, 5],
      ],
      elevators: [
        // Elevator inside locked Room 1 (row 1) -> must stay in stasis while Room 1 is sealed!
        { id: 1, row: 1, col: 0, width: 2, height: 1, deltaRow: 0, deltaCol: 1 },
      ],
      blocks: [
        // Room 1 chained block appears FIRST in blocks array, Room 0 chained block appears SECOND:
        // Key shredded in Room 0 must unlock Room 0's chained block first!
        { id: 10, shapeId: '1x1', row: 1, col: 0, colorStack: [3] },
        { id: 11, shapeId: '1x1', row: 0, col: 4, colorStack: [3], chained: true, lockId: 2 },
        { id: 1, shapeId: '1x2', row: 5, col: 1, colorStack: [1], hasKey: 2 },
        { id: 2, shapeId: '1x2', row: 4, col: 2, colorStack: [2], chained: true, lockId: 2 },
      ],
      gates: [
        // South gate on row 6 (where cols 0 and 5 are cutouts -> playable span is [1..4])
        {
          edge: 'BOTTOM',
          spanStart: 1,
          spanLength: 3,
          colorQueue: [1, 2, 3],
          sizeChangesOnClear: true,
          minLength: 2,
          maxLength: 4,
          slidesOnClear: true,
        },
        // North gate attached to locked Room 1 (row 0) with iceCount=2 and togglesOnClear=true
        {
          edge: 'TOP',
          spanStart: 1,
          spanLength: 3,
          colorQueue: [3],
          iceCount: 2,
          togglesOnClear: true,
          shutterOpen: true,
        },
      ],
    });

    // Shred Block 1 in Room 0 (carries Key 2, barrier has shredsRemaining: 2 so Room 1 stays locked after 1 shred):
    const stasisMove1 = commitBlockMove(stasisBoard, 1, 6, 1, 'ZEN');
    expect(stasisMove1.moved).toBe(true);
    expect(stasisBoard.barriers[0].open).toBe(false);
    // Key 2 unlocked Room 0's Block 2 (id=2), NOT locked Room 1's Block 11 (id=11)!
    expect(stasisBoard.blocks.find((b) => b.id === 2)!.chained).toBe(false);
    expect(stasisBoard.blocks.find((b) => b.id === 11)!.chained).toBe(true);
    // Locked Room 1's TOP gate kept its iceCount=2 and shutterOpen=true in stasis!
    expect(stasisBoard.gates[1].iceCount).toBe(2);
    expect(stasisBoard.gates[1].shutterOpen).toBe(true);
    // Locked Room 1's elevator did NOT move while Room 1 was sealed!
    expect(stasisBoard.elevators[0].atAlternatePos).toBe(false);
    // South gate on cutout edge stayed strictly within playable span [1..4] (never overlapping cutout col 0 or col 5)!
    expect(stasisBoard.gates[0].spanStart).toBeGreaterThanOrEqual(1);
    expect(stasisBoard.gates[0].spanStart + stasisBoard.gates[0].spanLength).toBeLessThanOrEqual(5);

    // Multi-Room Booster Shielding, Non-Convex Room Resolution & 4-Entry-Point Barrier Unlock Parity (`MECH-10`, `MECH-18`):
    // Verify crates/blocks in sealed rooms are shielded from Hammer & Rocket strikes,
    // smashing a Portcullis Barrier triggers ready generators in the newly awakened room,
    // non-convex polyominoes (`PLUS_5`) resolve their true roomId even when (row, col) is on a pillar,
    // and all destructive boosters (`Hammer`, `Rocket`, `Vacuum`) decrement `shredsRemaining` on Portcullis Barriers when clearing blocks in an unlocked room!
    const boosterShieldBoard = createBoardState({
      ...spec,
      pillars: [
        [0, 0],
        [3, 0],
        [3, 5],
      ],
      crates: [
        // Crate at (1, 4) inside sealed Room 1
        { id: 1, row: 1, col: 4, hp: 1 },
      ],
      generators: [
        // Ready generator at (2, 3) spawning at (2, 4) inside sealed Room 1 -> must stay dormant while sealed, then spawn when barrier is hammered!
        {
          id: 1,
          row: 2,
          col: 3,
          spawnRow: 2,
          spawnCol: 4,
          cooldown: 0,
          queue: [{ shapeId: '1x1', colorStack: [3] }],
        },
      ],
      blocks: [
        // Non-convex PLUS_5 at (0, 0) in Room 1 whose top-left [0, 0] cell sits on pillar [0, 0]
        { id: 20, shapeId: 'PLUS_5', row: 0, col: 0, colorStack: [3] },
        // Active blocks in Room 0 at (5, 2) and (4, 1)
        { id: 21, shapeId: '1x2', row: 5, col: 2, colorStack: [1] },
        { id: 22, shapeId: '1x2', row: 4, col: 1, colorStack: [2] },
      ],
    });

    // Generator in sealed Room 1 did NOT spawn during createBoardState while Room 1 was locked
    expect(boosterShieldBoard.generators[0].queueCursor).toBe(0);
    // Non-convex PLUS_5 at (0, 0) resolves to Room 1 even if [0, 0] is a pillar
    const plusBlock = boosterShieldBoard.blocks.find((b) => b.id === 20)!;
    expect(getBlockRoomId(boosterShieldBoard, plusBlock)).toBe(1);
    expect(isBlockInLockedRoom(boosterShieldBoard, plusBlock)).toBe(true);

    // Hammer on crate (1, 4) inside sealed Room 1 is rejected while Room 1 is locked
    expect(applyBoosterHammer(boosterShieldBoard, 1, 4)).toBe(false);
    expect(boosterShieldBoard.crates[0].destroyed).toBe(false);

    // Rocket along ROW 1 (passing through sealed Room 1 without hitting row 3 barrier) does NOT destroy crate or PLUS_5
    expect(applyBoosterRocket(boosterShieldBoard, 1, 2, 'ROW')).toBe(false);
    expect(boosterShieldBoard.crates[0].destroyed).toBe(false);
    expect(plusBlock.status).toBe('ACTIVE');

    // Rocket on unlocked Room 0 block at row 5 decrements barrier shredsRemaining from 2 -> 1!
    expect(applyBoosterRocket(boosterShieldBoard, 5, 2, 'ROW')).toBe(true);
    expect(boosterShieldBoard.barriers[0].shredsRemaining).toBe(1);
    expect(boosterShieldBoard.barriers[0].open).toBe(false);

    // Vacuum on unlocked Room 0 color 2 block decrements barrier shredsRemaining from 1 -> 0, opening the Portcullis AND triggering Room 1's ready generator!
    expect(applyBoosterVacuum(boosterShieldBoard, 2)).toBe(true);
    expect(boosterShieldBoard.barriers[0].shredsRemaining).toBe(0);
    expect(boosterShieldBoard.barriers[0].open).toBe(true);
    expect(boosterShieldBoard.generators[0].queueCursor).toBe(1);
  });

  it('ARCH-ERGONOMICS-01: enforces single-call agentic file-size limits (<= 800 lines and <= 45,000 bytes) across all repository source, style, test, script, and doc files', () => {
    const repoRoot = path.resolve(process.cwd());
    const trackedExtensions = new Set(['.ts', '.css', '.html', '.md', '.js', '.json', '.jsonc', '.svg']);
    const ignoredDirs = new Set(['node_modules', 'dist', '.git', '.certs']);
    const ignoredFiles = new Set(['package-lock.json']);

    const collectFiles = (dir: string, acc: string[] = []): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name) as string;
        if (entry.isDirectory()) {
          collectFiles(fullPath, acc);
        } else if (
          !ignoredFiles.has(entry.name) &&
          trackedExtensions.has(path.extname(entry.name) as string)
        ) {
          acc.push(fullPath);
        }
      }
      return acc;
    };

    const files = collectFiles(repoRoot);
    expect(files.length).toBeGreaterThanOrEqual(65);

    const violations: string[] = [];
    for (const filePath of files) {
      const rel = path.relative(repoRoot, filePath);
      const buf = fs.readFileSync(filePath);
      const lineCount = buf.toString('utf8').split('\n').length;
      const byteCount = buf.byteLength;
      if (lineCount > 800 || byteCount > 45_000) {
        violations.push(`${rel} (${lineCount} lines, ${byteCount} bytes)`);
      }
    }

    expect(violations).toEqual([]);
  });
});

