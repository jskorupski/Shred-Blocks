import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundEngine } from '../../src/audio/synth';
import { playRelicAwakenVoice } from '../../src/audio/synth-voices';
import { createBoardState } from '../../src/core/board';
import {
  COLOR_PALETTE,
  type ColorId,
  type LevelSpec,
  type ParticleStyleId,
  type QualityTier,
  type SavePayloadV1,
  type SkinId,
  type TrayId,
} from '../../src/core/types';
import {
  BoardInputController,
  MONO_PRIORITY_WEIGHT,
  pickBlockAtBoardPoint,
} from '../../src/input/pointer-controller';
import { Renderer3D } from '../../src/render/renderer-3d';
import { buildQrMatrix, generateQrSvg, getAlignmentPositions } from '../../src/storage/qr-svg';
import {
  CODEC_HEADER_LZ77_V1,
  CODEC_HEADER_RAW_UTF8,
  compressLz77,
  computeCrc32Hex,
  decodeSaveCode,
  decompressFramedBytes,
  encodeSaveCode,
  SaveCodeError,
} from '../../src/storage/save-code';
import {
  BOOSTER_COIN_COSTS,
  BOOSTER_RARITY,
  BOOSTER_UNLOCK_LEVEL,
  createDefaultSavePayload,
  extractImportCodeFromHash,
  isBoosterUnlocked,
  PRE_IMPORT_BACKUP_KEY,
  pickRarityWeightedBooster,
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

describe('Storage, Save Codes, QR SVG, Input & Audio Integration', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  describe('STOR-01: Save Code Codec (encodeSaveCode / decodeSaveCode / LZ77 / CRC32)', () => {
    it('round-trips a default SavePayloadV1 with 0x01 LZ77 codec header and CRC32 suffix', () => {
      const original = createDefaultSavePayload();
      const code = encodeSaveCode(original);

      expect(code.startsWith('SB1-')).toBe(true);
      const parts = code.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(3);
      const crcSuffix = parts[parts.length - 1];
      expect(crcSuffix).toMatch(/^[0-9a-f]{8}$/);

      // Verify first decoded byte of base64url payload is CODEC_HEADER_LZ77_V1 (0x01)
      const b64Body = code.slice(4, code.lastIndexOf('-'));
      const padded = b64Body.replace(/-/g, '+').replace(/_/g, '/');
      const firstByte = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)).charCodeAt(0);
      expect(firstByte).toBe(CODEC_HEADER_LZ77_V1);

      const decoded = decodeSaveCode(code);
      expect(decoded).toEqual(original);
    });

    it('round-trips a full 200-level populated SavePayloadV1 and tolerates embedded whitespace', () => {
      const fullSave: SavePayloadV1 = createDefaultSavePayload();
      fullSave.writeSeq = 420;
      fullSave.highestLevelUnlocked = 201;
      fullSave.currentLevelId = 201;
      fullSave.coins = 18450;
      fullSave.totalStars = 585;
      fullSave.winStreak = 24;
      fullSave.bestWinStreak = 38;
      fullSave.totalBlocksShredded = 2450;
      fullSave.totalMovesCommitted = 1980;
      fullSave.shredderChestProgress = 50;
      fullSave.milestoneChestLevel = 200;
      fullSave.unlockedSkins = ['classic_studs', 'relic_stone', 'gummy_jelly', 'neon_cyber'];
      fullSave.equippedSkin = 'neon_cyber';

      for (let lvl = 1; lvl <= 200; lvl++) {
        fullSave.levelRecords[lvl] = {
          stars: ((lvl % 3) + 1) as 1 | 2 | 3,
          bestMoves: 6 + (lvl % 12),
          bestTimeSec: 18 + (lvl % 40),
          skipped: false,
        };
      }

      const sb1Code = encodeSaveCode(fullSave);
      expect(sb1Code.length).toBeLessThanOrEqual(210);
      const decodedDirect = decodeSaveCode(sb1Code);
      expect(decodedDirect).toEqual(fullSave);
      expect(Object.keys(decodedDirect.levelRecords).length).toBe(200);

      // Verify embedded newlines/whitespace are stripped cleanly when pasted
      const codeWithWhitespace = `  \n ${sb1Code.slice(0, 40)}\n  ${sb1Code.slice(40)} \t `;
      expect(decodeSaveCode(codeWithWhitespace)).toEqual(fullSave);
    });

    it('supports raw UTF-8 codec header (0x00) in decompressFramedBytes', () => {
      const rawText = '{"hello":"world"}';
      const rawBytes = new TextEncoder().encode(rawText);
      const framed = new Uint8Array(1 + rawBytes.length);
      framed[0] = CODEC_HEADER_RAW_UTF8;
      framed.set(rawBytes, 1);

      const out = decompressFramedBytes(framed);
      expect(new TextDecoder().decode(out)).toBe(rawText);

      const lzFramed = compressLz77(rawBytes);
      expect(lzFramed[0]).toBe(CODEC_HEADER_LZ77_V1);
      expect(new TextDecoder().decode(decompressFramedBytes(lzFramed))).toBe(rawText);
    });

    it('rejects tampered payloads with CHECKSUM_MISMATCH and malformed codes with descriptive errors', () => {
      const save = createDefaultSavePayload();
      const validCode = encodeSaveCode(save);

      // Flip a character in the payload body while keeping the old CRC32
      const midIndex = Math.floor(validCode.length / 2);
      const origChar = validCode[midIndex];
      const replacementChar = origChar === 'A' ? 'B' : 'A';
      const tamperedCode = validCode.slice(0, midIndex) + replacementChar + validCode.slice(midIndex + 1);

      expect(() => decodeSaveCode(tamperedCode)).toThrowError(SaveCodeError);
      try {
        decodeSaveCode(tamperedCode);
      } catch (err) {
        expect(err).toBeInstanceOf(SaveCodeError);
        expect((err as SaveCodeError).code).toBe('CHECKSUM_MISMATCH');
      }

      expect(() => decodeSaveCode('   ')).toThrowError(/empty/i);
      expect(() => decodeSaveCode('XYZ-1234-deadbeef')).toThrowError(/SB1-/i);

      // Valid prefix + recomputed CRC over unsupported binary payload magic byte
      const badBytes = compressLz77(new Uint8Array([0x99, 0x01, 0x02]));
      let bin = '';
      for (const b of badBytes) bin += String.fromCharCode(b);
      const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const crc = computeCrc32Hex(b64);
      expect(() => decodeSaveCode(`SB1-${b64}-${crc}`)).toThrowError(
        /Unsupported or corrupted binary save payload/i
      );
    });
  });

  describe('UX-07: Self-Contained QR SVG Generator & ISO/IEC 18004 Table E.1', () => {
    it('returns exact ISO/IEC 18004 Annex E Table E.1 alignment pattern coordinates for Versions 1..40', () => {
      expect(getAlignmentPositions(1)).toEqual([]);
      expect(getAlignmentPositions(2)).toEqual([6, 18]);
      expect(getAlignmentPositions(7)).toEqual([6, 22, 38]);
      expect(getAlignmentPositions(14)).toEqual([6, 26, 46, 66]);
      expect(getAlignmentPositions(15)).toEqual([6, 26, 48, 70]);
      expect(getAlignmentPositions(21)).toEqual([6, 28, 50, 72, 94]);
      expect(getAlignmentPositions(28)).toEqual([6, 26, 50, 74, 98, 122]);
      expect(getAlignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
      expect(getAlignmentPositions(36)).toEqual([6, 24, 50, 76, 102, 128, 154]);
      expect(getAlignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    });

    it('generates valid QR matrices and crisp SVG strings across short strings, SB1 codes, and magic URLs', () => {
      const m1 = buildQrMatrix('HELLO');
      expect(m1.size).toBe(21); // Version 1: 17 + 1*4 = 21
      expect(m1.modules.length).toBe(21 * 21);

      const save = createDefaultSavePayload();
      const sb1 = encodeSaveCode(save);
      const magicUrl = `https://shredblocks.skorupski.org/#import=${encodeURIComponent(sb1)}`;

      const svg = generateQrSvg(magicUrl);
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.includes('shape-rendering="crispEdges"')).toBe(true);
      expect(svg.includes('<path d="M')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);

      // Verify full 300-level campaign and 1,000-level Endless saves always fit inside QR capacity and round-trip cleanly
      const massiveSave = createDefaultSavePayload();
      massiveSave.highestLevelUnlocked = 1001;
      massiveSave.currentLevelId = 1001;
      for (let lvl = 1; lvl <= 1000; lvl++) {
        massiveSave.levelRecords[lvl] = {
          stars: ((lvl * 7) % 3) + 1,
          bestMoves: 6 + ((lvl * 13) % 28),
          bestTimeSec: 15 + ((lvl * 19) % 75),
          skipped: lvl % 17 === 0,
        };
      }
      const qrCode1000 = encodeSaveCode(massiveSave, { qrCompact: true });
      const qrUrl1000 = `https://shredblocks.skorupski.org/#import=${encodeURIComponent(qrCode1000)}`;
      expect(qrUrl1000.length).toBeLessThan(1600);
      const svg1000 = generateQrSvg(qrUrl1000);
      expect(svg1000.startsWith('<svg ')).toBe(true);
      const decoded1000 = decodeSaveCode(qrCode1000);
      expect(Object.keys(decoded1000.levelRecords).length).toBe(1000);
      expect(decoded1000.levelRecords[1].stars).toBe(massiveSave.levelRecords[1].stars);
      expect(decoded1000.levelRecords[300].stars).toBe(massiveSave.levelRecords[300].stars);
      expect(decoded1000.levelRecords[1000]).toEqual(massiveSave.levelRecords[1000]);

      // ENDLESS-SAVE-01: Verify 5,000-level Infinite Mode progression + >32-bit varints (> 2^31)
      // round-trip losslessly in full SB1-... codes and fit inside QR capacity in qrCompact mode
      const endless5000 = createDefaultSavePayload();
      endless5000.highestLevelUnlocked = 5001;
      endless5000.currentLevelId = 5001;
      endless5000.coins = 3_500_000_000; // Exceeds 32-bit signed/unsigned shift limits
      endless5000.totalMovesCommitted = 5_250_000_000;
      endless5000.totalStars = 0;
      for (let lvl = 1; lvl <= 5000; lvl++) {
        const stars = ((lvl * 11) % 3) + 1;
        endless5000.totalStars += stars;
        endless5000.levelRecords[lvl] = {
          stars,
          bestMoves: 5 + ((lvl * 17) % 32),
          bestTimeSec: 12 + ((lvl * 23) % 90),
          skipped: lvl % 29 === 0,
        };
      }

      const t0 = performance.now();
      const fullCode5000 = encodeSaveCode(endless5000);
      const encodeElapsedMs = performance.now() - t0;
      expect(encodeElapsedMs).toBeLessThan(200);

      const fullDecoded5000 = decodeSaveCode(fullCode5000);
      expect(Object.keys(fullDecoded5000.levelRecords).length).toBe(5000);
      expect(fullDecoded5000.highestLevelUnlocked).toBe(5001);
      expect(fullDecoded5000.currentLevelId).toBe(5001);
      expect(fullDecoded5000.coins).toBe(3_500_000_000);
      expect(fullDecoded5000.totalMovesCommitted).toBe(5_250_000_000);
      expect(fullDecoded5000.levelRecords[1]).toEqual(endless5000.levelRecords[1]);
      expect(fullDecoded5000.levelRecords[2500]).toEqual(endless5000.levelRecords[2500]);
      expect(fullDecoded5000.levelRecords[5000]).toEqual(endless5000.levelRecords[5000]);

      const qrCode5000 = encodeSaveCode(endless5000, { qrCompact: true });
      const qrUrl5000 = `https://shredblocks.skorupski.org/#import=${encodeURIComponent(qrCode5000)}`;
      expect(qrUrl5000.length).toBeLessThanOrEqual(2900);
      const svg5000 = generateQrSvg(qrUrl5000);
      expect(svg5000.startsWith('<svg ')).toBe(true);
      const qrDecoded5000 = decodeSaveCode(qrCode5000);
      expect(qrDecoded5000.highestLevelUnlocked).toBe(5001);
      expect(qrDecoded5000.currentLevelId).toBe(5001);
      expect(qrDecoded5000.coins).toBe(3_500_000_000);
      expect(qrDecoded5000.totalStars).toBe(endless5000.totalStars);
      // Preserves all 300 Campaign records + latest 1,200 Endless records (3801..5000)
      expect(Object.keys(qrDecoded5000.levelRecords).length).toBe(1500);
      expect(qrDecoded5000.levelRecords[300].stars).toBe(endless5000.levelRecords[300].stars);
      expect(qrDecoded5000.levelRecords[300].skipped).toBe(endless5000.levelRecords[300].skipped);
      expect(qrDecoded5000.levelRecords[5000]).toEqual(endless5000.levelRecords[5000]);
    });
  });

  describe('STOR-02 & F-10: SaveManager Reconciliation, Replay Economy, Chests, Skip & Backups', () => {
    it('reconciles localStorage and IndexedDB by choosing whichever payload has the higher writeSeq', async () => {
      const older = createDefaultSavePayload();
      older.writeSeq = 3;
      older.coins = 300;
      older.currentLevelId = 2;

      const newer = createDefaultSavePayload();
      newer.writeSeq = 9;
      newer.coins = 950;
      newer.highestLevelUnlocked = 12;
      newer.currentLevelId = 12;

      localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(older));

      const manager = new SaveManager();
      // Mock readIndexedDB to return newer payload with writeSeq = 9
      vi.spyOn(
        manager as unknown as { readIndexedDB: () => Promise<SavePayloadV1 | null> },
        'readIndexedDB'
      ).mockResolvedValue(newer);

      const reconciled = await manager.init();
      expect(reconciled.writeSeq).toBe(9);
      expect(reconciled.coins).toBe(950);
      expect(reconciled.currentLevelId).toBe(12);

      // Verify localStorage was healed with the newer IndexedDB payload
      const healedLocal = JSON.parse(localStorage.getItem(SAVE_STORAGE_KEY) ?? '{}') as SavePayloadV1;
      expect(healedLocal.writeSeq).toBe(9);
      expect(healedLocal.coins).toBe(950);
    });

    it('awards full first-clear coins vs. 20% replay base coins + star improvement difference (F-10)', () => {
      const manager = new SaveManager();
      const initialCoins = manager.getPayload().coins;

      // First clear of Level 1 (NORMAL) with 2 stars: +15 base + 10 star coins + 0 streak = +25 coins
      const firstWin = manager.recordLevelWin(1, 12, 25, 10, 2, 8);
      expect(firstWin.isFirstClear).toBe(true);
      expect(firstWin.baseCoins).toBe(15);
      expect(firstWin.starCoins).toBe(10);
      expect(firstWin.starsImproved).toBe(2);
      expect(firstWin.totalCoinsEarned).toBe(25);
      expect(manager.getPayload().coins).toBe(initialCoins + 25);
      expect(manager.getPayload().totalStars).toBe(2);

      // Replay of Level 1 with 2 stars (no star improvement): +3 replay base (20% of 15) + 0 star coins
      const replaySame = manager.recordLevelWin(1, 12, 24, 10, 2, 8);
      expect(replaySame.isFirstClear).toBe(false);
      expect(replaySame.baseCoins).toBe(3);
      expect(replaySame.starCoins).toBe(0);
      expect(replaySame.streakCoins).toBe(0);
      expect(replaySame.totalCoinsEarned).toBe(3);

      // Replay of Level 1 improving from 2 stars to 3 stars: +3 replay base + 5 for +1 new star = +8
      const replayImprove = manager.recordLevelWin(1, 6, 18, 10, 3, 8);
      expect(replayImprove.isFirstClear).toBe(false);
      expect(replayImprove.baseCoins).toBe(3);
      expect(replayImprove.starsImproved).toBe(1);
      expect(replayImprove.starCoins).toBe(5);
      expect(replayImprove.totalCoinsEarned).toBe(8);
      expect(manager.getPayload().totalStars).toBe(3);
    });

    it('unlocks Shredder Chest at 100 shredded blocks and Milestone Chest every 10 levels', () => {
      const manager = new SaveManager();

      // Clear Level 10 for the first time while shredding 105 blocks
      const summary = manager.recordLevelWin(10, 8, 20, 105, 3, 8);
      expect(summary.shredderChestsOpened).toBe(1);
      expect(summary.milestoneChestOpened).toBe(true);
      expect(summary.chestCoins).toBe(125); // 50 (Shredder) + 75 (Milestone)
      expect(summary.rewardedBoosters.length).toBe(2);
      expect(manager.getPayload().shredderChestProgress).toBe(5);
      expect(manager.getPayload().milestoneChestLevel).toBe(10);
    });

    it('supports free recordLevelSkip, pre-import backup slot, 1-tap restorePreImportBackup, JSON import/export, and extractImportCodeFromHash', () => {
      const manager = new SaveManager();
      manager.recordLevelSkip(1);
      const afterSkip = manager.getPayload();
      expect(afterSkip.highestLevelUnlocked).toBe(2);
      expect(afterSkip.currentLevelId).toBe(2);
      expect(afterSkip.levelRecords[1]?.skipped).toBe(true);
      expect(afterSkip.levelRecords[1]?.stars).toBe(0);

      // Export JSON and modify a copy to import
      const exportedJson = manager.exportSaveJson();
      const incoming = JSON.parse(exportedJson) as SavePayloadV1;
      incoming.coins = 7777;
      incoming.highestLevelUnlocked = 45;
      incoming.currentLevelId = 45;

      const incomingCode = encodeSaveCode(incoming);
      const shareHash = `#import=${encodeURIComponent(incomingCode)}`;
      expect(extractImportCodeFromHash(shareHash)).toBe(incomingCode);

      expect(manager.hasPreImportBackup()).toBe(false);
      const afterImport = manager.importSaveCode(incomingCode);
      expect(afterImport.coins).toBe(7777);
      expect(afterImport.highestLevelUnlocked).toBe(45);
      expect(manager.hasPreImportBackup()).toBe(true);
      expect(localStorage.getItem(PRE_IMPORT_BACKUP_KEY)).not.toBeNull();

      // 1-tap restorePreImportBackup restores the pre-import state with incremented writeSeq
      const restored = manager.restorePreImportBackup();
      expect(restored).not.toBeNull();
      expect(restored?.coins).toBe(afterSkip.coins);
      expect(restored?.highestLevelUnlocked).toBe(2);
      expect(restored?.writeSeq).toBeGreaterThan(afterImport.writeSeq);

      // Also verify importSaveJson
      const afterJsonImport = manager.importSaveJson(JSON.stringify(incoming));
      expect(afterJsonImport.coins).toBe(7777);
    });

    it('enforces progressive power-up unlocking, 5 rarity tiers, and rarity-weighted chest drops (ECON-01..04)', () => {
      expect(BOOSTER_UNLOCK_LEVEL).toEqual({
        UNDO: 1,
        FREEZE: 2,
        HAMMER: 8,
        ROCKET: 18,
        VACUUM: 30,
      });
      expect(BOOSTER_RARITY).toEqual({
        UNDO: 'COMMON',
        FREEZE: 'UNCOMMON',
        HAMMER: 'RARE',
        ROCKET: 'EPIC',
        VACUUM: 'LEGENDARY',
      });
      expect(BOOSTER_COIN_COSTS.UNDO).toBeLessThan(BOOSTER_COIN_COSTS.FREEZE);
      expect(BOOSTER_COIN_COSTS.FREEZE).toBeLessThan(BOOSTER_COIN_COSTS.HAMMER);
      expect(BOOSTER_COIN_COSTS.HAMMER).toBeLessThan(BOOSTER_COIN_COSTS.ROCKET);
      expect(BOOSTER_COIN_COSTS.ROCKET).toBeLessThan(BOOSTER_COIN_COSTS.VACUUM);

      // Level 1: only UNDO is unlocked
      expect(isBoosterUnlocked('UNDO', 1)).toBe(true);
      expect(isBoosterUnlocked('FREEZE', 1)).toBe(false);
      expect(isBoosterUnlocked('HAMMER', 1)).toBe(false);
      expect(isBoosterUnlocked('ROCKET', 1)).toBe(false);
      expect(isBoosterUnlocked('VACUUM', 1)).toBe(false);

      // Level 5: only UNDO and FREEZE are unlocked; chest drops never award locked boosters
      for (let seed = 1; seed <= 100; seed++) {
        const drop = pickRarityWeightedBooster(seed, 5, false);
        expect(['UNDO', 'FREEZE']).toContain(drop);
      }

      // Level 12: UNDO, FREEZE, HAMMER unlocked; ROCKET and VACUUM never drop
      for (let seed = 1; seed <= 100; seed++) {
        const drop = pickRarityWeightedBooster(seed, 12, false);
        expect(['UNDO', 'FREEZE', 'HAMMER']).toContain(drop);
      }

      // Milestone debuts: Level 10 milestone awards HAMMER, Level 20 awards ROCKET, Level 30 awards VACUUM
      expect(pickRarityWeightedBooster(42, 10, true)).toBe('HAMMER');
      expect(pickRarityWeightedBooster(42, 20, true)).toBe('ROCKET');
      expect(pickRarityWeightedBooster(42, 30, true)).toBe('VACUUM');

      // Level 50+: all 5 boosters unlocked, and COMMON/UNCOMMON drops outnumber EPIC/LEGENDARY
      const counts = { UNDO: 0, FREEZE: 0, HAMMER: 0, ROCKET: 0, VACUUM: 0 };
      for (let seed = 0; seed < 1000; seed++) {
        const b = pickRarityWeightedBooster(seed, 50, false);
        counts[b]++;
      }
      expect(counts.UNDO).toBeGreaterThan(counts.HAMMER);
      expect(counts.FREEZE).toBeGreaterThan(counts.ROCKET);
      expect(counts.HAMMER).toBeGreaterThan(counts.VACUUM);
      expect(counts.VACUUM).toBeGreaterThan(0);
    });
  });

  describe('UX-02: Voronoi 1.30x Priority Hit-Slop for 1x1 Monominoes in Concave U/L Pockets', () => {
    it('prioritizes a movable 1x1 monomino tucked inside an L-block pocket when tapping in the shared halo', () => {
      const spec: LevelSpec = {
        id: 99,
        name: 'Pocket Pick Test',
        difficulty: 'NORMAL',
        rows: 5,
        cols: 5,
        parMoves: 4,
        blocks: [
          // L3_TL occupies (1,1), (1,2), (2,1) -> leaving (2,2) as its inner concave pocket
          { id: 1, shapeId: 'L3_TL', row: 1, col: 1, colorStack: [1] },
          // 1x1 monomino tucked right inside the pocket at (2,2)
          { id: 2, shapeId: '1x1', row: 2, col: 2, colorStack: [2] },
        ],
        gates: [{ edge: 'TOP', spanStart: 1, spanLength: 2, colorQueue: [1, 2] }],
      };

      const board = createBoardState(spec);
      expect(MONO_PRIORITY_WEIGHT).toBeCloseTo(1.3, 2);

      // Point (2.05, 1.96) is slightly inside cell (1,2) belonging to L3_TL (0.04 units from the seam y=2.0),
      // so Euclidean center distance to L3_TL cell (1,2) center (2.5, 1.5) is ~0.643,
      // while center distance to 1x1 monomino at (2,2) center (2.5, 2.5) is ~0.703.
      // With 1.30x Voronoi priority weight (0.703 / 1.30 = 0.541 < 0.643), the 1x1 monomino wins!
      const picked = pickBlockAtBoardPoint(board, 2.05, 1.96);
      expect(picked).not.toBeNull();
      expect(picked?.id).toBe(2);
      expect(picked?.shapeId).toBe('1x1');
    });

    it('targets non-convex blocks with Hammer via BoardInputController', () => {
      const spec: LevelSpec = {
        id: 100,
        name: 'Non-Convex Hammer Test',
        difficulty: 'HARD',
        rows: 5,
        cols: 5,
        parMoves: 4,
        blocks: [
          // L3_BR has cells [0,1], [1,0], [1,1] — its top-left (row, col) = (1,1) is an EMPTY pocket!
          { id: 7, shapeId: 'L3_BR', row: 1, col: 1, colorStack: [3] },
        ],
        gates: [{ edge: 'BOTTOM', spanStart: 1, spanLength: 2, colorQueue: [3] }],
      };
      const board = createBoardState(spec);

      const listeners = new Map<string, Array<(e: unknown) => void>>();
      const fakeCanvas = {
        addEventListener(type: string, fn: (e: unknown) => void) {
          const arr = listeners.get(type) ?? [];
          arr.push(fn);
          listeners.set(type, arr);
        },
        removeEventListener(type: string, fn: (e: unknown) => void) {
          const arr = listeners.get(type) ?? [];
          listeners.set(
            type,
            arr.filter((item) => item !== fn)
          );
        },
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 500,
          height: 500,
        }),
      } as unknown as HTMLElement;

      const controller = new BoardInputController(fakeCanvas, {
        getBoard: () => board,
        getPlayMode: () => 'ZEN',
        screenToBoard: (x, y) => ({ x, y }),
      });

      // Enter Hammer targeting mode and tap occupied cell (row=1, col=2) of L3_BR (x=2.5, y=1.5)
      controller.setInputMode('TARGET_HAMMER');
      for (const fn of listeners.get('pointerdown') ?? []) {
        fn({ clientX: 2.5, clientY: 1.5, button: 0, pointerId: 1, pointerType: 'mouse' });
      }

      expect(board.blocks[0].status).toBe('CLEARED');
      expect(controller.getInputMode()).toBe('DRAG');
      controller.destroy();
    });
  });

  describe('SoundEngine Suspended Context & Ambient Music Scheduler Hardening', () => {
    it('clamps nextNoteTime when behind currentTime and does not throw when AudioContext is unavailable', () => {
      const sound = new SoundEngine({
        sfxEnabled: true,
        musicEnabled: true,
        hapticsEnabled: false,
      });
      expect(() => {
        sound.playPickup();
        sound.playSlideTick();
        sound.playWallClack();
        sound.playSnap();
        sound.playShred(1);
        sound.playLayerPeel();
        sound.playIceCrack();
        sound.playLockOpen();
        sound.playBooster('HAMMER');
        sound.playWinFanfare();
        sound.playLossBuzzer();
        sound.playButtonTap();
        sound.playRelicAwaken();
      }).not.toThrow();
      sound.destroy();
    });

    it('RELIC-AWAKEN-01 audio: synthesizes sustained (~1.68s), slightly louder low-frequency stone-break rumble + warm swept whoosh/swish with zero harsh or high-pitched chime oscillators', () => {
      const oscFreqs: number[] = [];
      const filterConfigs: Array<{ type: string; freq: number; q: number }> = [];
      const initialGains: number[] = [];
      const bufferLengths: number[] = [];
      const stopTimes: number[] = [];

      const makeParam = (record?: (v: number) => void) => ({
        value: 0,
        setValueAtTime: (v: number) => record?.(v),
        linearRampToValueAtTime: (v: number) => record?.(v),
        exponentialRampToValueAtTime: (v: number) => record?.(v),
      });

      const mockDest = {} as GainNode;
      const mockCtx = {
        currentTime: 1.0,
        sampleRate: 44100,
        createBuffer: (_ch: number, len: number) => {
          bufferLengths.push(len);
          return {
            getChannelData: () => new Float32Array(len),
          };
        },
        createBufferSource: () => ({
          buffer: null,
          playbackRate: makeParam(),
          connect: () => {},
          start: () => {},
          stop: (t: number) => stopTimes.push(t),
        }),
        createOscillator: () => ({
          type: 'sine',
          frequency: makeParam((f) => oscFreqs.push(f)),
          detune: makeParam(),
          connect: () => {},
          start: () => {},
          stop: (t: number) => stopTimes.push(t),
        }),
        createBiquadFilter: () => {
          const cfg = { type: 'lowpass', freq: 0, q: 1 };
          filterConfigs.push(cfg);
          return {
            set type(t: string) {
              cfg.type = t;
            },
            get type() {
              return cfg.type;
            },
            frequency: makeParam((f) => {
              cfg.freq = Math.max(cfg.freq, f);
            }),
            Q: makeParam((q) => {
              cfg.q = q;
            }),
            connect: () => {},
          };
        },
        createGain: () => {
          let recordedFirst = false;
          return {
            gain: makeParam((v) => {
              if (!recordedFirst) {
                recordedFirst = true;
                initialGains.push(v);
              }
            }),
            connect: () => {},
          };
        },
      } as unknown as AudioContext;

      playRelicAwakenVoice(mockCtx, mockDest);

      // Every tonal oscillator stays in deep bass / low baritone (<= 170 Hz) — zero high bell/ding pings!
      expect(oscFreqs.length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...oscFreqs)).toBeLessThanOrEqual(170);
      expect(Math.min(...oscFreqs)).toBeLessThanOrEqual(45);

      // Sustained stone-break rumble lasts >= 1.55s with a slightly louder master bus (>= 0.95)
      expect((bufferLengths[0] ?? 0) / 44100).toBeGreaterThanOrEqual(1.55);
      expect(Math.max(...stopTimes) - 1.0).toBeGreaterThanOrEqual(1.55);
      const masterBusGains = initialGains.filter((g) => g >= 0.5);
      expect(masterBusGains[0]).toBeGreaterThanOrEqual(0.95);

      // Includes lowpass warmth ceiling + dual rumble lowpasses + swept bandpass whoosh/swish with Q <= 1.0
      expect(filterConfigs.some((f) => f.type === 'lowpass' && f.freq <= 1300)).toBe(true);
      expect(filterConfigs.filter((f) => f.type === 'lowpass').length).toBeGreaterThanOrEqual(4);
      expect(filterConfigs.filter((f) => f.type === 'bandpass').length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...filterConfigs.map((f) => f.q))).toBeLessThanOrEqual(1.0);

      // All voice envelopes start near silence (0.0001) -> zero clicks!
      const voiceInitialGains = initialGains.filter((g) => g < 0.5);
      expect(voiceInitialGains.length).toBeGreaterThanOrEqual(8);
      expect(Math.max(...voiceInitialGains)).toBeLessThanOrEqual(0.001);
    });
  });

  describe('AX-01, AX-02 & UX-10: Full Settings Matrix, High-Contrast Palettes & Custom Theme Compatibility', () => {
    it('persists and round-trips all 8 settings and all 15 customization items across SaveManager and SaveCode', () => {
      const manager = new SaveManager();

      const skins: SkinId[] = ['classic_studs', 'relic_stone', 'gummy_jelly', 'carved_wood', 'neon_cyber'];
      const trays: TrayId[] = [
        'industrial_slate',
        'warm_birch',
        'midnight_arcade',
        'frosted_quartz',
        'mint_studio',
      ];
      const particles: ParticleStyleId[] = [
        'micro_cubes',
        'star_confetti',
        'pixel_sparks',
        'soap_bubbles',
        'lightning_bolts',
      ];
      const tiers: QualityTier[] = ['AUTO', 'ULTRA_120', 'BALANCED_60'];

      for (const skin of skins) {
        expect(manager.unlockOrEquipSkin(skin, 0)).toBe(true);
        expect(manager.getPayload().equippedSkin).toBe(skin);
      }
      for (const tray of trays) {
        expect(manager.unlockOrEquipTray(tray, 0)).toBe(true);
        expect(manager.getPayload().equippedTray).toBe(tray);
      }
      for (const particle of particles) {
        expect(manager.unlockOrEquipParticle(particle, 0)).toBe(true);
        expect(manager.getPayload().equippedParticle).toBe(particle);
      }

      for (const tier of tiers) {
        const updated = manager.updateSettings({
          playMode: tier === 'ULTRA_120' ? 'TIMED' : 'ZEN',
          sfxEnabled: false,
          musicEnabled: false,
          hapticsEnabled: false,
          colorblindSymbols: true,
          highContrast: true,
          reducedMotion: true,
          qualityTier: tier,
        });
        expect(updated.settings).toEqual({
          playMode: tier === 'ULTRA_120' ? 'TIMED' : 'ZEN',
          sfxEnabled: false,
          musicEnabled: false,
          hapticsEnabled: false,
          colorblindSymbols: true,
          highContrast: true,
          reducedMotion: true,
          qualityTier: tier,
        });

        const code = manager.exportSaveCode();
        const decoded = decodeSaveCode(code);
        expect(decoded.settings).toEqual(updated.settings);
        expect(decoded.equippedSkin).toBe('neon_cyber');
        expect(decoded.equippedTray).toBe('mint_studio');
        expect(decoded.equippedParticle).toBe('lightning_bolts');
      }
    });

    it('ensures every COLOR_PALETTE entry (0..9) has unique collision-free sacred-geometry sigils, distinct High-Contrast RGB values, and Universal CVD-safe perceptual separation (AX-01, AX-02)', () => {
      const symbols = new Set<string>();
      const hcHexes = new Set<string>();
      const cbHexes = new Set<string>();
      for (let c = 0 as ColorId; c <= 9; c = (c + 1) as ColorId) {
        const entry = COLOR_PALETTE[c];
        expect(entry).toBeDefined();
        expect(entry.symbol.length).toBeGreaterThan(0);
        // Never collide with Star Block / Star Gate mechanic glyph ('★')
        expect(entry.symbol).not.toBe('★');
        symbols.add(entry.symbol);
        hcHexes.add(entry.highContrastPrimaryHex);
        cbHexes.add(entry.cbPrimaryHex);

        // Verify hcRgb differs meaningfully from normal rgb so High Contrast is visually distinct
        const delta =
          Math.abs(entry.hcRgb[0] - entry.rgb[0]) +
          Math.abs(entry.hcRgb[1] - entry.rgb[1]) +
          Math.abs(entry.hcRgb[2] - entry.rgb[2]);
        expect(delta).toBeGreaterThan(0.12);

        if (c >= 1) {
          // MYSTIC-RELIC-01 shader invariant: active piece colors maintain chroma >= 0.48
          expect(Math.max(...entry.cbRgb) - Math.min(...entry.cbRgb)).toBeGreaterThanOrEqual(0.48);
          expect(Math.max(...entry.cbHcRgb) - Math.min(...entry.cbHcRgb)).toBeGreaterThanOrEqual(0.48);
        }
      }
      expect(symbols.size).toBe(10);
      expect(hcHexes.size).toBe(10);
      expect(cbHexes.size).toBe(10);
    });

    it('enforces dark high-contrast floor tiles and bright wall rims across all 5 custom Board Trays when highContrast is enabled', () => {
      const trays: TrayId[] = [
        'industrial_slate',
        'warm_birch',
        'midnight_arcade',
        'frosted_quartz',
        'mint_studio',
      ];
      const getEffective = Renderer3D.prototype.getEffectiveTrayPalette;

      for (const tray of trays) {
        const stdPalette = getEffective(tray, false);
        const hcPalette = getEffective(tray, true);
        expect(hcPalette).not.toEqual(stdPalette);

        // High-contrast floor tiles must be dark (<= 0.18 per channel) even on bright trays like warm_birch/frosted_quartz/mint_studio
        expect(Math.max(...hcPalette.floorTileA)).toBeLessThanOrEqual(0.18);
        expect(Math.max(...hcPalette.floorTileB)).toBeLessThanOrEqual(0.14);

        // High-contrast perimeter wall rims must be bright (>= 0.78 on their primary channel)
        expect(Math.max(...hcPalette.rimHighlight)).toBeGreaterThanOrEqual(0.78);
      }
    });
  });
});
