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

/**
 * Encodes a `SavePayloadV1` into a compact, checksummed `SB1-<base64url>-<crc32hex8>` save code.
 * Prepends 1-byte Codec Header `0x01` (STOR-01) so decoding is 100% synchronous and deterministic.
 */
export function encodeSaveCode(payload: SavePayloadV1): string {
  validateSavePayloadV1(payload);
  const json = JSON.stringify(payload);
  const rawBytes = new TextEncoder().encode(json);
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

  let parsed: unknown;
  try {
    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SaveCodeError('INVALID_SCHEMA', 'Decompressed save payload is not valid JSON.');
  }

  return validateSavePayloadV1(parsed);
}
