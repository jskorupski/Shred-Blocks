import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBoosterHammer,
  applyBoosterHint,
  commitBlockMove,
  computeEarnedStars,
  isBoardWon,
} from '../../src/core/board';
import {
  carryLiveResourcesIntoUndo,
  cloneBoardState,
  createBoardState,
  isBoardRunStarted,
} from '../../src/core/board-state';
import type { SavePayloadV1 } from '../../src/core/types';
import { getLevelSpec } from '../../src/levels/catalog';
import { decodeSaveCode, encodeSaveCode } from '../../src/storage/save-code';
import {
  canSkipZenLevel,
  countUniqueClearedLevels,
  createDefaultSavePayload,
  getEffectiveBoosterUnlockLevel,
  migrateLegacyEconomy,
  SAVE_STORAGE_KEY,
  SaveManager,
  UNDER_PAR_ORACLE_COINS,
  ZEN_MAX_CONSECUTIVE_SKIPS,
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

describe('MAP-MODE-SPLIT-01, ZEN-STARS-01 & SAVE-COMPAT-01: Per-Mode Ladders, Zen Stars/Blessings & 0xa6 Codec', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('maintains independent Challenge, Zen, and Timed ladders while sharing global highestLevelUnlocked for booster unlocks and Level-10 chests', () => {
    const mgr = new SaveManager();

    // Advance Zen Mode to Level 10 via 9 clears (also exercises Zen Stars & Zen Blessings)
    mgr.updateSettings({ playMode: 'ZEN' });
    for (let lvl = 1; lvl <= 9; lvl++) {
      mgr.recordLevelWin(lvl, 6, 20, 4, 0, 5, 'NORMAL', true);
    }

    let save = mgr.getPayload();
    expect(save.modeState.ZEN).toEqual({ currentLevelId: 10, highestUnlocked: 10 });
    expect(save.modeState.CHALLENGE).toEqual({ currentLevelId: 1, highestUnlocked: 1 });
    expect(save.modeState.TIMED).toEqual({ currentLevelId: 1, highestUnlocked: 1 });
    // Global highestLevelUnlocked unlocks Hint (L2) and Hammer (L8) across ALL modes!
    expect(save.highestLevelUnlocked).toBe(10);

    // Level 10 genuine first clear in Zen triggers the Global Level-10 Milestone Chest once
    const zenMilestone = mgr.recordLevelWin(10, 8, 25, 5, 0, 6, 'SUPER_HARD', true);
    expect(zenMilestone.milestoneChestOpened).toBe(true);
    expect(mgr.getPayload().milestoneChestLevel).toBe(10);

    // Switching to Challenge Mode starts at Level 1 on the Challenge ladder
    save = mgr.updateSettings({ playMode: 'CHALLENGE' });
    expect(save.currentLevelId).toBe(1);
    expect(mgr.setCurrentLevel(8).currentLevelId).toBe(1); // Cannot jump to Zen-unlocked L8 in Challenge!

    // Clearing Level 1 in Challenge advances Challenge to L2 without altering Timed (L1) or Zen (L11)
    const chWin = mgr.recordLevelWin(1, 3, 10, 4, 3, 4, 'NORMAL', false);
    expect(chWin.isFirstClear).toBe(true);
    expect(chWin.starsEarned).toBe(3);

    // Switching to Timed and clearing Level 1 awards additive Gold Stars (+3★ Timed on top of +3★ Challenge + 3 Zen★ = 9★!)
    mgr.updateSettings({ playMode: 'TIMED' });
    const tmWin = mgr.recordLevelWin(1, 4, 9, 4, 3, 4, 'NORMAL', false);
    expect(tmWin.isFirstClear).toBe(true);
    expect(tmWin.starsImproved).toBe(3);

    const finalSave = mgr.getPayload();
    expect(finalSave.modeState.CHALLENGE).toEqual({ currentLevelId: 2, highestUnlocked: 2 });
    expect(finalSave.modeState.TIMED).toEqual({ currentLevelId: 2, highestUnlocked: 2 });
    expect(finalSave.modeState.ZEN).toEqual({ currentLevelId: 11, highestUnlocked: 11 });
    expect(finalSave.levelRecords[1]?.challengeStars).toBe(3);
    expect(finalSave.levelRecords[1]?.timedStars).toBe(3);
    expect(finalSave.levelRecords[1]?.zenCleared).toBe(true);
    expect(finalSave.zenStarsEarned).toBe(3); // 10 unique Zen clears -> floor(10/3) = 3 Zen ★
    expect(finalSave.totalStars).toBe(9); // 3 Challenge + 3 Timed + 3 Zen

    // Even if Challenge later reaches Level 10, Milestone Chest 10 does NOT double-trigger
    for (let lvl = 2; lvl <= 10; lvl++) {
      mgr.updateSettings({ playMode: 'CHALLENGE' });
      const res = mgr.recordLevelWin(lvl, 5, 12, 4, 2, 5, 'NORMAL', false);
      if (lvl === 10) {
        expect(res.milestoneChestOpened).toBe(false);
      }
    }
  });

  it('awards +1 Zen Gold Star every 3 unique Zen clears, banks +1 Zen Blessing every 4 unique clears (cap 3), prevents replay/skip farming, and consumes blessings cleanly', () => {
    const mgr = new SaveManager();
    mgr.updateSettings({ playMode: 'ZEN' });

    // Skipping in Zen advances the ladder but awards 0 Zen Star / Blessing progress
    mgr.recordLevelSkip(1);
    expect(mgr.getPayload().zenStarProgress).toBe(0);
    expect(mgr.getPayload().zenBlessingProgress).toBe(0);
    expect(mgr.getPayload().modeState.ZEN.highestUnlocked).toBe(2);

    // Clear L2, L3, L4 (3 unique clears -> +1 Zen Star on L4!)
    expect(mgr.recordLevelWin(2, 5, 15, 3, 0, 4, 'NORMAL', true).zenStarAwarded).toBe(false);
    expect(mgr.recordLevelWin(3, 5, 15, 3, 0, 4, 'NORMAL', true).zenStarAwarded).toBe(false);
    const thirdUnique = mgr.recordLevelWin(4, 5, 15, 3, 0, 4, 'NORMAL', true);
    expect(thirdUnique.zenStarAwarded).toBe(true);
    expect(thirdUnique.starCoins).toBe(5);
    expect(mgr.getPayload().totalStars).toBe(1);
    expect(mgr.getPayload().zenStarsEarned).toBe(1);
    expect(mgr.getPayload().zenStarProgress).toBe(0);
    expect(mgr.getPayload().zenBlessings).toBe(0);
    expect(mgr.getPayload().zenBlessingProgress).toBe(3);

    // Replaying already-cleared L2 in Zen awards +2 replay coins and 0 Star/Blessing progress
    const replay = mgr.recordLevelWin(2, 4, 12, 3, 0, 4, 'NORMAL', true);
    expect(replay.isFirstClear).toBe(false);
    expect(replay.baseCoins).toBe(2);
    expect(mgr.getPayload().zenStarProgress).toBe(0);
    expect(mgr.getPayload().zenBlessingProgress).toBe(3);

    // 4th unique Zen clear (L5) banks 1st Zen Blessing!
    const fourthUnique = mgr.recordLevelWin(5, 6, 18, 4, 0, 5, 'NORMAL', true);
    expect(fourthUnique.zenBlessingAwarded).toBe(true);
    expect(mgr.getPayload().zenBlessings).toBe(1);
    expect(mgr.getPayload().zenBlessingProgress).toBe(0);

    // Clear 12 more unique Zen levels (L6..L17) -> Zen Blessings cap strictly at 3
    for (let lvl = 6; lvl <= 17; lvl++) {
      mgr.recordLevelWin(lvl, 6, 18, 4, 0, 5, 'NORMAL', true);
    }
    expect(mgr.getPayload().zenBlessings).toBe(3);
    expect(mgr.getPayload().zenStarsEarned).toBe(5); // 16 unique clears -> floor(16/3) = 5

    // Spend all 3 Zen Blessings and verify 4th attempt returns false
    expect(mgr.consumeZenBlessing()).toBe(true);
    expect(mgr.consumeZenBlessing()).toBe(true);
    expect(mgr.consumeZenBlessing()).toBe(true);
    expect(mgr.consumeZenBlessing()).toBe(false);
    expect(mgr.getPayload().zenBlessings).toBe(0);
  });

  it('enforces Zen-only skips across Challenge, Speed Rush, and Zen without overwriting Challenge stars', () => {
    const mgr = new SaveManager();
    mgr.recordLevelWin(1, 3, 10, 4, 3, 4, 'NORMAL', false);

    // Challenge skip -> strict no-op
    const beforeChSeq = mgr.getPayload().writeSeq;
    mgr.recordLevelSkip(2);
    expect(mgr.getPayload().writeSeq).toBe(beforeChSeq);
    expect(mgr.getPayload().modeState.CHALLENGE.highestUnlocked).toBe(2);

    // Timed skip -> strict no-op
    mgr.updateSettings({ playMode: 'TIMED' });
    const beforeTmSeq = mgr.getPayload().writeSeq;
    mgr.recordLevelSkip(1);
    expect(mgr.getPayload().writeSeq).toBe(beforeTmSeq);
    expect(mgr.getPayload().modeState.TIMED.highestUnlocked).toBe(1);

    // Zen skip on Level 1 (which already has 3 Challenge stars!) marks zenSkipped without losing Challenge stars
    mgr.updateSettings({ playMode: 'ZEN' });
    mgr.recordLevelSkip(1);
    const afterZenSkip = mgr.getPayload();
    expect(afterZenSkip.modeState.ZEN).toEqual({ currentLevelId: 2, highestUnlocked: 2 });
    expect(afterZenSkip.levelRecords[1]?.challengeStars).toBe(3);
    expect(afterZenSkip.levelRecords[1]?.stars).toBe(3);
    expect(afterZenSkip.levelRecords[1]?.zenSkipped).toBe(true);
  });

  it('migrates Economy v2 TIMED, CHALLENGE, and ZEN saves + round-trips [0xa6, 0x4d] binary codes & qrCompact streams', () => {
    // 1. Existing Economy v2 TIMED player with 7 Zen clears & gap stages
    const v2TimedSave: SavePayloadV1 = {
      ...createDefaultSavePayload(),
      modeLadderVersion: 0,
      highestLevelUnlocked: 24,
      currentLevelId: 22,
      totalStars: 15,
      settings: {
        ...createDefaultSavePayload().settings,
        playMode: 'TIMED',
      },
      levelRecords: {
        1: { stars: 3, bestMoves: 3, bestTimeSec: 7.4 },
        2: { stars: 2, bestMoves: 5, bestTimeSec: 14.2 },
        3: { stars: 0, bestMoves: 0, bestTimeSec: 0, skipped: true },
        4: { stars: 0, bestMoves: 6, bestTimeSec: 25, zenCleared: true },
        5: { stars: 0, bestMoves: 7, bestTimeSec: 28, zenCleared: true },
        6: { stars: 0, bestMoves: 8, bestTimeSec: 30, zenCleared: true },
        7: { stars: 0, bestMoves: 9, bestTimeSec: 31, zenCleared: true },
      },
    };

    const migratedTimed = migrateLegacyEconomy(v2TimedSave);
    expect(migratedTimed.modeLadderVersion).toBe(1);
    expect(migratedTimed.modeState.TIMED).toEqual({ currentLevelId: 22, highestUnlocked: 24 });
    expect(migratedTimed.modeState.CHALLENGE).toEqual({ currentLevelId: 1, highestUnlocked: 1 });
    expect(migratedTimed.modeState.ZEN).toEqual({ currentLevelId: 8, highestUnlocked: 8 });
    expect(migratedTimed.levelRecords[1]?.timedStars).toBe(3);
    expect(migratedTimed.levelRecords[1]?.timedBestTimeSec).toBe(7.4);
    expect(migratedTimed.levelRecords[3]?.zenSkipped).toBe(true);
    expect(migratedTimed.zenStarsEarned).toBe(1); // 4 Zen clears -> 1 ★ + 1/3 progress
    expect(migratedTimed.zenStarProgress).toBe(1);
    expect(migratedTimed.zenBlessings).toBe(1); // 4 Zen clears -> 1 Blessing + 0/4 progress
    expect(migratedTimed.zenBlessingProgress).toBe(0);
    expect(migratedTimed.totalStars).toBe(16); // Monotonically non-decreasing: 15 + 1 Zen ★

    // 2. Existing Economy v2 ZEN player keeps full Zen frontier
    const v2ZenSave: SavePayloadV1 = {
      ...createDefaultSavePayload(),
      economyVersion: 2,
      modeLadderVersion: 0,
      highestLevelUnlocked: 35,
      currentLevelId: 35,
      settings: {
        ...createDefaultSavePayload().settings,
        playMode: 'ZEN',
      },
    };
    localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v2ZenSave));
    const zenMgr = new SaveManager();
    expect(zenMgr.getPayload().modeState.ZEN).toEqual({ currentLevelId: 35, highestUnlocked: 35 });
    expect(zenMgr.getPayload().modeState.CHALLENGE).toEqual({ currentLevelId: 1, highestUnlocked: 1 });

    // 3. Lossless round-trip through [0xa6, 0x4d] full & qrCompact SB1-... save codes
    const fullCode = encodeSaveCode(migratedTimed);
    const decodedFull = decodeSaveCode(fullCode);
    expect(decodedFull).toEqual(migratedTimed);

    const qrCode = encodeSaveCode(migratedTimed, { qrCompact: true });
    const decodedQr = decodeSaveCode(qrCode);
    expect(decodedQr.modeState).toEqual(migratedTimed.modeState);
    expect(decodedQr.zenStarsEarned).toBe(1);
    expect(decodedQr.zenBlessings).toBe(1);
    expect(decodedQr.levelRecords[1]?.timedStars).toBe(3);
    expect(decodedQr.levelRecords[3]?.zenSkipped).toBe(true);
  });

  it('preserves rescued +5 Moves and defused bomb fuses across Undo after a Zen Blessing or Paid Continue', () => {
    const chLive = createBoardState(getLevelSpec(1));
    chLive.moveLimit = 10;
    chLive.movesRemaining = 1;
    chLive.blocks[0].bombMax = 6;
    chLive.blocks[0].bombCount = 1;
    const preFinalSnapshot = cloneBoardState(chLive);

    // Final move fails & player spends a Zen Blessing / Continue (+5 Moves + bomb defused to 6)
    chLive.movesRemaining = 5;
    chLive.moveLimit = 15;
    chLive.continuesUsed = 1;
    chLive.blocks[0].bombCount = 6;

    carryLiveResourcesIntoUndo(preFinalSnapshot, chLive, 'CHALLENGE');
    expect(preFinalSnapshot.continuesUsed).toBe(1);
    expect(preFinalSnapshot.moveLimit).toBe(15);
    expect(preFinalSnapshot.movesRemaining).toBe(6);
    expect(preFinalSnapshot.blocks[0].bombCount).toBe(6);

    // Timed Mode Continue defusal also survives Undo instead of clamping back down to pre-explosion 0/1
    const tmLive = createBoardState(getLevelSpec(1));
    tmLive.blocks[0].bombMax = 5;
    tmLive.blocks[0].bombCount = 1;
    const preExplosionTimed = cloneBoardState(tmLive);
    tmLive.continuesUsed = 1;
    tmLive.timeRemainingSec = 20;
    tmLive.blocks[0].bombCount = 5;

    carryLiveResourcesIntoUndo(preExplosionTimed, tmLive, 'TIMED');
    expect(preExplosionTimed.continuesUsed).toBe(1);
    expect(preExplosionTimed.timeRemainingSec).toBe(20);
    expect(preExplosionTimed.blocks[0].bombCount).toBe(5);
  });

  it('ZEN-SKIP-GUARD-01, STREAK-INTEGRITY-01 & MODE-ISOLATION-01: caps consecutive Zen skips at 3, gates chests & power-ups on genuine clears, blocks replay streak farming, and keeps TIMED clock running across Undo-to-Move-0', () => {
    const mgr = new SaveManager();
    mgr.updateSettings({ playMode: 'ZEN' });

    // 1. Consecutive Zen Free Skips cap strictly at ZEN_MAX_CONSECUTIVE_SKIPS (3)
    expect(ZEN_MAX_CONSECUTIVE_SKIPS).toBe(3);
    expect(canSkipZenLevel(mgr.getPayload(), 1)).toBe(true);
    mgr.recordLevelSkip(1);
    mgr.recordLevelSkip(2);
    mgr.recordLevelSkip(3);
    expect(mgr.getPayload().modeState.ZEN).toEqual({ currentLevelId: 4, highestUnlocked: 4 });
    // 4th consecutive un-cleared skip is rejected (strict no-op)
    expect(canSkipZenLevel(mgr.getPayload(), 4)).toBe(false);
    const seqBeforeBlockedSkip = mgr.getPayload().writeSeq;
    mgr.recordLevelSkip(4);
    expect(mgr.getPayload().writeSeq).toBe(seqBeforeBlockedSkip);
    expect(mgr.getPayload().modeState.ZEN).toEqual({ currentLevelId: 4, highestUnlocked: 4 });

    // 2. Zero genuine clears -> effective booster unlock level stays 1 (Hint L2 & Hammer L8 NOT unlocked by skips!)
    expect(countUniqueClearedLevels(mgr.getPayload())).toBe(0);
    expect(getEffectiveBoosterUnlockLevel(mgr.getPayload(), 4)).toBe(1);

    // Beating Level 10 alone after skips (only 1 unique clear!) does NOT open the Level-10 Milestone Chest
    const prematureTen = mgr.recordLevelWin(10, 6, 20, 4, 0, 5, 'SUPER_HARD', true);
    expect(prematureTen.milestoneChestOpened).toBe(false);
    expect(mgr.getPayload().milestoneChestLevel).toBe(0);

    // Clearing stage 4 resets consecutive skip debt on `mgr` so Zen skips work again on stage 5!
    mgr.recordLevelWin(4, 5, 15, 4, 0, 5, 'NORMAL', true);
    expect(canSkipZenLevel(mgr.getPayload(), 5)).toBe(true);

    // Skipping stage 10 and achieving the 10th genuine clear on stage 11 STILL awards the Level-10 Milestone Chest (HAMMER debut)!
    localStorage.clear();
    const honestMgr = new SaveManager();
    honestMgr.updateSettings({ playMode: 'ZEN' });
    for (let lvl = 1; lvl <= 9; lvl++) {
      honestMgr.recordLevelWin(lvl, 5, 15, 4, 0, 5, 'NORMAL', true);
    }
    expect(getEffectiveBoosterUnlockLevel(honestMgr.getPayload(), 10)).toBe(10); // 9 clears + 1 = 10 -> Hammer unlocked!
    honestMgr.recordLevelSkip(10); // Honest player skips Boss L10
    const tenthUniqueOnEleven = honestMgr.recordLevelWin(11, 6, 18, 4, 0, 5, 'NORMAL', true);
    expect(tenthUniqueOnEleven.milestoneChestOpened).toBe(true);
    expect(tenthUniqueOnEleven.rewardedBoosters).toContain('HAMMER');
    expect(honestMgr.getPayload().milestoneChestLevel).toBe(10);

    // 3. STREAK-INTEGRITY-01: Replaying Level 1 in Challenge / Timed NEVER farms winStreak
    localStorage.clear();
    const streakMgr = new SaveManager();
    streakMgr.recordLevelWin(1, 3, 10, 4, 2, 4, 'NORMAL', false);
    expect(streakMgr.getPayload().winStreak).toBe(1);
    streakMgr.recordLevelWin(1, 2, 8, 4, 3, 4, 'NORMAL', false); // Replay L1 improving 2★ -> 3★
    expect(streakMgr.getPayload().winStreak).toBe(1);
    streakMgr.recordLevelWin(1, 2, 8, 4, 3, 4, 'NORMAL', false); // Replay L1 again
    expect(streakMgr.getPayload().winStreak).toBe(1);
    streakMgr.recordLevelWin(2, 4, 12, 4, 3, 4, 'NORMAL', false); // Genuine first clear on L2
    expect(streakMgr.getPayload().winStreak).toBe(2);

    // 4. TIMED Undo-to-Move-0 keeps timerRunning = true; isBoardRunStarted detects Move-0 booster/Hint mutations
    const move0Snap = createBoardState(getLevelSpec(1));
    expect(isBoardRunStarted(move0Snap)).toBe(false);
    const liveTimed = cloneBoardState(move0Snap);
    liveTimed.timerRunning = true;
    liveTimed.timeRemainingSec = 42;
    expect(isBoardRunStarted(liveTimed)).toBe(true);
    carryLiveResourcesIntoUndo(move0Snap, liveTimed, 'TIMED');
    expect(move0Snap.timerRunning).toBe(true);
    expect(move0Snap.timeRemainingSec).toBe(42);

    const hintMutated = createBoardState(getLevelSpec(1));
    hintMutated.freeMovesRemaining = 2;
    expect(isBoardRunStarted(hintMutated)).toBe(true);
    const boosterMutated = createBoardState(getLevelSpec(1));
    boosterMutated.sessionBlocksShredded = 1;
    expect(isBoardRunStarted(boosterMutated)).toBe(true);
  });

  it('UNDER-PAR-ORACLE-01: rewards booster-free Under-Par clears (Level 312 in 15/16 moves) once per stage, blocks Hint+Undo or booster washing, and round-trips [0xa7, 0x55] SB1 save codes', () => {
    const spec312 = getLevelSpec(312);
    const board = createBoardState(spec312);
    expect(board.parMoves).toBe(16);

    const underParLine: ReadonlyArray<readonly [number, number, number]> = [
      [10, 7, 6],
      [12, 7, 4],
      [3, 6, 6],
      [9, 7, 1],
      [4, 8, 0],
      [5, 7, 1],
      [10, 7, 0],
      [7, 5, 7],
      [11, 5, 7],
      [6, 4, 0],
      [2, 4, 0],
      [1, 0, 3],
      [8, 0, 4],
      [10, 5, 0],
      [12, 0, 4],
    ];
    for (const [blockId, r, c] of underParLine) {
      const out = commitBlockMove(board, blockId, r, c, 'CHALLENGE');
      expect(out.moved).toBe(true);
    }
    expect(isBoardWon(board)).toBe(true);
    expect(board.movesCommitted).toBe(15);
    expect(board.powerUpsUsed).toBe(0);

    const mgr = new SaveManager();
    mgr.setCurrentLevel(312, true);
    const stars = computeEarnedStars(board, 'CHALLENGE', false);
    expect(stars).toBe(3);

    // 1. First pure Under-Par clear awards +50 Coins + 1 UNCOMMON+ Power-Up and stamps underParCleared
    const win1 = mgr.recordLevelWin(
      312,
      board.movesCommitted,
      45,
      board.sessionBlocksShredded,
      stars,
      board.parMoves,
      board.difficulty,
      false,
      (board.powerUpsUsed ?? 0) === 0 && (board.continuesUsed ?? 0) === 0
    );
    expect(win1.underPar).toBe(true);
    expect(win1.firstUnderPar).toBe(true);
    expect(win1.underParMovesSaved).toBe(1);
    expect(win1.underParCoins).toBe(UNDER_PAR_ORACLE_COINS);
    expect(win1.underParBooster).not.toBeNull();
    expect(win1.underParBooster).not.toBe('UNDO'); // Milestone-grade drop guarantees UNCOMMON+
    expect(mgr.getPayload().levelRecords[312]?.underParCleared).toBe(true);

    // 2. Replaying Level 312 Under Par keeps the Easter Egg celebration (`underPar: true`) with 0 repeat bounty farming
    const coinsBeforeEncore = mgr.getPayload().coins;
    const boostersBeforeEncore = { ...mgr.getPayload().boosters };
    const win2 = mgr.recordLevelWin(312, 15, 42, 4, 3, 16, board.difficulty, false, true);
    expect(win2.underPar).toBe(true);
    expect(win2.firstUnderPar).toBe(false);
    expect(win2.underParCoins).toBe(0);
    expect(win2.underParBooster).toBeNull();
    expect(mgr.getPayload().coins - coinsBeforeEncore).toBe(win2.baseCoins);
    expect(mgr.getPayload().boosters).toEqual(boostersBeforeEncore);

    // 3. Hint + Undo and destructive boosters increment `powerUpsUsed` and survive `carryLiveResourcesIntoUndo`
    const bHint = createBoardState(getLevelSpec(2));
    const snapBeforeHint = cloneBoardState(bHint);
    applyBoosterHint(bHint, 'CHALLENGE', {
      blockId: bHint.blocks[0].id,
      targetRow: 0,
      targetCol: 0,
      exitsGateIndex: 0,
    });
    expect(bHint.powerUpsUsed).toBe(1);
    carryLiveResourcesIntoUndo(snapBeforeHint, bHint, 'CHALLENGE');
    expect(snapBeforeHint.powerUpsUsed).toBe(1);

    const bHammer = createBoardState(getLevelSpec(1));
    expect(
      applyBoosterHammer(bHammer, bHammer.blocks[0].row, bHammer.blocks[0].col, bHammer.blocks[0].id)
    ).toBe(true);
    expect(bHammer.powerUpsUsed).toBe(1);

    // Disqualified runs (power-up used or Zen mode) never trigger `underPar`
    const assistedWin = mgr.recordLevelWin(10, 4, 20, 4, 3, 6, 'NORMAL', false, false);
    expect(assistedWin.underPar).toBe(false);
    expect(assistedWin.underParCoins).toBe(0);
    expect(mgr.getPayload().levelRecords[10]?.underParCleared).toBeUndefined();

    const zenWin = mgr.recordLevelWin(11, 4, 20, 4, 0, 6, 'NORMAL', true, true);
    expect(zenWin.underPar).toBe(false);
    expect(mgr.getPayload().levelRecords[11]?.underParCleared).toBeUndefined();

    // 4. Binary `SB1-...` save code round-trips `underParCleared: true` via `[0xa7, 0x55]` trailer
    const code = encodeSaveCode(mgr.getPayload());
    const decoded = decodeSaveCode(code);
    expect(decoded.levelRecords[312]?.underParCleared).toBe(true);
    expect(decoded.levelRecords[10]?.underParCleared).toBeUndefined();
  });
});
