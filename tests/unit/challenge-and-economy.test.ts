import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBoosterHammer,
  applyBoosterHint,
  carryLiveResourcesIntoUndo,
  commitBlockMove,
  computeDefaultMoveLimit,
  computeEarnedStars,
  createBoardState,
  getTimedBombTickSec,
  hasFinalTouchGrace,
  isBoardDeadlocked,
  isBoardFailed,
  isBoardWon,
  ONBOARDING_RESCUE_MAX_LEVEL,
} from '../../src/core/board';
import type { LevelSpec, SavePayloadV1 } from '../../src/core/types';
import { getLevelSpec } from '../../src/levels/catalog';
import { verifyFirstMoveSafety } from '../../src/levels/generator';
import { solveBoard } from '../../src/levels/solver';
import { decodeSaveCode, encodeSaveCode } from '../../src/storage/save-code';
import {
  CONTINUE_COIN_COST,
  createDefaultSavePayload,
  migrateLegacyEconomy,
  SAVE_STORAGE_KEY,
  SaveManager,
  THEME_TIER_PRICES,
} from '../../src/storage/save-manager';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('Challenge Mode, Touch-Move Coalescing, Hint Free Moves, Authentic L26+ Rules & Economy v2', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('enforces CHALLENGE Move Budget, buzzer-beater final-move wins, OUT_OF_MOVES failure, and Gold Star rules', () => {
    expect(computeDefaultMoveLimit(3, 'NORMAL', 1)).toBe(9);
    expect(computeDefaultMoveLimit(10, 'HARD', 50)).toBe(13);
    expect(computeDefaultMoveLimit(14, 'SUPER_HARD', 250)).toBe(16);

    const spec: LevelSpec = {
      id: 40,
      name: 'Buzzer Beater Test',
      difficulty: 'HARD',
      rows: 5,
      cols: 5,
      parMoves: 2,
      moveLimit: 2,
      blocks: [
        { id: 1, shapeId: '1x1', row: 2, col: 1, colorStack: [1] },
        { id: 2, shapeId: '1x1', row: 2, col: 3, colorStack: [2] },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 2, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 2, spanLength: 2, colorQueue: [2] },
      ],
    };

    // Case A: Buzzer-beater win on the final move (`movesRemaining === 0` AND `isBoardWon === true`)
    const winBoard = createBoardState(spec);
    expect(winBoard.movesRemaining).toBe(2);
    commitBlockMove(winBoard, 1, 0, 1, 'CHALLENGE');
    expect(winBoard.movesRemaining).toBe(1);
    commitBlockMove(winBoard, 2, 4, 3, 'CHALLENGE');
    expect(winBoard.movesRemaining).toBe(0);
    expect(isBoardWon(winBoard)).toBe(true);
    expect(isBoardFailed(winBoard, 'CHALLENGE')).toEqual({ failed: false, reason: null });
    expect(computeEarnedStars(winBoard, 'CHALLENGE', false)).toBe(3);
    expect(computeEarnedStars(winBoard, 'CHALLENGE', true)).toBe(0);
    expect(computeEarnedStars(winBoard, 'ZEN', false)).toBe(0);

    // Case B: Exhausting movesRemaining without clearing all blocks triggers OUT_OF_MOVES in CHALLENGE (not ZEN)
    const failBoard = createBoardState(spec);
    commitBlockMove(failBoard, 1, 2, 2, 'CHALLENGE', 0, 0, false);
    commitBlockMove(failBoard, 2, 3, 3, 'CHALLENGE', 0, 0, false);
    expect(failBoard.movesRemaining).toBe(0);
    expect(isBoardWon(failBoard)).toBe(false);
    expect(isBoardFailed(failBoard, 'CHALLENGE')).toEqual({
      failed: true,
      reason: 'OUT_OF_MOVES',
    });
    expect(isBoardFailed(failBoard, 'ZEN')).toEqual({ failed: false, reason: null });
  });

  it('coalesces consecutive adjustments of the same block into 1 move tick and honors +2 Free Moves from Hint', () => {
    const spec: LevelSpec = {
      id: 42,
      name: 'Coalesce & Free Moves Test',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      parMoves: 4,
      moveLimit: 6,
      blocks: [
        { id: 1, shapeId: '1x1', row: 3, col: 0, colorStack: [1] },
        { id: 2, shapeId: '1x1', row: 2, col: 2, colorStack: [2], bombCount: 5 },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 2, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 2, colorQueue: [2] },
      ],
    };

    const board = createBoardState(spec);
    // Drag 1 of Block 1: (3,0) -> (3,1) costs 1 move tick and ticks bomb 5 -> 4
    const m1 = commitBlockMove(board, 1, 3, 1, 'CHALLENGE');
    expect(m1.coalesced).toBe(false);
    expect(board.movesCommitted).toBe(1);
    expect(board.movesRemaining).toBe(5);
    expect(board.blocks[1].bombCount).toBe(4);

    // Drag 2 of Block 1: (3,1) -> (1,1) coalesces! 0 extra move ticks, bomb stays at 4!
    const m2 = commitBlockMove(board, 1, 1, 1, 'CHALLENGE');
    expect(m2.coalesced).toBe(true);
    expect(board.movesCommitted).toBe(1);
    expect(board.movesRemaining).toBe(5);
    expect(board.blocks[1].bombCount).toBe(4);

    // Drag 3 of Block 1 into TOP gate: (1,1) -> (0,1) ALSO coalesces and resets lastMovedBlockId!
    const m3 = commitBlockMove(board, 1, 0, 1, 'CHALLENGE');
    expect(m3.coalesced).toBe(true);
    expect(m3.clearedBlockIds).toContain(1);
    expect(board.movesCommitted).toBe(1);
    expect(board.movesRemaining).toBe(5);
    expect(board.lastMovedBlockId).toBe(0);

    // Activate HINT in CHALLENGE mode -> highlights hintMove + grants +2 Free Moves!
    expect(
      applyBoosterHint(board, 'CHALLENGE', {
        blockId: 2,
        targetRow: 4,
        targetCol: 2,
        exitsGateIndex: 1,
      })
    ).toBe(true);
    expect(board.freeMovesRemaining).toBe(2);
    expect(board.hintMove?.blockId).toBe(2);

    // Move 1 under Free Moves (allowCoalesce=false to force 2 distinct ticks): consumes 1 free move, 0 moves, 0 bomb ticks!
    commitBlockMove(board, 2, 2, 1, 'CHALLENGE', 0, 0, false);
    expect(board.freeMovesRemaining).toBe(1);
    expect(board.movesRemaining).toBe(5);
    expect(board.blocks[1].bombCount).toBe(4);

    // Move 2 under Free Moves: consumes final free move, still 5 moves remaining and bomb at 4!
    commitBlockMove(board, 2, 3, 1, 'CHALLENGE', 0, 0, false);
    expect(board.freeMovesRemaining).toBe(0);
    expect(board.movesRemaining).toBe(5);
    expect(board.blocks[1].bombCount).toBe(4);

    // Next move resumes normal budget & bomb ticking
    commitBlockMove(board, 2, 3, 2, 'CHALLENGE', 0, 0, false);
    expect(board.movesRemaining).toBe(4);
    expect(board.blocks[1].bombCount).toBe(3);
  });

  it('enforces UX-03 First-Move Safety on L1–12 and disables silent engine rescues on L26+ while keeping Booster rescues (C1-03)', () => {
    expect(ONBOARDING_RESCUE_MAX_LEVEL).toBe(25);

    for (let id = 1; id <= 12; id++) {
      const b = createBoardState(getLevelSpec(id));
      expect(verifyFirstMoveSafety(b, 260), `Level ${id} must satisfy UX-03 First-Move Safety`).toBe(true);
    }

    // Build identical parity-trap board at Level 20 (rescued) vs Level 30 (authentic dead-end!)
    const makeShutterParitySpec = (id: number): LevelSpec => ({
      id,
      name: 'Shutter Parity Test',
      difficulty: 'NORMAL',
      rows: 5,
      cols: 5,
      blocks: [
        { id: 1, shapeId: '1x1', row: 1, col: 2, colorStack: [1] },
        { id: 2, shapeId: '1x1', row: 3, col: 2, colorStack: [2] },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] },
        // Open shutter for Color 2: shredding Block 1 toggles it CLOSED with 0 other blocks left to re-open it!
        {
          edge: 'BOTTOM',
          spanStart: 1,
          spanLength: 3,
          colorQueue: [2],
          togglesOnClear: true,
          shutterOpen: true,
        },
      ],
    });

    const b20 = createBoardState(makeShutterParitySpec(20));
    commitBlockMove(b20, 1, 0, 2, 'CHALLENGE');
    // Onboarding rescue (L<=25) pops the shutter back open so beginners aren't trapped
    expect(b20.gates[1].shutterOpen).toBe(true);

    const b30 = createBoardState(makeShutterParitySpec(30));
    commitBlockMove(b30, 1, 0, 2, 'CHALLENGE');
    // Authentic L26+ rule: shutter stays CLOSED because player shredded in the wrong parity order!
    expect(b30.gates[1].shutterOpen).toBe(false);

    // C1-03 Zero-Softlock Booster Law: Hammer on a crate/block STILL runs forceRescue = true even on L30+!
    const b30Booster = createBoardState({
      ...makeShutterParitySpec(30),
      crates: [{ id: 1, row: 0, col: 0, hp: 1 }],
    });
    commitBlockMove(b30Booster, 1, 0, 2, 'CHALLENGE');
    expect(b30Booster.gates[1].shutterOpen).toBe(false);
    expect(applyBoosterHammer(b30Booster, 0, 0)).toBe(true);
    expect(b30Booster.gates[1].shutterOpen).toBe(true);

    // Deadlock detector catches sealed-in 1x1 block with 0 legal moves
    const deadlocked = createBoardState({
      id: 35,
      name: 'Sealed Pocket',
      difficulty: 'HARD',
      rows: 5,
      cols: 5,
      pillars: [
        [1, 2],
        [3, 2],
        [2, 1],
        [2, 3],
      ],
      blocks: [{ id: 1, shapeId: '1x1', row: 2, col: 2, colorStack: [1] }],
      gates: [{ edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1] }],
    });
    expect(isBoardDeadlocked(deadlocked)).toBe(true);
  });

  it('validates Economy v2, Zen Clear badges, 25-Star Reliquary Chests, locked setCurrentLevel, and v1 migration', () => {
    expect(CONTINUE_COIN_COST).toBe(150);
    expect(THEME_TIER_PRICES).toEqual([0, 250, 450, 750, 1200]);

    const defaults = createDefaultSavePayload();
    expect(defaults.settings.playMode).toBe('CHALLENGE');
    expect(defaults.coins).toBe(120);
    expect(defaults.boosters).toEqual({
      UNDO: 3,
      HINT: 2,
      HAMMER: 1,
      ROCKET: 1,
      VACUUM: 1,
    });
    expect(defaults.economyVersion).toBe(2);

    const manager = new SaveManager();

    // Locked setCurrentLevel: cannot jump ahead of highestLevelUnlocked without allowJump = true
    expect(manager.setCurrentLevel(50).currentLevelId).toBe(1);
    expect(manager.setCurrentLevel(50, true).currentLevelId).toBe(50);
    manager.setCurrentLevel(1, true);

    // Build a 2-win streak in Gold Star mode first
    manager.recordLevelWin(1, 5, 15, 5, 3, 6, 'NORMAL', false);
    manager.recordLevelWin(2, 5, 15, 5, 3, 6, 'NORMAL', false);
    expect(manager.getPayload().winStreak).toBe(2);

    // Zen Clear on Level 3: awards 0 Gold Stars, marks zenCleared = true, advances unlock to 4, and PAUSES winStreak at 2!
    const zenWin = manager.recordLevelWin(3, 9, 25, 6, 0, 6, 'NORMAL', true);
    expect(zenWin.zenClear).toBe(true);
    expect(zenWin.starsEarned).toBe(0);
    expect(zenWin.baseCoins).toBe(10);
    expect(zenWin.streakCoins).toBe(0);
    expect(manager.getPayload().winStreak).toBe(2);
    expect(manager.getPayload().levelRecords[3]?.zenCleared).toBe(true);
    expect(manager.getPayload().levelRecords[3]?.stars).toBe(0);

    // Replaying Level 3 in Challenge Mode upgrades it to 3 Gold Stars and awards full first-Gold-clear coins!
    const goldUpgrade = manager.recordLevelWin(3, 6, 18, 6, 3, 6, 'NORMAL', false);
    expect(goldUpgrade.isFirstClear).toBe(true);
    expect(goldUpgrade.baseCoins).toBe(15);
    expect(goldUpgrade.starCoins).toBe(15);
    expect(manager.getPayload().winStreak).toBe(3);
    expect(manager.getPayload().levelRecords[3]?.stars).toBe(3);

    // Reach 25 Gold Stars (9 x 3 = 27 stars) -> triggers 25-Star Reliquary Chest (+90 Coins + 1 Booster)!
    let reliquaryOpened = 0;
    for (let lvl = 4; lvl <= 9; lvl++) {
      const res = manager.recordLevelWin(lvl, 5, 15, 5, 3, 6, 'NORMAL', false);
      reliquaryOpened += res.starReliquaryChestsOpened;
    }
    expect(reliquaryOpened).toBe(1);
    expect(manager.getPayload().starReliquaryLevel).toBe(25);
    expect(manager.getPayload().totalStars).toBe(27);

    // Round-trip zenCleared + starReliquaryLevel + CHALLENGE mode through compact SB1-... save code!
    manager.recordLevelWin(10, 8, 20, 6, 0, 6, 'SUPER_HARD', true);
    const code = encodeSaveCode(manager.getPayload());
    const decoded = decodeSaveCode(code);
    expect(decoded.settings.playMode).toBe('CHALLENGE');
    expect(decoded.starReliquaryLevel).toBe(25);
    expect(decoded.economyVersion).toBe(2);
    expect(decoded.levelRecords[10]?.zenCleared).toBe(true);

    // Legacy v1 Save Migration: soft-compresses bloated v1 coins (>600) and upgrades default 'ZEN' -> 'CHALLENGE'
    const legacyV1: SavePayloadV1 = {
      ...createDefaultSavePayload(),
      economyVersion: 1,
      coins: 5600,
      highestLevelUnlocked: 20,
      currentLevelId: 20,
      settings: {
        ...createDefaultSavePayload().settings,
        playMode: 'ZEN',
      },
    };
    localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacyV1));
    const migratedManager = new SaveManager();
    const migrated = migratedManager.getPayload();
    expect(migrated.economyVersion).toBe(2);
    expect(migrated.settings.playMode).toBe('CHALLENGE');
    expect(migrated.coins).toBe(2212); // 600 + round((5600 - 600)^0.72 * 3.5) = 2212
  });

  it('delivers genuine multi-step blocker staging and calibrated gates across mid/late Campaign & Endless', () => {
    const sampleIds = [50, 100, 150, 200, 250, 300, 305];
    let totalStagingMoves = 0;
    for (const id of sampleIds) {
      const spec = getLevelSpec(id);
      const board = createBoardState(spec);
      const solved = solveBoard(board, 600);
      expect(solved.solvable).toBe(true);
      const nonStoneLayers = spec.blocks
        .filter((b) => b.colorStack[0] !== 0)
        .reduce((sum, b) => sum + b.colorStack.length, 0);
      totalStagingMoves += Math.max(0, solved.minMoves - nonStoneLayers);
      expect(spec.gates.every((g) => g.spanLength <= 4)).toBe(true);
    }
    expect(totalStagingMoves).toBeGreaterThanOrEqual(14);
  });

  it('STARS-SLACK-01, UNDO-RES-01, TIMED-BOMB-01 & ECON hardening: slack-scaled stars, Continue 1★ cap, undo resource carry, timed fuse pacing, Zen-skip & migration guards', () => {
    // 1. Every star tier stays reachable on tight SUPER_HARD budgets (slack = 2) and FTUE budgets (slack = 6)
    const board = createBoardState(getLevelSpec(1));
    board.parMoves = 15;
    board.moveLimit = 17;
    const starsAt = (moves: number) => {
      board.movesCommitted = moves;
      return computeEarnedStars(board, 'CHALLENGE', false);
    };
    expect([starsAt(15), starsAt(16), starsAt(17)]).toEqual([3, 2, 1]);
    board.parMoves = 4;
    board.moveLimit = 10;
    expect([starsAt(6), starsAt(8), starsAt(10)]).toEqual([3, 2, 1]);
    board.continuesUsed = 1;
    expect(starsAt(4)).toBe(1);
    board.timeLimitSec = 60;
    board.timeRemainingSec = 59;
    expect(computeEarnedStars(board, 'TIMED', false)).toBe(1);

    // 2. Undo never rewinds the TIMED clock/fuses and never deletes purchased Free Moves or Continue caps
    const restored = createBoardState(getLevelSpec(1));
    const live = createBoardState(getLevelSpec(1));
    restored.timeRemainingSec = 80;
    live.timeRemainingSec = 41;
    live.freeMovesRemaining = 2;
    live.freezeRemainingSec = 6;
    live.continuesUsed = 1;
    carryLiveResourcesIntoUndo(restored, live, 'TIMED');
    expect(restored.timeRemainingSec).toBe(41);
    expect(restored.freeMovesRemaining).toBe(2);
    expect(restored.freezeRemainingSec).toBe(6);
    expect(restored.continuesUsed).toBe(1);
    const challengeRestored = createBoardState(getLevelSpec(1));
    challengeRestored.timeRemainingSec = 80;
    carryLiveResourcesIntoUndo(challengeRestored, live, 'CHALLENGE');
    expect(challengeRestored.timeRemainingSec).toBe(80);

    // 3. TIMED bomb fuses burn one tick per move-equivalent of clock time (never 1 tick/sec)
    const timed = createBoardState(getLevelSpec(1));
    timed.timeLimitSec = 60;
    timed.parMoves = 12;
    expect(getTimedBombTickSec(timed)).toBe(5);
    timed.parMoves = 100;
    expect(getTimedBombTickSec(timed)).toBe(2.5);

    // 4. Skipping a Zen-cleared stage never resets it into a re-farmable first clear
    const manager = new SaveManager();
    manager.recordLevelWin(3, 6, 30, 3, 0, 4, 'NORMAL', true);
    manager.recordLevelSkip(3);
    expect(manager.getPayload().levelRecords[3]?.zenCleared).toBe(true);
    expect(manager.getPayload().levelRecords[3]?.skipped).not.toBe(true);

    // 5. Economy v1 -> v2 migration never increases a balance (601..688 band)
    const legacy = createDefaultSavePayload();
    legacy.economyVersion = 1;
    legacy.coins = 650;
    expect(migrateLegacyEconomy(legacy).coins).toBeLessThanOrEqual(650);
  });

  it('FINAL-TOUCH-01, ZEN-CALM-01 & STUCK-01: free final touch of the last-moved block, inert Zen bombs, and provable stuck detection', () => {
    const spec: LevelSpec = {
      id: 43,
      name: 'Final Touch Test',
      difficulty: 'HARD',
      rows: 5,
      cols: 5,
      parMoves: 2,
      moveLimit: 2,
      blocks: [
        { id: 1, shapeId: '1x1', row: 3, col: 0, colorStack: [1] },
        { id: 2, shapeId: '1x1', row: 2, col: 2, colorStack: [2], bombCount: 9 },
      ],
      gates: [
        { edge: 'TOP', spanStart: 1, spanLength: 2, colorQueue: [1] },
        { edge: 'BOTTOM', spanStart: 1, spanLength: 2, colorQueue: [2] },
      ],
    };

    // 1. Spending the last tick on a slide defers OUT_OF_MOVES while that block can still finish into its gate
    const board = createBoardState(spec);
    commitBlockMove(board, 2, 2, 1, 'CHALLENGE');
    commitBlockMove(board, 1, 3, 3, 'CHALLENGE');
    expect(board.movesRemaining).toBe(0);
    expect(hasFinalTouchGrace(board)).toBe(true);
    expect(isBoardFailed(board, 'CHALLENGE').failed).toBe(false);
    // Any other block's move is rejected outright (no free extra moves)
    expect(commitBlockMove(board, 2, 4, 1, 'CHALLENGE').moved).toBe(false);
    // Finishing the last-moved block is a free coalesced touch; with block 2 still left, the run then fails
    const finish = commitBlockMove(board, 1, 0, 2, 'CHALLENGE');
    expect(finish.coalesced).toBe(true);
    expect(finish.clearedBlockIds).toContain(1);
    expect(isBoardFailed(board, 'CHALLENGE')).toEqual({ failed: true, reason: 'OUT_OF_MOVES' });

    // 2. Zen: fuses never tick or detonate while bombsInert
    const zen = createBoardState(spec);
    zen.bombsInert = true;
    commitBlockMove(zen, 1, 3, 3, 'ZEN');
    commitBlockMove(zen, 2, 2, 1, 'ZEN');
    expect(zen.blocks[1].bombCount).toBe(9);
    zen.blocks[1].bombCount = 0;
    expect(isBoardFailed(zen, 'ZEN').failed).toBe(false);
    zen.bombsInert = false;
    expect(isBoardFailed(zen, 'ZEN')).toEqual({ failed: true, reason: 'BOMB_EXPLODED' });

    // 3. Exhaustive solver probes distinguish a proof of unsolvability from a budget timeout
    const solvable = solveBoard(createBoardState(spec), 450);
    expect(solvable.solvable).toBe(true);
    const tiny = solveBoard(createBoardState(getLevelSpec(200)), 1);
    expect(tiny.solvable).toBe(false);
    expect(tiny.searchExhausted).toBe(false);
  });
});
