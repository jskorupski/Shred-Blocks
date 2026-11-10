import type { SavePayloadV1 } from '../core/types';

export const CODEC_HEADER_RAW_UTF8 = 0x00;
export const CODEC_HEADER_LZ77_V1 = 0x01;

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
        const firstByte = input[inPos];
        const secondByte = input[inPos + 1];

        for (let cand = inPos - 1; cand >= winStart; cand--) {
          if (input[cand] !== firstByte || input[cand + 1] !== secondByte) continue;
          let mLen = 2;
          while (mLen < maxMatchLen && input[cand + mLen] === input[inPos + mLen]) {
            mLen++;
          }
          if (mLen > bestLen) {
            bestLen = mLen;
            bestOffset = inPos - cand;
            if (bestLen === maxMatchLen) break;
          }
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
        inPos += bestLen;
      } else {
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
  let v = Math.max(0, Math.floor(value)) >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

/**
 * Packs a validated `SavePayloadV1` into a hybrid JSON-header + binary-column stream (STOR-01 V2).
 * Reduces 300-level campaign saves by ~3.5x-7.5x so QR codes (Version <= 40, 2953 bytes) never overflow.
 */
function packCompactSaveBytes(payload: SavePayloadV1, qrCompact = false): Uint8Array {
  const ids = Object.keys(payload.levelRecords)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  const maxTelemetryEntries = qrCompact ? 60 : 400;
  const telemetryCutoffIdx = Math.max(0, ids.length - maxTelemetryEntries);

  const cols: number[] = [];
  let prevId = 0;
  for (let i = 0; i < ids.length; i++) {
    writeVarint(cols, ids[i] - prevId);
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
    cols.push((n0 << 4) | n1);
  }
  for (let i = telemetryCutoffIdx; i < ids.length; i++) {
    writeVarint(cols, Math.max(0, Math.round(payload.levelRecords[ids[i]].bestMoves || 0)));
  }
  for (let i = telemetryCutoffIdx; i < ids.length; i++) {
    const t = Math.max(0, payload.levelRecords[ids[i]].bestTimeSec || 0);
    const tenths = Math.round(t * 10);
    const encodedTime = tenths % 10 === 0 ? (Math.round(t) << 1) | 0 : (tenths << 1) | 1;
    writeVarint(cols, encodedTime);
  }

  const s = payload.settings;
  const b = payload.boosters;
  const headerJson = JSON.stringify([
    2,
    payload.writeSeq,
    payload.updatedAt,
    payload.highestLevelUnlocked,
    payload.currentLevelId,
    payload.coins,
    payload.totalStars,
    payload.winStreak,
    payload.bestWinStreak,
    payload.totalBlocksShredded,
    payload.totalMovesCommitted,
    payload.shredderChestProgress,
    payload.milestoneChestLevel,
    [b.UNDO || 0, b.FREEZE || 0, b.HAMMER || 0, b.ROCKET || 0, b.VACUUM || 0],
    payload.unlockedSkins,
    payload.unlockedTrays,
    payload.unlockedParticles,
    payload.equippedSkin,
    payload.equippedTray,
    payload.equippedParticle,
    [
      s.playMode === 'ZEN' ? 1 : 0,
      s.sfxEnabled ? 1 : 0,
      s.musicEnabled ? 1 : 0,
      s.hapticsEnabled ? 1 : 0,
      s.colorblindSymbols ? 1 : 0,
      s.highContrast ? 1 : 0,
      s.reducedMotion ? 1 : 0,
      s.qualityTier,
    ],
    ids.length,
    telemetryCutoffIdx,
  ]);
  const headerBytes = new TextEncoder().encode(headerJson);
  const out = new Uint8Array(headerBytes.length + 1 + cols.length);
  out.set(headerBytes, 0);
  out[headerBytes.length] = 0x0a;
  out.set(cols, headerBytes.length + 1);
  return out;
}

function unpackCompactSaveBytes(rawBytes: Uint8Array, nlIdx: number): SavePayloadV1 {
  const headerText = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes.subarray(0, nlIdx));
  const h = JSON.parse(headerText) as unknown[];
  if (!Array.isArray(h) || h[0] !== 2 || h.length < 23) {
    throw new SaveCodeError('INVALID_SCHEMA', 'Malformed V2 compact save header.');
  }

  const cols = rawBytes.subarray(nlIdx + 1);
  let pos = 0;
  const readVarint = (): number => {
    let val = 0;
    let shift = 0;
    while (pos < cols.length) {
      const byte = cols[pos++];
      val |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return val >>> 0;
      shift += 7;
    }
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated varint in compact save columns.');
  };

  const recordCount = Math.max(0, Number(h[21]) || 0);
  const telemetryCutoffIdx = Math.max(0, Math.min(recordCount, Number(h[22]) || 0));
  const ids: number[] = [];
  let prevId = 0;
  for (let i = 0; i < recordCount; i++) {
    prevId += readVarint();
    ids.push(prevId);
  }

  const nibbleByteCount = Math.ceil(recordCount / 2);
  if (pos + nibbleByteCount > cols.length) {
    throw new SaveCodeError('DECOMPRESSION_FAILED', 'Truncated star nibbles in compact save stream.');
  }
  const nibbles: number[] = [];
  for (let i = 0; i < nibbleByteCount; i++) {
    const byte = cols[pos++];
    nibbles.push((byte >>> 4) & 0x0f, byte & 0x0f);
  }

  const movesCol: number[] = [];
  for (let i = telemetryCutoffIdx; i < recordCount; i++) {
    movesCol.push(readVarint());
  }
  const timesCol: number[] = [];
  for (let i = telemetryCutoffIdx; i < recordCount; i++) {
    const rawT = readVarint();
    timesCol.push(rawT & 1 ? (rawT >>> 1) / 10 : rawT >>> 1);
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

  const bArr = (Array.isArray(h[13]) ? h[13] : [3, 3, 2, 1, 1]) as number[];
  const sArr = (Array.isArray(h[20]) ? h[20] : [1, 1, 1, 1, 0, 0, 0, 'AUTO']) as unknown[];

  return validateSavePayloadV1({
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: Number(h[1]),
    updatedAt: Number(h[2]),
    highestLevelUnlocked: Number(h[3]),
    currentLevelId: Number(h[4]),
    coins: Number(h[5]),
    totalStars: Number(h[6]),
    winStreak: Number(h[7]),
    bestWinStreak: Number(h[8]),
    totalBlocksShredded: Number(h[9]),
    totalMovesCommitted: Number(h[10]),
    shredderChestProgress: Number(h[11]),
    milestoneChestLevel: Number(h[12]),
    boosters: {
      UNDO: Number(bArr[0]) || 0,
      FREEZE: Number(bArr[1]) || 0,
      HAMMER: Number(bArr[2]) || 0,
      ROCKET: Number(bArr[3]) || 0,
      VACUUM: Number(bArr[4]) || 0,
    },
    unlockedSkins: h[14] as SavePayloadV1['unlockedSkins'],
    unlockedTrays: h[15] as SavePayloadV1['unlockedTrays'],
    unlockedParticles: h[16] as SavePayloadV1['unlockedParticles'],
    equippedSkin: h[17] as SavePayloadV1['equippedSkin'],
    equippedTray: h[18] as SavePayloadV1['equippedTray'],
    equippedParticle: h[19] as SavePayloadV1['equippedParticle'],
    settings: {
      playMode: Number(sArr[0]) === 1 ? 'ZEN' : 'TIMED',
      sfxEnabled: Boolean(sArr[1]),
      musicEnabled: Boolean(sArr[2]),
      hapticsEnabled: Boolean(sArr[3]),
      colorblindSymbols: Boolean(sArr[4]),
      highContrast: Boolean(sArr[5]),
      reducedMotion: Boolean(sArr[6]),
      qualityTier: (sArr[7] as SavePayloadV1['settings']['qualityTier']) || 'AUTO',
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
 * Decodes and verifies a `SB1-<base64url>-<crc32hex8>` save code (also accepting legacy
 * `SB1:` / `SB0:` / `SB0-` prefixes and whitespace/newlines when pasted).
 */
export function decodeSaveCode(rawInput: string): SavePayloadV1 {
  const cleaned = rawInput.trim().replace(/\s+/g, '');
  if (!cleaned) {
    throw new SaveCodeError('EMPTY_CODE', 'Save code is empty.');
  }

  // Normalize prefix (accept SB1-, SB1:, SB0-, SB0:)
  let body = '';
  if (/^(SB1|SB0)[-:]/i.test(cleaned)) {
    body = cleaned.slice(4);
  } else {
    throw new SaveCodeError('INVALID_PREFIX', 'Save code must start with "SB1-" (or legacy "SB0:").');
  }

  const lastSep = Math.max(body.lastIndexOf('-'), body.lastIndexOf(':'));
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
  const utf8Bytes = decompressFramedBytes(framedBytes);

  if (utf8Bytes.length > 2 && utf8Bytes[0] === 0x5b) {
    const nlIdx = utf8Bytes.indexOf(0x0a);
    if (nlIdx > 0) {
      return unpackCompactSaveBytes(utf8Bytes, nlIdx);
    }
  }

  let parsed: unknown;
  try {
    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SaveCodeError('INVALID_SCHEMA', 'Decompressed save payload is not valid JSON.');
  }

  return validateSavePayloadV1(parsed);
}
