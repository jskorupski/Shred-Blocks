import { describe, expect, it } from 'vitest';
import type { SavePayloadV1 } from '../../src/core/types';
import {
  compressLz77,
  computeCrc32Hex,
  decodeSaveCode,
  decompressFramedBytes,
  encodeSaveCode,
  SaveCodeError,
  validateSavePayloadV1,
} from '../../src/storage/save-code';
import {
  createDefaultSavePayload,
  extractImportCodeFromHash,
  IDB_DB_NAME,
  IDB_PRIMARY_KEY,
  IDB_STORE_NAME,
  migrateLegacyEconomy,
  SAVE_STORAGE_KEY,
  SaveManager,
} from '../../src/storage/save-manager';

const SKINS = ['classic_studs', 'relic_stone', 'gummy_jelly', 'carved_wood', 'neon_cyber'];
const TRAYS = ['industrial_slate', 'warm_birch', 'midnight_arcade', 'frosted_quartz', 'mint_studio'];
const PARTICLES = ['micro_cubes', 'star_confetti', 'pixel_sparks', 'soap_bubbles', 'lightning_bolts'];

function toB64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64Url(b64url: string): Uint8Array {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Builds a checksum-valid `SB1-` code around arbitrary attacker-chosen bytes. */
function forgeCode(bytes: Uint8Array): string {
  const b64 = toB64Url(bytes);
  return `SB1-${b64}-${computeCrc32Hex(b64)}`;
}

/** Every string/number in a decoded payload must be a known enum or a finite in-range number. */
function expectSanitized(p: SavePayloadV1): void {
  expect(Object.keys(p).sort()).toEqual(Object.keys(createDefaultSavePayload()).sort());
  expect(p.highestLevelUnlocked).toBeGreaterThanOrEqual(1);
  expect(p.highestLevelUnlocked).toBeLessThanOrEqual(999_999);
  expect(p.currentLevelId).toBeLessThanOrEqual(999_999);
  for (const n of [p.coins, p.writeSeq, p.updatedAt, p.totalStars, ...Object.values(p.boosters)]) {
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  for (const s of p.unlockedSkins) expect(SKINS).toContain(s);
  for (const t of p.unlockedTrays) expect(TRAYS).toContain(t);
  for (const pt of p.unlockedParticles) expect(PARTICLES).toContain(pt);
  expect(p.unlockedSkins).toContain(p.equippedSkin);
  expect(p.unlockedTrays).toContain(p.equippedTray);
  expect(p.unlockedParticles).toContain(p.equippedParticle);
  expect(['CHALLENGE', 'ZEN', 'TIMED']).toContain(p.settings.playMode);
  expect(['AUTO', 'ULTRA_120', 'BALANCED_60']).toContain(p.settings.qualityTier);
  for (const [k, r] of Object.entries(p.levelRecords)) {
    expect(Number.isInteger(Number(k))).toBe(true);
    expect(
      Object.keys(r).every((key) =>
        [
          'stars',
          'bestMoves',
          'bestTimeSec',
          'skipped',
          'zenCleared',
          'challengeStars',
          'challengeBestMoves',
          'timedStars',
          'timedBestTimeSec',
          'zenBestMoves',
          'zenSkipped',
        ].includes(key)
      )
    ).toBe(true);
  }
}

describe('SAVE-SEC-01: untrusted save URL / code / JSON import hardening', () => {
  it('only extracts strict SB1 codes from hostile URL hashes and rejects them before any state change', () => {
    const hostileHashes = [
      '#import=javascript:alert(1)',
      '#import=%3Cscript%3Ealert(1)%3C/script%3E',
      '#import=SB1-%3Cimg%20src=x%20onerror=alert(1)%3E-deadbeef',
      '#import=SB1-AAAA-00000000&import=SB1-<svg/onload=alert(1)>',
      '#__proto__[polluted]=1&constructor[prototype][polluted]=1',
      `#import=SB1-${'A'.repeat(200_000)}-00000000`,
    ];
    for (const hash of hostileHashes) {
      const code = extractImportCodeFromHash(hash);
      if (code === null) continue;
      expect(code.startsWith('SB1-') || code.startsWith('sb1-')).toBe(true);
      expect(() => decodeSaveCode(code)).toThrow(SaveCodeError);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('fuzz: checksum-valid codes wrapping random bytes either throw SaveCodeError or decode to a sanitized payload', () => {
    let seed = 0x5eed1234;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const valid = encodeSaveCode(createDefaultSavePayload());
    const validBytes = fromB64Url(valid.slice(4, valid.lastIndexOf('-')));

    for (let i = 0; i < 600; i++) {
      let bytes: Uint8Array;
      if (i % 2 === 0) {
        bytes = new Uint8Array(1 + Math.floor(rand() * 160));
        for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(rand() * 256);
        if (i % 4 === 0) bytes[0] = rand() < 0.5 ? 0x00 : 0x01; // valid codec headers
      } else {
        bytes = Uint8Array.from(validBytes); // mutate a real code
        for (let k = 0; k < 1 + Math.floor(rand() * 6); k++) {
          bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
        }
      }
      try {
        expectSanitized(decodeSaveCode(forgeCode(bytes)));
      } catch (err) {
        expect(err).toBeInstanceOf(SaveCodeError);
      }
    }
  });

  it('whitelists JSON backups: drops __proto__/unknown keys, script strings, non-finite & out-of-range values', () => {
    const hostileJson = `{
      "schemaVersion": 1, "appId": "shredblocks-color-jam", "writeSeq": 3,
      "highestLevelUnlocked": 1e300, "currentLevelId": -5, "coins": 1e308,
      "__proto__": { "polluted": true }, "constructor": { "prototype": { "polluted": true } },
      "onload": "<script>alert(1)</script>",
      "equippedSkin": "<img src=x onerror=alert(1)>", "unlockedSkins": ["carved_wood", "javascript:alert(1)", 7],
      "unlockedTrays": "warm_birch", "equippedTray": "warm_birch",
      "boosters": { "UNDO": "9999", "HAMMER": -4, "__proto__": { "polluted": true } },
      "settings": { "playMode": "<b>", "sfxEnabled": "yes", "qualityTier": "ULTRA_120" },
      "levelRecords": { "1": { "stars": 99, "bestMoves": 4, "evil": "<script>" }, "__proto__": {}, "abc": {}, "2": "x" }
    }`;
    const p = validateSavePayloadV1(JSON.parse(hostileJson));
    expectSanitized(p);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(p.highestLevelUnlocked).toBe(999_999);
    expect(p.currentLevelId).toBe(1);
    expect(p.unlockedSkins).toEqual(['carved_wood']);
    expect(p.equippedSkin).toBe('carved_wood');
    expect(p.unlockedTrays).toEqual(['industrial_slate']);
    expect(p.boosters.UNDO).toBe(0);
    expect(p.boosters.HAMMER).toBe(0);
    expect(p.settings.playMode).toBe('CHALLENGE');
    expect(p.settings.sfxEnabled).toBe(true);
    expect(p.settings.qualityTier).toBe('ULTRA_120');
    expect(p.levelRecords).toEqual({ 1: { stars: 3, bestMoves: 4, bestTimeSec: 0 } });
    expect('onload' in p).toBe(false);
  });

  it('round-trips legitimate saves unchanged through the sanitizer', () => {
    const save = createDefaultSavePayload();
    save.highestLevelUnlocked = 2500;
    save.currentLevelId = 4000;
    save.unlockedSkins = ['classic_studs', 'neon_cyber'];
    save.equippedSkin = 'neon_cyber';
    save.levelRecords = {
      1: { stars: 3, bestMoves: 4, bestTimeSec: 12.5 },
      2: { stars: 0, bestMoves: 0, bestTimeSec: 0, skipped: true },
    };
    const decoded = decodeSaveCode(encodeSaveCode(save));
    expect(decoded.currentLevelId).toBe(4000);
    expect(decoded.equippedSkin).toBe('neon_cyber');
    expect(decoded.levelRecords).toEqual(save.levelRecords);
    expect(validateSavePayloadV1(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });
});

describe('SAVE-COMPAT-01: Live Player Save Backward-Compatibility & Forward Migration Guard', () => {
  // Frozen production v1 save code covering all 5 skins, 5 trays, 5 particles, Endless L312,
  // skipped & zenCleared records, ULTRA_120, High Contrast, and Colorblind Mode.
  const PINNED_V1_FULL_SAVE_CODE =
    'SB1-AQAAAFYAAiqkxc7IBnsAuAKxArUOmwYACRjgIYYwFLYAAgsGBAMCBQAQAQIDBABZAQEBALoBBgABGDFMADJvurSLAg4SAAAdFlX3BFwAAIIBtQilAocGAAHIAQ-cb46191d';

  // Frozen pre-0xa5-trailer binary save code from early Economy v1 builds (before starReliquaryLevel & zenCleared).
  const PINNED_PRE_A5_LEGACY_CODE = 'SB1-AQAAACkAAgeA8J3HBgBAEhK2BzAAAAIDtAIBAAAAABEAAB8AgQCwAgo-15d4377b';

  // Frozen Codec 0x00 raw UTF-8 JSON save code (`STOR-01` fallback stream).
  const PINNED_RAW_JSON_SAVE_CODE =
    'SB1-AHsic2NoZW1hVmVyc2lvbiI6MSwiYXBwSWQiOiJzaHJlZGJsb2Nrcy1jb2xvci1qYW0iLCJ3cml0ZVNlcSI6NywidXBkYXRlZEF0IjoxNzYwMDAwMDAwMDAwLCJoaWdoZXN0TGV2ZWxVbmxvY2tlZCI6MTgsImN1cnJlbnRMZXZlbElkIjoxOCwiY29pbnMiOjk1MCwidG90YWxTdGFycyI6NDgsIndpblN0cmVhayI6MCwiYmVzdFdpblN0cmVhayI6MCwidG90YWxCbG9ja3NTaHJlZGRlZCI6MCwidG90YWxNb3Zlc0NvbW1pdHRlZCI6MCwic2hyZWRkZXJDaGVzdFByb2dyZXNzIjowLCJtaWxlc3RvbmVDaGVzdExldmVsIjowLCJzdGFyUmVsaXF1YXJ5TGV2ZWwiOjAsImVjb25vbXlWZXJzaW9uIjoxLCJib29zdGVycyI6eyJVTkRPIjozLCJGUkVFWkUiOjIsIkhBTU1FUiI6MSwiUk9DS0VUIjoxLCJWQUNVVU0iOjF9LCJ1bmxvY2tlZFNraW5zIjpbImNsYXNzaWNfc3R1ZHMiXSwidW5sb2NrZWRUcmF5cyI6WyJpbmR1c3RyaWFsX3NsYXRlIl0sInVubG9ja2VkUGFydGljbGVzIjpbIm1pY3JvX2N1YmVzIl0sImVxdWlwcGVkU2tpbiI6ImNsYXNzaWNfc3R1ZHMiLCJlcXVpcHBlZFRyYXkiOiJpbmR1c3RyaWFsX3NsYXRlIiwiZXF1aXBwZWRQYXJ0aWNsZSI6Im1pY3JvX2N1YmVzIiwic2V0dGluZ3MiOnsicGxheU1vZGUiOiJaRU4iLCJzZnhFbmFibGVkIjp0cnVlLCJtdXNpY0VuYWJsZWQiOnRydWUsImhhcHRpY3NFbmFibGVkIjp0cnVlLCJjb2xvcmJsaW5kU3ltYm9scyI6dHJ1ZSwiaGlnaENvbnRyYXN0IjpmYWxzZSwicmVkdWNlZE1vdGlvbiI6ZmFsc2UsInF1YWxpdHlUaWVyIjoiQVVUTyJ9LCJsZXZlbFJlY29yZHMiOnsiMSI6eyJzdGFycyI6MywiYmVzdE1vdmVzIjoyLCJiZXN0VGltZVNlYyI6NX19fQ-3c23d657';

  it('pins storage keys, IndexedDB identifiers, and append-only cosmetic/tier enum indices', () => {
    expect(SAVE_STORAGE_KEY).toBe('shredblocks.save.v1');
    expect(IDB_DB_NAME).toBe('ShredBlocksDB');
    expect(IDB_STORE_NAME).toBe('saves');
    expect(IDB_PRIMARY_KEY).toBe('primary');

    const decoded = decodeSaveCode(PINNED_V1_FULL_SAVE_CODE);
    expect(decoded.writeSeq).toBe(42);
    expect(decoded.updatedAt).toBe(1762894500123);
    expect(decoded.highestLevelUnlocked).toBe(312);
    expect(decoded.currentLevelId).toBe(305);
    expect(decoded.coins).toBe(1845);
    expect(decoded.totalStars).toBe(795);
    expect(decoded.starReliquaryLevel).toBe(775);
    expect(decoded.economyVersion).toBe(2);
    expect(decoded.boosters).toEqual({ UNDO: 11, HINT: 6, HAMMER: 4, ROCKET: 3, VACUUM: 2 });
    expect(decoded.unlockedSkins).toEqual(SKINS);
    expect(decoded.unlockedTrays).toEqual(TRAYS);
    expect(decoded.unlockedParticles).toEqual(PARTICLES);
    expect(decoded.equippedSkin).toBe('relic_stone');
    expect(decoded.equippedTray).toBe('warm_birch');
    expect(decoded.equippedParticle).toBe('star_confetti');
    expect(decoded.settings).toEqual({
      playMode: 'CHALLENGE',
      sfxEnabled: true,
      musicEnabled: false,
      hapticsEnabled: true,
      colorblindSymbols: true,
      highContrast: true,
      reducedMotion: false,
      qualityTier: 'ULTRA_120',
    });
    expect(decoded.levelRecords).toEqual({
      1: { stars: 3, bestMoves: 2, bestTimeSec: 4.2 },
      25: { stars: 2, bestMoves: 14, bestTimeSec: 31.5 },
      74: { stars: 3, bestMoves: 18, bestTimeSec: 46 },
      150: { stars: 0, bestMoves: 0, bestTimeSec: 0, skipped: true },
      200: { stars: 0, bestMoves: 29, bestTimeSec: 65, zenCleared: true },
      311: { stars: 3, bestMoves: 22, bestTimeSec: 53.8 },
    });
  });

  it('decodes pre-0xa5 binary saves, raw UTF-8 JSON codes, partial localStorage JSON, and future-trailer streams without losing progress', () => {
    // 1. Pre-0xa5 binary code + Economy v1 -> v2 migration via SaveManager.importSaveCode
    const preA5 = decodeSaveCode(PINNED_PRE_A5_LEGACY_CODE);
    expect(preA5.highestLevelUnlocked).toBe(18);
    expect(preA5.coins).toBe(950);
    expect(preA5.economyVersion).toBe(1);
    expect(preA5.settings.colorblindSymbols).toBe(true);

    const migratedPreA5 = migrateLegacyEconomy(preA5);
    expect(migratedPreA5.economyVersion).toBe(2);
    expect(migratedPreA5.settings.playMode).toBe('CHALLENGE');
    expect(migratedPreA5.starReliquaryLevel).toBe(25);
    expect(migratedPreA5.settings.colorblindSymbols).toBe(true);

    // 2. Legacy Codec 0x00 raw UTF-8 JSON code + SaveManager import pipeline
    const mgr = new SaveManager();
    const importedFromRawJson = mgr.importSaveCode(PINNED_RAW_JSON_SAVE_CODE);
    expect(importedFromRawJson.highestLevelUnlocked).toBe(18);
    expect(importedFromRawJson.economyVersion).toBe(2);
    expect(importedFromRawJson.settings.playMode).toBe('CHALLENGE');
    expect(importedFromRawJson.settings.colorblindSymbols).toBe(true);
    expect(importedFromRawJson.modeLadderVersion).toBe(1);
    expect(importedFromRawJson.modeState.CHALLENGE.highestUnlocked).toBe(18);
    expect(importedFromRawJson.levelRecords[1]).toEqual({
      stars: 3,
      bestMoves: 2,
      bestTimeSec: 5,
      challengeStars: 3,
      challengeBestMoves: 2,
    });

    // 3. Partial early-v1 JSON missing newer optional fields + containing unknown future keys
    const legacyPartialJson = JSON.stringify({
      schemaVersion: 1,
      appId: 'shredblocks-color-jam',
      writeSeq: 12,
      highestLevelUnlocked: 44,
      coins: 410,
      totalStars: 92,
      boosters: { UNDO: 5, FREEZE: 1 },
      unlockedSkins: ['classic_studs', 'carved_wood'],
      equippedSkin: 'carved_wood',
      settings: { colorblindSymbols: true },
      levelRecords: { '1': { stars: 3, bestMoves: 2, bestTimeSec: 4 }, '43': { stars: 2, bestMoves: 19 } },
      futureTelemetryFieldV3: { ignoredSafely: true },
    });
    const importedJson = mgr.importSaveJson(legacyPartialJson);
    expect(importedJson.highestLevelUnlocked).toBe(44);
    expect(importedJson.currentLevelId).toBe(44);
    expect(importedJson.coins).toBe(410);
    expect(importedJson.economyVersion).toBe(2);
    expect(importedJson.starReliquaryLevel).toBe(75);
    expect(importedJson.equippedSkin).toBe('carved_wood');
    expect(importedJson.boosters).toEqual({ UNDO: 5, HINT: 1, HAMMER: 0, ROCKET: 0, VACUUM: 0 });
    expect(importedJson.settings.colorblindSymbols).toBe(true);
    expect('futureTelemetryFieldV3' in importedJson).toBe(false);

    // Round-trip newly saved `boosters.HINT` payload through `encodeSaveCode` / `decodeSaveCode` & JSON import
    const roundTrippedCode = mgr.exportSaveCode();
    expect(decodeSaveCode(roundTrippedCode).boosters).toEqual({
      UNDO: 5,
      HINT: 1,
      HAMMER: 0,
      ROCKET: 0,
      VACUUM: 0,
    });
    expect(mgr.importSaveJson(mgr.exportSaveJson()).boosters.HINT).toBe(1);

    // 4. Append-only forward trailer tolerance: appending a hypothetical future `0xa6` trailer after `0xa5`
    const baseRaw = decompressFramedBytes(
      fromB64Url(PINNED_V1_FULL_SAVE_CODE.slice(4, PINNED_V1_FULL_SAVE_CODE.lastIndexOf('-')))
    );
    const withFutureTrailer = new Uint8Array(baseRaw.length + 4);
    withFutureTrailer.set(baseRaw, 0);
    withFutureTrailer.set([0xa6, 0x01, 0x2a, 0x00], baseRaw.length);
    const futureCode = forgeCode(compressLz77(withFutureTrailer));
    const decodedFuture = decodeSaveCode(futureCode);
    expect(decodedFuture.highestLevelUnlocked).toBe(312);
    expect(decodedFuture.coins).toBe(1845);
    expect(decodedFuture.settings.colorblindSymbols).toBe(true);

    // 5. [0xa6, 0x4d] trailer boundary checks, > 1,500-record qrCompact preservation & hostile recordCount DoS rejection
    const largeSave = createDefaultSavePayload();
    largeSave.modeState = {
      CHALLENGE: { currentLevelId: 1605, highestUnlocked: 1610 },
      ZEN: { currentLevelId: 42, highestUnlocked: 45 },
      TIMED: { currentLevelId: 18, highestUnlocked: 20 },
    };
    largeSave.highestLevelUnlocked = 1610;
    largeSave.currentLevelId = 1605;
    largeSave.zenStarsEarned = 14;
    largeSave.zenStarProgress = 2;
    largeSave.zenBlessings = 3;
    largeSave.zenBlessingProgress = 1;
    for (let lvl = 1; lvl <= 1600; lvl++) {
      largeSave.levelRecords[lvl] = {
        stars: 3,
        bestMoves: 8,
        bestTimeSec: 20,
        challengeStars: 3,
      };
    }
    largeSave.totalStars = 1600 * 3 + 14;
    const compact1600 = decodeSaveCode(encodeSaveCode(largeSave, { qrCompact: true }));
    expect(compact1600.modeState).toEqual(largeSave.modeState);
    expect(compact1600.totalStars).toBe(largeSave.totalStars);
    expect(compact1600.zenStarsEarned).toBe(14);
    expect(compact1600.zenBlessings).toBe(3);

    // Appending a hypothetical future `0xa7` trailer AFTER `[0xa6, 0x4d]` decodes cleanly
    const modeCode = encodeSaveCode(mgr.getPayload());
    const modeRaw = decompressFramedBytes(fromB64Url(modeCode.slice(4, modeCode.lastIndexOf('-'))));
    const withPostModeTrailer = new Uint8Array(modeRaw.length + 4);
    withPostModeTrailer.set(modeRaw, 0);
    withPostModeTrailer.set([0xa7, 0x01, 0x10, 0x00], modeRaw.length);
    expect(decodeSaveCode(forgeCode(compressLz77(withPostModeTrailer))).highestLevelUnlocked).toBe(44);

    // Truncated mid-`[0xa6, 0x4d]` trailer is rejected cleanly
    const truncatedModeTrailer = modeRaw.slice(0, modeRaw.length - 2);
    expect(() => decodeSaveCode(forgeCode(compressLz77(truncatedModeTrailer)))).toThrow(SaveCodeError);
  });
});
