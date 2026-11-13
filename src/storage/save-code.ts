import type { ParticleStyleId, QualityTier, SavePayloadV1, SkinId, TrayId } from '../core/types';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  CODEC_HEADER_LZ77_V1,
  CODEC_HEADER_RAW_UTF8,
  compressLz77,
  computeCrc32Hex,
  crc32Bytes,
  decompressFramedBytes,
  SaveCodeError,
} from './save-lz77-crc';
import { packModeSplitTrailer, sanitizeModeState, unpackModeSplitTrailer } from './save-mode-ladders';

export {
  CODEC_HEADER_LZ77_V1,
  CODEC_HEADER_RAW_UTF8,
  compressLz77,
  computeCrc32Hex,
  crc32Bytes,
  decompressFramedBytes,
  SaveCodeError,
};

// SAVE-COMPAT-01: Enum index arrays are APPEND-ONLY. Never reorder or remove existing entries,
// because live `SB1-...` binary save codes encode unlocked/equipped cosmetics by array index.
const SKIN_IDS: ReadonlyArray<SkinId> = [
  'classic_studs',
  'relic_stone',
  'gummy_jelly',
  'carved_wood',
  'neon_cyber',
];
const TRAY_IDS: ReadonlyArray<TrayId> = [
  'industrial_slate',
  'warm_birch',
  'midnight_arcade',
  'frosted_quartz',
  'mint_studio',
];
const PARTICLE_IDS: ReadonlyArray<ParticleStyleId> = [
  'micro_cubes',
  'star_confetti',
  'pixel_sparks',
  'soap_bubbles',
  'lightning_bolts',
];
const QUALITY_TIERS: ReadonlyArray<QualityTier> = ['AUTO', 'ULTRA_120', 'BALANCED_60'];

/**
 * Validates that an unknown parsed JSON object conforms to `SavePayloadV1`.
 */
export function validateSavePayloadV1(candidate: unknown): SavePayloadV1 {
  if (!candidate || typeof candidate !== 'object') {
    throw new SaveCodeError('INVALID_SCHEMA', 'Save payload is not a JSON object.');
  }

  const obj = candidate as Partial<SavePayloadV1>;
  if (obj.schemaVersion !== 1) {
    throw new SaveCodeError(
      'INVALID_SCHEMA',
      `Unsupported schemaVersion: ${String(obj.schemaVersion)} (expected 1).`
    );
  }
  if (obj.appId !== 'shredblocks-color-jam') {
    throw new SaveCodeError(
      'INVALID_SCHEMA',
      `Invalid appId: ${String(obj.appId)} (expected 'shredblocks-color-jam').`
    );
  }
  if (typeof obj.writeSeq !== 'number' || !Number.isFinite(obj.writeSeq) || obj.writeSeq < 0) {
    throw new SaveCodeError('INVALID_SCHEMA', 'Invalid writeSeq in save payload.');
  }
  if (typeof obj.highestLevelUnlocked !== 'number' || obj.highestLevelUnlocked < 1) {
    throw new SaveCodeError('INVALID_SCHEMA', 'Invalid highestLevelUnlocked in save payload.');
  }
  if (typeof obj.coins !== 'number' || !Number.isFinite(obj.coins) || obj.coins < 0) {
    throw new SaveCodeError('INVALID_SCHEMA', 'Invalid coins in save payload.');
  }
  if (!obj.boosters || typeof obj.boosters !== 'object') {
    throw new SaveCodeError('INVALID_SCHEMA', 'Missing boosters inventory in save payload.');
  }
  if (!obj.settings || typeof obj.settings !== 'object') {
    throw new SaveCodeError('INVALID_SCHEMA', 'Missing settings in save payload.');
  }
  if (!obj.levelRecords || typeof obj.levelRecords !== 'object') {
    throw new SaveCodeError('INVALID_SCHEMA', 'Missing levelRecords in save payload.');
  }

  return sanitizeSavePayload(obj);
}

