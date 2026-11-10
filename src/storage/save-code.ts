import type { ParticleStyleId, QualityTier, SavePayloadV1, SkinId, TrayId } from '../core/types';

export const CODEC_HEADER_RAW_UTF8 = 0x00;
export const CODEC_HEADER_LZ77_V1 = 0x01;

const SKIN_IDS: ReadonlyArray<SkinId> = [
  'classic_studs',
  'smooth_bevel',
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

export class SaveCodeError extends Error {
  public readonly code:
    | 'EMPTY_CODE'
    | 'INVALID_PREFIX'
    | 'INVALID_FORMAT'
    | 'CHECKSUM_MISMATCH'
    | 'INVALID_BASE64'
    | 'UNSUPPORTED_CODEC'
    | 'DECOMPRESSION_FAILED'
    | 'INVALID_SCHEMA';

  constructor(code: SaveCodeError['code'], message: string) {
    super(message);
    this.name = 'SaveCodeError';
    this.code = code;
  }
}

// Precomputed IEEE 802.3 CRC32 lookup table
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32Bytes(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function computeCrc32Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return crc32Bytes(bytes).toString(16).padStart(8, '0').toLowerCase();
}

/**
 * Synchronous deterministic LZ77 compressor (Codec 0x01).
 * Uses a 4096-byte sliding window and 3..273-byte match lengths grouped into 8-token flag blocks.
 */
export function compressLz77(input: Uint8Array): Uint8Array {
  const len = input.length;
  // Worst case expansion: 5 header bytes + len + ceil(len / 8)
  const out = new Uint8Array(5 + len + Math.ceil(len / 8) + 32);
  out[0] = CODEC_HEADER_LZ77_V1;
  out[1] = (len >>> 24) & 0xff;
  out[2] = (len >>> 16) & 0xff;
  out[3] = (len >>> 8) & 0xff;
  out[4] = len & 0xff;

  const head = new Int32Array(65536).fill(-1);
  const prev = new Int32Array(4096).fill(-1);
  const recordPos = (pos: number): void => {
    if (pos + 1 >= len) return;
    const h = ((input[pos] << 8) | input[pos + 1]) & 0xffff;
    prev[pos & 4095] = head[h];
    head[h] = pos;
  };

  let outPos = 5;
  let inPos = 0;

  while (inPos < len) {
    const flagIndex = outPos++;
    let flags = 0;

    for (let bit = 0; bit < 8 && inPos < len; bit++) {
      const maxMatchLen = Math.min(273, len - inPos);
      let bestOffset = 0;
      let bestLen = 0;

      if (maxMatchLen >= 3) {
        const winStart = Math.max(0, inPos - 4096);
        const h = ((input[inPos] << 8) | input[inPos + 1]) & 0xffff;
        let cand = head[h];
        let chainSteps = 0;

        while (cand >= winStart && chainSteps < 96) {
          chainSteps++;
          if (input[cand + 2] === input[inPos + 2]) {
            let mLen = 3;
            while (mLen < maxMatchLen && input[cand + mLen] === input[inPos + mLen]) {
              mLen++;
            }
            if (mLen > bestLen) {
              bestLen = mLen;
              bestOffset = inPos - cand;
              if (bestLen === maxMatchLen) break;
            }
          }
          const nextCand = prev[cand & 4095];
          if (nextCand >= cand) break;
          cand = nextCand;
        }
      }

      if (bestLen >= 3) {
        flags |= 1 << bit;
        const encodedOffset = bestOffset - 1;
        const baseLen = Math.min(15, bestLen - 3);
        out[outPos++] = (encodedOffset >> 4) & 0xff;
        out[outPos++] = ((encodedOffset & 0x0f) << 4) | (baseLen & 0x0f);
        if (baseLen === 15) {
          out[outPos++] = (bestLen - 18) & 0xff;
        }
        for (let k = 0; k < bestLen; k++) {
          recordPos(inPos + k);
        }
        inPos += bestLen;
      } else {
        recordPos(inPos);
        out[outPos++] = input[inPos++];
      }
    }

    out[flagIndex] = flags;
  }

  return out.subarray(0, outPos);
}

/**
 * Synchronous deterministic LZ77 decompressor (Codec 0x01) + Raw UTF-8 fallback (Codec 0x00).
 */
export function decompressFramedBytes(framed: Uint8Array): Uint8Array {
  if (framed.length < 1) {
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Save payload is empty.');
  }

  const header = framed[0];
  if (header === CODEC_HEADER_RAW_UTF8) {
    return framed.subarray(1);
  }

  if (header !== CODEC_HEADER_LZ77_V1) {
    throw new SaveCodeError(
      'UNSUPPORTED_CODEC',
      `Unsupported save codec header: 0x${header.toString(16).padStart(2, '0')}`
    );
  }

  if (framed.length < 5) {
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated LZ77 header.');
  }

  const uncompressedLen = ((framed[1] << 24) | (framed[2] << 16) | (framed[3] << 8) | framed[4]) >>> 0;

  if (uncompressedLen > 2 * 1024 * 1024) {
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Decompressed payload exceeds safety limit.');
  }

  const out = new Uint8Array(uncompressedLen);
  let outPos = 0;
  let inPos = 5;

  while (outPos < uncompressedLen) {
    if (inPos >= framed.length) {
      throw new SaveCodeError('DECOMPRESSION_FAILED', 'Unexpected end of compressed save stream.');
    }
    const flags = framed[inPos++];

    for (let bit = 0; bit < 8 && outPos < uncompressedLen; bit++) {
      if ((flags & (1 << bit)) === 0) {
        if (inPos >= framed.length) {
          throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated literal byte in save stream.');
        }
        out[outPos++] = framed[inPos++];
      } else {
        if (inPos + 1 >= framed.length) {
          throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated match token in save stream.');
        }
        const b0 = framed[inPos++];
        const b1 = framed[inPos++];
        const offset = ((b0 << 4) | (b1 >> 4)) + 1;
        const baseLen = b1 & 0x0f;
        let length = baseLen + 3;
        if (baseLen === 15) {
          if (inPos >= framed.length) {
            throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated extended match length.');
          }
          length = 18 + framed[inPos++];
        }
        let src = outPos - offset;
        if (src < 0) {
          throw new SaveCodeError('DECOMPRESSION_FAILED', 'Corrupted back-reference offset.');
        }
        for (let k = 0; k < length && outPos < uncompressedLen; k++) {
          out[outPos++] = out[src++];
        }
      }
    }
  }

  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  if (!/^[A-Za-z0-9\-_]+$/.test(b64url)) {
    throw new SaveCodeError('INVALID_BASE64', 'Save code contains invalid base64url characters.');
  }

  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const fullB64 = padded + '='.repeat(padLen);

  try {
    const binary = atob(fullB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new SaveCodeError('INVALID_BASE64', 'Failed to decode base64url save payload.');
  }
}

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

  return obj as SavePayloadV1;
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
  writeVarint(out, b.FREEZE || 0);
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
    (st.reducedMotion ? 64 : 0);
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
    FREEZE: readVarint(),
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
  const telemetryCutoffIdx = Math.min(recordCount, readVarint());
  const ids: number[] = [];
  let prevId = 0;
  for (let i = 0; i < recordCount; i++) {
    prevId += readVarint();
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
    boosters,
    unlockedSkins,
    unlockedTrays,
    unlockedParticles,
    equippedSkin,
    equippedTray,
    equippedParticle,
    settings: {
      playMode: (sFlags & 1) !== 0 ? 'ZEN' : 'TIMED',
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
  return unpackCompactSaveBytes(rawBytes);
}
