import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carryLiveResourcesIntoUndo, cloneBoardState, createBoardState } from '../../src/core/board-state';
import type { SavePayloadV1 } from '../../src/core/types';
import { getLevelSpec } from '../../src/levels/catalog';
import { decodeSaveCode, encodeSaveCode } from '../../src/storage/save-code';
import {
  createDefaultSavePayload,
  migrateLegacyEconomy,
  SAVE_STORAGE_KEY,
  SaveManager,
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
});