/** Highest addressable level (`MAX_ENDLESS_LEVEL` in `src/ui/catalog-meta.ts`). */
const MAX_SAVE_LEVEL = 999_999;
const MAX_SAVE_COUNTER = 1_000_000_000_000;

function clampNum(v: unknown, min: number, max: number, fallback: number, integer = true): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const n = integer ? Math.floor(v) : v;
  return Math.min(max, Math.max(min, n));
}

function pickEnum<T extends string>(v: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  return typeof v === 'string' && (allowed as ReadonlyArray<string>).includes(v) ? (v as T) : fallback;
}

function pickEnumList<T extends string>(v: unknown, allowed: ReadonlyArray<T>, fallback: T): T[] {
  const list = Array.isArray(v) ? v.filter((x): x is T => pickEnum(x, allowed, fallback) === x) : [];
  const unique = [...new Set(list)];
  return unique.length > 0 ? unique : [fallback];
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Untrusted-input hardening (`SAVE-SEC-01`): rebuilds the payload from a strict whitelist so imported
 * data (URL `#import=`, pasted codes, JSON files, storage) can never carry unknown keys (`__proto__`,
 * `constructor`), non-enum strings, non-finite numbers, or out-of-range values into app state.
 */
function sanitizeSavePayload(obj: Partial<SavePayloadV1>): SavePayloadV1 {
  const b = (obj.boosters ?? {}) as Partial<Record<string, unknown>>;
  const s = (obj.settings ?? {}) as Partial<Record<string, unknown>>;
  const highest = clampNum(obj.highestLevelUnlocked, 1, MAX_SAVE_LEVEL, 1);
  const unlockedSkins = pickEnumList(obj.unlockedSkins, SKIN_IDS, 'classic_studs');
  const unlockedTrays = pickEnumList(obj.unlockedTrays, TRAY_IDS, 'industrial_slate');
  const unlockedParticles = pickEnumList(obj.unlockedParticles, PARTICLE_IDS, 'micro_cubes');

  const levelRecords: SavePayloadV1['levelRecords'] = {};
  for (const [key, rec] of Object.entries(obj.levelRecords ?? {})) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 1 || id > MAX_SAVE_LEVEL) continue;
    if (!rec || typeof rec !== 'object') continue;
    const r = rec as unknown as Record<string, unknown>;
    const clean: SavePayloadV1['levelRecords'][number] = {
      stars: clampNum(r.stars, 0, 3, 0),
      bestMoves: clampNum(r.bestMoves, 0, MAX_SAVE_COUNTER, 0),
      bestTimeSec: clampNum(r.bestTimeSec, 0, MAX_SAVE_COUNTER, 0, false),
    };
    if (typeof r.skipped === 'boolean') clean.skipped = r.skipped;
    if (typeof r.zenCleared === 'boolean') clean.zenCleared = r.zenCleared;
    if (typeof r.challengeStars === 'number' && Number.isFinite(r.challengeStars))
      clean.challengeStars = clampNum(r.challengeStars, 0, 3, 0);
    if (typeof r.challengeBestMoves === 'number' && Number.isFinite(r.challengeBestMoves))
      clean.challengeBestMoves = clampNum(r.challengeBestMoves, 0, MAX_SAVE_COUNTER, 0);
    if (typeof r.timedStars === 'number' && Number.isFinite(r.timedStars))
      clean.timedStars = clampNum(r.timedStars, 0, 3, 0);
    if (typeof r.timedBestTimeSec === 'number' && Number.isFinite(r.timedBestTimeSec))
      clean.timedBestTimeSec = clampNum(r.timedBestTimeSec, 0, MAX_SAVE_COUNTER, 0, false);
    if (typeof r.zenBestMoves === 'number' && Number.isFinite(r.zenBestMoves))
      clean.zenBestMoves = clampNum(r.zenBestMoves, 0, MAX_SAVE_COUNTER, 0);
    if (typeof r.zenSkipped === 'boolean') clean.zenSkipped = r.zenSkipped;
    if (typeof r.underParCleared === 'boolean') clean.underParCleared = r.underParCleared;
    levelRecords[id] = clean;
  }

  return {
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: clampNum(obj.writeSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: clampNum(obj.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    highestLevelUnlocked: highest,
    currentLevelId: clampNum(obj.currentLevelId, 1, MAX_SAVE_LEVEL, highest),
    coins: clampNum(obj.coins, 0, MAX_SAVE_COUNTER, 0),
    totalStars: clampNum(obj.totalStars, 0, MAX_SAVE_COUNTER, 0),
    winStreak: clampNum(obj.winStreak, 0, MAX_SAVE_COUNTER, 0),
    bestWinStreak: clampNum(obj.bestWinStreak, 0, MAX_SAVE_COUNTER, 0),
    totalBlocksShredded: clampNum(obj.totalBlocksShredded, 0, MAX_SAVE_COUNTER, 0),
    totalMovesCommitted: clampNum(obj.totalMovesCommitted, 0, MAX_SAVE_COUNTER, 0),
    shredderChestProgress: clampNum(obj.shredderChestProgress, 0, MAX_SAVE_COUNTER, 0),
    milestoneChestLevel: clampNum(obj.milestoneChestLevel, 0, MAX_SAVE_LEVEL, 0),
    starReliquaryLevel: clampNum(obj.starReliquaryLevel, 0, MAX_SAVE_COUNTER, 0),
    economyVersion: clampNum(obj.economyVersion, 1, 10, 1),
    modeLadderVersion: clampNum(obj.modeLadderVersion, 0, 10, 0),
    modeState: sanitizeModeState(obj.modeState),
    zenStarsEarned: clampNum(obj.zenStarsEarned, 0, MAX_SAVE_COUNTER, 0),
    zenStarProgress: clampNum(obj.zenStarProgress, 0, 2, 0),
    zenBlessings: clampNum(obj.zenBlessings, 0, 3, 0),
    zenBlessingProgress: clampNum(obj.zenBlessingProgress, 0, 3, 0),
    boosters: {
      UNDO: clampNum(b.UNDO, 0, MAX_SAVE_COUNTER, 0),
      // SAVE-COMPAT-01: Migrate legacy `boosters.FREEZE` JSON payloads seamlessly to `boosters.HINT`
      HINT: clampNum(b.HINT ?? b.FREEZE, 0, MAX_SAVE_COUNTER, 0),
      HAMMER: clampNum(b.HAMMER, 0, MAX_SAVE_COUNTER, 0),
      ROCKET: clampNum(b.ROCKET, 0, MAX_SAVE_COUNTER, 0),
      VACUUM: clampNum(b.VACUUM, 0, MAX_SAVE_COUNTER, 0),
    },
    unlockedSkins,
    unlockedTrays,
    unlockedParticles,
    equippedSkin: pickEnum(obj.equippedSkin, unlockedSkins, unlockedSkins[0]),
    equippedTray: pickEnum(obj.equippedTray, unlockedTrays, unlockedTrays[0]),
    equippedParticle: pickEnum(obj.equippedParticle, unlockedParticles, unlockedParticles[0]),
    settings: {
      playMode: pickEnum(s.playMode, ['CHALLENGE', 'ZEN', 'TIMED'] as const, 'CHALLENGE'),
      sfxEnabled: pickBool(s.sfxEnabled, true),
      musicEnabled: pickBool(s.musicEnabled, true),
      hapticsEnabled: pickBool(s.hapticsEnabled, true),
      colorblindSymbols: pickBool(s.colorblindSymbols, false),
      highContrast: pickBool(s.highContrast, false),
      reducedMotion: pickBool(s.reducedMotion, false),
      qualityTier: pickEnum(s.qualityTier, QUALITY_TIERS, 'AUTO'),
    },
    levelRecords,
  };
}

function writeVarint(out: number[], value: number): void {
  let v = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/**
 * Packs a validated `SavePayloadV1` into a pure binary varint + columnar stream (`0x02` magic byte).
 * Shrinks save codes to ~64 chars (new player) and ~185-550 chars (300-level campaign).
 */
function packCompactSaveBytes(payload: SavePayloadV1, qrCompact = false): Uint8Array {
  const out: number[] = [0x02];
  writeVarint(out, payload.writeSeq);
  const ts = Math.max(0, Math.floor(payload.updatedAt || 0));
  writeVarint(out, Math.floor(ts / 1000));
  writeVarint(out, ts % 1000);
  writeVarint(out, payload.highestLevelUnlocked);
  writeVarint(out, payload.currentLevelId);
  writeVarint(out, payload.coins);
  writeVarint(out, payload.totalStars);
  writeVarint(out, payload.winStreak);
  writeVarint(out, payload.bestWinStreak);
  writeVarint(out, payload.totalBlocksShredded);
  writeVarint(out, payload.totalMovesCommitted);
  writeVarint(out, payload.shredderChestProgress);
  writeVarint(out, payload.milestoneChestLevel);

  const b = payload.boosters;
  writeVarint(out, b.UNDO || 0);
  writeVarint(out, b.HINT || 0);
  writeVarint(out, b.HAMMER || 0);
  writeVarint(out, b.ROCKET || 0);
  writeVarint(out, b.VACUUM || 0);

  out.push(payload.unlockedSkins.length);
  for (const s of payload.unlockedSkins) out.push(Math.max(0, SKIN_IDS.indexOf(s)));
  out.push(payload.unlockedTrays.length);
  for (const t of payload.unlockedTrays) out.push(Math.max(0, TRAY_IDS.indexOf(t)));
  out.push(payload.unlockedParticles.length);
  for (const pt of payload.unlockedParticles) out.push(Math.max(0, PARTICLE_IDS.indexOf(pt)));

  out.push(Math.max(0, SKIN_IDS.indexOf(payload.equippedSkin)));
  out.push(Math.max(0, TRAY_IDS.indexOf(payload.equippedTray)));
  out.push(Math.max(0, PARTICLE_IDS.indexOf(payload.equippedParticle)));

  const st = payload.settings;
  const sFlags =
    (st.playMode === 'ZEN' ? 1 : 0) |
    (st.sfxEnabled ? 2 : 0) |
    (st.musicEnabled ? 4 : 0) |
    (st.hapticsEnabled ? 8 : 0) |
    (st.colorblindSymbols ? 16 : 0) |
    (st.highContrast ? 32 : 0) |
    (st.reducedMotion ? 64 : 0) |
    (st.playMode === 'CHALLENGE' ? 128 : 0);
  out.push(sFlags, Math.max(0, QUALITY_TIERS.indexOf(st.qualityTier)));

  const allIds = Object.keys(payload.levelRecords)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  // Full SB1 save codes (`qrCompact = false`) preserve 100% of Infinite/Endless level records
  // (stars, skipped, bestMoves, bestTimeSec); QR-compact mode caps records at 1,500 and recent
  // move/time telemetry at 60 so QR codes stay within ISO/IEC 18004 Version 40 capacity.
  const ids =
    qrCompact && allIds.length > 1500
      ? [...allIds.filter((id) => id <= 300), ...allIds.filter((id) => id > 300).slice(-1200)]
      : allIds;
  const telemetryCutoffIdx = qrCompact ? Math.max(0, ids.length - 60) : 0;
  writeVarint(out, ids.length);
  writeVarint(out, telemetryCutoffIdx);

  let prevId = 0;
  for (let i = 0; i < ids.length; i++) {
    writeVarint(out, ids[i] - prevId);
    prevId = ids[i];
  }
  for (let i = 0; i < ids.length; i += 2) {
    const r0 = payload.levelRecords[ids[i]];
    const n0 =
      ((r0.skipped === undefined ? 1 : 0) << 3) |
      ((r0.skipped === true ? 1 : 0) << 2) |
      (Math.min(3, Math.max(0, Math.floor(r0.stars || 0))) & 3);
    let n1 = 0;
    if (i + 1 < ids.length) {
      const r1 = payload.levelRecords[ids[i + 1]];
      n1 =
        ((r1.skipped === undefined ? 1 : 0) << 3) |
        ((r1.skipped === true ? 1 : 0) << 2) |
        (Math.min(3, Math.max(0, Math.floor(r1.stars || 0))) & 3);
    }
    out.push((n0 << 4) | n1);
  }
  for (let i = telemetryCutoffIdx; i < ids.length; i++) {
    writeVarint(out, Math.max(0, Math.round(payload.levelRecords[ids[i]].bestMoves || 0)));
  }
  for (let i = telemetryCutoffIdx; i < ids.length; i++) {
    const t = Math.max(0, payload.levelRecords[ids[i]].bestTimeSec || 0);
    const tenths = Math.round(t * 10);
    const encodedTime = tenths % 10 === 0 ? Math.round(t) * 2 : tenths * 2 + 1;
    writeVarint(out, encodedTime);
  }

  // Economy v2 trailer (`0xa5`): encodes economyVersion, starReliquaryLevel, and zenCleared level IDs
  const zenIds = ids.filter((id) => payload.levelRecords[id]?.zenCleared === true);
  out.push(0xa5);
  writeVarint(out, payload.economyVersion ?? 2);
  writeVarint(out, payload.starReliquaryLevel ?? 0);
  writeVarint(out, zenIds.length);
  let prevZenId = 0;
  for (const zid of zenIds) {
    writeVarint(out, zid - prevZenId);
    prevZenId = zid;
  }

  packModeSplitTrailer(out, payload, ids, telemetryCutoffIdx, writeVarint);

  return Uint8Array.from(out);
}

function unpackCompactSaveBytes(rawBytes: Uint8Array): SavePayloadV1 {
  if (rawBytes.length < 20 || rawBytes[0] !== 0x02) {
    throw new SaveCodeError('INVALID_SCHEMA', 'Unsupported or corrupted binary save payload.');
  }

  let pos = 1;
  const readByte = (): number => {
    if (pos >= rawBytes.length) {
      throw new SaveCodeError('DECOMPRESSION_FAILED', 'Unexpected end of binary save stream.');
    }
    return rawBytes[pos++];
  };
  const readVarint = (): number => {
    let val = 0;
    let mult = 1;
    while (pos < rawBytes.length) {
      const byte = rawBytes[pos++];
      val += (byte & 0x7f) * mult;
      if ((byte & 0x80) === 0) return val;
      mult *= 128;
      if (mult > Number.MAX_SAFE_INTEGER) {
        throw new SaveCodeError('DECOMPRESSION_FAILED', 'Varint exceeds safe integer range.');
      }
    }
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated varint in binary save stream.');
  };

  const writeSeq = readVarint();
  const updatedAtSec = readVarint();
  const updatedAtMs = readVarint();
  const updatedAt = updatedAtSec * 1000 + updatedAtMs;
  const highestLevelUnlocked = readVarint();
  const currentLevelId = readVarint();
  const coins = readVarint();
  const totalStars = readVarint();
  const winStreak = readVarint();
  const bestWinStreak = readVarint();
  const totalBlocksShredded = readVarint();
  const totalMovesCommitted = readVarint();
  const shredderChestProgress = readVarint();
  const milestoneChestLevel = readVarint();

  const boosters = {
    UNDO: readVarint(),
    HINT: readVarint(),
    HAMMER: readVarint(),
    ROCKET: readVarint(),
    VACUUM: readVarint(),
  };

  const skinCount = readByte();
  const unlockedSkins: SkinId[] = [];
  for (let i = 0; i < skinCount; i++) {
    unlockedSkins.push(SKIN_IDS[readByte()] ?? 'classic_studs');
  }
  const trayCount = readByte();
  const unlockedTrays: TrayId[] = [];
  for (let i = 0; i < trayCount; i++) {
    unlockedTrays.push(TRAY_IDS[readByte()] ?? 'industrial_slate');
  }
  const particleCount = readByte();
  const unlockedParticles: ParticleStyleId[] = [];
  for (let i = 0; i < particleCount; i++) {
    unlockedParticles.push(PARTICLE_IDS[readByte()] ?? 'micro_cubes');
  }

  const equippedSkin = SKIN_IDS[readByte()] ?? 'classic_studs';
  const equippedTray = TRAY_IDS[readByte()] ?? 'industrial_slate';
  const equippedParticle = PARTICLE_IDS[readByte()] ?? 'micro_cubes';

  const sFlags = readByte();
  const qualityTier = QUALITY_TIERS[readByte()] ?? 'AUTO';

  const recordCount = readVarint();
  if (recordCount > MAX_SAVE_LEVEL || recordCount > rawBytes.length - pos) {
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Record count exceeds safe limit.');
  }
  const telemetryCutoffIdx = Math.min(recordCount, readVarint());
  const ids: number[] = [];
  let prevId = 0;
  for (let i = 0; i < recordCount; i++) {
    const delta = readVarint();
    if (delta < 1 || prevId + delta > MAX_SAVE_LEVEL) {
      throw new SaveCodeError('DECOMPRESSION_FAILED', 'Invalid level record ID delta.');
    }
    prevId += delta;
    ids.push(prevId);
  }

  const nibbleByteCount = Math.ceil(recordCount / 2);
  const nibbles: number[] = [];
  for (let i = 0; i < nibbleByteCount; i++) {
    const byte = readByte();
    nibbles.push((byte >>> 4) & 0x0f, byte & 0x0f);
  }

  const movesCol: number[] = [];
  for (let i = telemetryCutoffIdx; i < recordCount; i++) {
    movesCol.push(readVarint());
  }
  const timesCol: number[] = [];
  for (let i = telemetryCutoffIdx; i < recordCount; i++) {
    const rawT = readVarint();
    timesCol.push(rawT % 2 === 1 ? Math.floor(rawT / 2) / 10 : Math.floor(rawT / 2));
  }

  const levelRecords: SavePayloadV1['levelRecords'] = {};
  for (let i = 0; i < recordCount; i++) {
    const nib = nibbles[i] ?? 0;
    const stars = nib & 3;
    const isSkipped = ((nib >>> 2) & 1) === 1;
    const omitSkippedProp = ((nib >>> 3) & 1) === 1;
    const tIdx = i - telemetryCutoffIdx;
    const bestMoves = tIdx >= 0 ? (movesCol[tIdx] ?? 0) : 0;
    const bestTimeSec = tIdx >= 0 ? (timesCol[tIdx] ?? 0) : 0;
    levelRecords[ids[i]] = omitSkippedProp
      ? { stars, bestMoves, bestTimeSec }
      : { stars, bestMoves, bestTimeSec, skipped: isSkipped };
  }

  let economyVersion = 1;
  let starReliquaryLevel = 0;
  if (pos < rawBytes.length && rawBytes[pos] === 0xa5) {
    pos++;
    economyVersion = readVarint();
    starReliquaryLevel = readVarint();
    const zenCount = Math.min(recordCount, readVarint());
    let prevZenId = 0;
    for (let i = 0; i < zenCount; i++) {
      const zDelta = readVarint();
      if (zDelta < 1 || prevZenId + zDelta > MAX_SAVE_LEVEL) {
        throw new SaveCodeError('DECOMPRESSION_FAILED', 'Invalid zenCleared ID delta.');
      }
      prevZenId += zDelta;
      if (levelRecords[prevZenId]) {
        levelRecords[prevZenId].zenCleared = true;
      }
    }
  }

  const modeSplit = unpackModeSplitTrailer(
    rawBytes,
    () => pos,
    (delta) => {
      pos += delta;
    },
    readByte,
    readVarint,
    ids,
    telemetryCutoffIdx,
    levelRecords,
    (msg) => {
      throw new SaveCodeError('DECOMPRESSION_FAILED', msg);
    }
  );

  return validateSavePayloadV1({
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq,
    updatedAt,
    highestLevelUnlocked,
    currentLevelId,
    coins,
    totalStars,
    winStreak,
    bestWinStreak,
    totalBlocksShredded,
    totalMovesCommitted,
    shredderChestProgress,
    milestoneChestLevel,
    starReliquaryLevel,
    economyVersion,
    ...modeSplit,
    boosters,
    unlockedSkins,
    unlockedTrays,
    unlockedParticles,
    equippedSkin,
    equippedTray,
    equippedParticle,
    settings: {
      playMode: (sFlags & 128) !== 0 ? 'CHALLENGE' : (sFlags & 1) !== 0 ? 'ZEN' : 'TIMED',
      sfxEnabled: (sFlags & 2) !== 0,
      musicEnabled: (sFlags & 4) !== 0,
      hapticsEnabled: (sFlags & 8) !== 0,
      colorblindSymbols: (sFlags & 16) !== 0,
      highContrast: (sFlags & 32) !== 0,
      reducedMotion: (sFlags & 64) !== 0,
      qualityTier,
    },
    levelRecords,
  });
}

/**
 * Encodes a `SavePayloadV1` into a compact, checksummed `SB1-<base64url>-<crc32hex8>` save code.
 * Prepends 1-byte Codec Header `0x01` (STOR-01) so decoding is 100% synchronous and deterministic.
 */
export function encodeSaveCode(payload: SavePayloadV1, options?: { qrCompact?: boolean }): string {
  validateSavePayloadV1(payload);
  const rawBytes = packCompactSaveBytes(payload, Boolean(options?.qrCompact));
  const framedBytes = compressLz77(rawBytes);
  const b64Payload = bytesToBase64Url(framedBytes);
  const crcHex = computeCrc32Hex(b64Payload);
  return `SB1-${b64Payload}-${crcHex}`;
}

/**
 * Decodes and verifies a `SB1-<base64url>-<crc32hex8>` save code.
 */
export function decodeSaveCode(rawInput: string): SavePayloadV1 {
  const cleaned = rawInput.trim().replace(/\s+/g, '');
  if (!cleaned) {
    throw new SaveCodeError('EMPTY_CODE', 'Save code is empty.');
  }

  if (!/^SB1-/i.test(cleaned)) {
    throw new SaveCodeError('INVALID_PREFIX', 'Save code must start with "SB1-".');
  }
  const body = cleaned.slice(4);

  const lastSep = body.lastIndexOf('-');
  if (lastSep <= 0 || lastSep >= body.length - 1) {
    throw new SaveCodeError('INVALID_FORMAT', 'Save code is missing its 8-character CRC32 checksum suffix.');
  }

  const b64Payload = body.slice(0, lastSep);
  const providedCrc = body.slice(lastSep + 1).toLowerCase();

  if (!/^[0-9a-f]{8}$/.test(providedCrc)) {
    throw new SaveCodeError('INVALID_FORMAT', 'Save code CRC32 suffix must be 8 hexadecimal characters.');
  }

  const expectedCrc = computeCrc32Hex(b64Payload);
  if (providedCrc !== expectedCrc) {
    throw new SaveCodeError(
      'CHECKSUM_MISMATCH',
      `Save code checksum mismatch (expected ${expectedCrc}, got ${providedCrc}). The code may be mistyped or truncated.`
    );
  }

  const framedBytes = base64UrlToBytes(b64Payload);
  const rawBytes = decompressFramedBytes(framedBytes);
  // SAVE-COMPAT-01: Support both `0x02` compact binary streams and legacy `0x7b` ('{') UTF-8 JSON streams
  if (rawBytes.length > 0 && rawBytes[0] === 0x7b) {
    try {
      const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
      return validateSavePayloadV1(JSON.parse(jsonText) as unknown);
    } catch (err) {
      if (err instanceof SaveCodeError) throw err;
      throw new SaveCodeError('INVALID_SCHEMA', 'Malformed UTF-8 JSON save stream.');
    }
  }
  return unpackCompactSaveBytes(rawBytes);
}
