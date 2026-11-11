import { describe, expect, it } from 'vitest';
import type { SavePayloadV1 } from '../../src/core/types';
import {
  computeCrc32Hex,
  decodeSaveCode,
  encodeSaveCode,
  SaveCodeError,
  validateSavePayloadV1,
} from '../../src/storage/save-code';
import { createDefaultSavePayload, extractImportCodeFromHash } from '../../src/storage/save-manager';

const SKINS = ['classic_studs', 'smooth_bevel', 'gummy_jelly', 'carved_wood', 'neon_cyber'];
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
        ['stars', 'bestMoves', 'bestTimeSec', 'skipped', 'zenCleared'].includes(key)
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
