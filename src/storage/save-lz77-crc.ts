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

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
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
