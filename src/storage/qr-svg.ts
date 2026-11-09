/**
 * Self-contained, zero-dependency, offline-capable QR Code SVG generator (UX-07).
 * Supports Byte-mode encoding + Reed-Solomon ECC Level L across QR Versions 1..40.
 */

interface QrVersionSpec {
  ecPerBlock: number;
  g1Blocks: number;
  g1DataCw: number;
  g2Blocks: number;
  g2DataCw: number;
}

// ISO/IEC 18004 Table 9 — ECC Level L parameters for Versions 1..40 (1-indexed)
const QR_LEVEL_L_SPECS: ReadonlyArray<QrVersionSpec> = [
  { ecPerBlock: 0, g1Blocks: 0, g1DataCw: 0, g2Blocks: 0, g2DataCw: 0 }, // dummy 0
  { ecPerBlock: 7, g1Blocks: 1, g1DataCw: 19, g2Blocks: 0, g2DataCw: 0 }, // v1
  { ecPerBlock: 10, g1Blocks: 1, g1DataCw: 34, g2Blocks: 0, g2DataCw: 0 }, // v2
  { ecPerBlock: 15, g1Blocks: 1, g1DataCw: 55, g2Blocks: 0, g2DataCw: 0 }, // v3
  { ecPerBlock: 20, g1Blocks: 1, g1DataCw: 80, g2Blocks: 0, g2DataCw: 0 }, // v4
  { ecPerBlock: 26, g1Blocks: 1, g1DataCw: 108, g2Blocks: 0, g2DataCw: 0 }, // v5
  { ecPerBlock: 18, g1Blocks: 2, g1DataCw: 68, g2Blocks: 0, g2DataCw: 0 }, // v6
  { ecPerBlock: 20, g1Blocks: 2, g1DataCw: 78, g2Blocks: 0, g2DataCw: 0 }, // v7
  { ecPerBlock: 24, g1Blocks: 2, g1DataCw: 97, g2Blocks: 0, g2DataCw: 0 }, // v8
  { ecPerBlock: 30, g1Blocks: 2, g1DataCw: 116, g2Blocks: 0, g2DataCw: 0 }, // v9
  { ecPerBlock: 18, g1Blocks: 2, g1DataCw: 68, g2Blocks: 2, g2DataCw: 69 }, // v10
  { ecPerBlock: 20, g1Blocks: 4, g1DataCw: 81, g2Blocks: 0, g2DataCw: 0 }, // v11
  { ecPerBlock: 24, g1Blocks: 2, g1DataCw: 92, g2Blocks: 2, g2DataCw: 93 }, // v12
  { ecPerBlock: 26, g1Blocks: 4, g1DataCw: 107, g2Blocks: 0, g2DataCw: 0 }, // v13
  { ecPerBlock: 30, g1Blocks: 3, g1DataCw: 115, g2Blocks: 1, g2DataCw: 116 }, // v14
  { ecPerBlock: 22, g1Blocks: 5, g1DataCw: 87, g2Blocks: 1, g2DataCw: 88 }, // v15
  { ecPerBlock: 24, g1Blocks: 5, g1DataCw: 98, g2Blocks: 1, g2DataCw: 99 }, // v16
  { ecPerBlock: 28, g1Blocks: 1, g1DataCw: 107, g2Blocks: 5, g2DataCw: 108 }, // v17
  { ecPerBlock: 30, g1Blocks: 5, g1DataCw: 120, g2Blocks: 1, g2DataCw: 121 }, // v18
  { ecPerBlock: 28, g1Blocks: 3, g1DataCw: 113, g2Blocks: 4, g2DataCw: 114 }, // v19
  { ecPerBlock: 28, g1Blocks: 3, g1DataCw: 107, g2Blocks: 5, g2DataCw: 108 }, // v20
  { ecPerBlock: 28, g1Blocks: 4, g1DataCw: 116, g2Blocks: 4, g2DataCw: 117 }, // v21
  { ecPerBlock: 28, g1Blocks: 2, g1DataCw: 111, g2Blocks: 7, g2DataCw: 112 }, // v22
  { ecPerBlock: 30, g1Blocks: 4, g1DataCw: 121, g2Blocks: 5, g2DataCw: 122 }, // v23
  { ecPerBlock: 30, g1Blocks: 6, g1DataCw: 117, g2Blocks: 4, g2DataCw: 118 }, // v24
  { ecPerBlock: 26, g1Blocks: 8, g1DataCw: 106, g2Blocks: 4, g2DataCw: 107 }, // v25
  { ecPerBlock: 28, g1Blocks: 10, g1DataCw: 114, g2Blocks: 2, g2DataCw: 115 }, // v26
  { ecPerBlock: 30, g1Blocks: 8, g1DataCw: 122, g2Blocks: 4, g2DataCw: 123 }, // v27
  { ecPerBlock: 30, g1Blocks: 3, g1DataCw: 117, g2Blocks: 10, g2DataCw: 118 }, // v28
  { ecPerBlock: 30, g1Blocks: 7, g1DataCw: 116, g2Blocks: 7, g2DataCw: 117 }, // v29
  { ecPerBlock: 30, g1Blocks: 5, g1DataCw: 115, g2Blocks: 10, g2DataCw: 116 }, // v30
  { ecPerBlock: 30, g1Blocks: 13, g1DataCw: 115, g2Blocks: 3, g2DataCw: 116 }, // v31
  { ecPerBlock: 30, g1Blocks: 17, g1DataCw: 115, g2Blocks: 0, g2DataCw: 0 }, // v32
  { ecPerBlock: 30, g1Blocks: 17, g1DataCw: 115, g2Blocks: 1, g2DataCw: 116 }, // v33
  { ecPerBlock: 30, g1Blocks: 13, g1DataCw: 115, g2Blocks: 6, g2DataCw: 116 }, // v34
  { ecPerBlock: 30, g1Blocks: 12, g1DataCw: 121, g2Blocks: 7, g2DataCw: 122 }, // v35
  { ecPerBlock: 30, g1Blocks: 6, g1DataCw: 121, g2Blocks: 14, g2DataCw: 122 }, // v36
  { ecPerBlock: 30, g1Blocks: 17, g1DataCw: 122, g2Blocks: 4, g2DataCw: 123 }, // v37
  { ecPerBlock: 30, g1Blocks: 4, g1DataCw: 122, g2Blocks: 18, g2DataCw: 123 }, // v38
  { ecPerBlock: 30, g1Blocks: 20, g1DataCw: 117, g2Blocks: 4, g2DataCw: 118 }, // v39
  { ecPerBlock: 30, g1Blocks: 19, g1DataCw: 118, g2Blocks: 6, g2DataCw: 119 }, // v40
];

// GF(256) log/exp tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomonEc(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = buildGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

// ISO/IEC 18004 Annex E Table E.1 — Alignment Pattern Center Coordinates for Versions 1..40 (1-indexed)
const QR_ALIGNMENT_COORDS: ReadonlyArray<ReadonlyArray<number>> = [
  [], // dummy 0
  [], // v1
  [6, 18], // v2
  [6, 22], // v3
  [6, 26], // v4
  [6, 30], // v5
  [6, 34], // v6
  [6, 22, 38], // v7
  [6, 24, 42], // v8
  [6, 26, 46], // v9
  [6, 28, 50], // v10
  [6, 30, 54], // v11
  [6, 32, 58], // v12
  [6, 34, 62], // v13
  [6, 26, 46, 66], // v14
  [6, 26, 48, 70], // v15
  [6, 26, 50, 74], // v16
  [6, 30, 54, 78], // v17
  [6, 30, 56, 82], // v18
  [6, 30, 58, 86], // v19
  [6, 34, 62, 90], // v20
  [6, 28, 50, 72, 94], // v21
  [6, 26, 50, 74, 98], // v22
  [6, 30, 54, 78, 102], // v23
  [6, 28, 54, 80, 106], // v24
  [6, 32, 58, 84, 110], // v25
  [6, 30, 58, 86, 114], // v26
  [6, 34, 62, 90, 118], // v27
  [6, 26, 50, 74, 98, 122], // v28
  [6, 30, 54, 78, 102, 126], // v29
  [6, 26, 52, 78, 104, 130], // v30
  [6, 30, 56, 82, 108, 134], // v31
  [6, 34, 60, 86, 112, 138], // v32
  [6, 30, 58, 86, 114, 142], // v33
  [6, 34, 62, 90, 118, 146], // v34
  [6, 30, 54, 78, 102, 126, 150], // v35
  [6, 24, 50, 76, 102, 128, 154], // v36
  [6, 28, 54, 80, 106, 132, 158], // v37
  [6, 32, 58, 84, 110, 136, 162], // v38
  [6, 26, 54, 82, 110, 138, 166], // v39
  [6, 30, 58, 86, 114, 142, 170], // v40
];

export function getAlignmentPositions(version: number): number[] {
  if (version < 1 || version >= QR_ALIGNMENT_COORDS.length) return [];
  return [...QR_ALIGNMENT_COORDS[version]];
}

function selectVersion(byteLength: number): number {
  for (let v = 1; v < QR_LEVEL_L_SPECS.length; v++) {
    const spec = QR_LEVEL_L_SPECS[v];
    const totalDataCw = spec.g1Blocks * spec.g1DataCw + spec.g2Blocks * spec.g2DataCw;
    const countBits = v <= 9 ? 8 : 16;
    const neededBits = 4 + countBits + byteLength * 8;
    if (neededBits <= totalDataCw * 8) {
      return v;
    }
  }
  throw new Error(`QR payload of ${byteLength} bytes exceeds Version 40 capacity.`);
}

function encodeDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = QR_LEVEL_L_SPECS[version];
  const totalDataCw = spec.g1Blocks * spec.g1DataCw + spec.g2Blocks * spec.g2DataCw;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  const maxBits = totalDataCw * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataCw = new Uint8Array(totalDataCw);
  const byteCount = bits.length >>> 3;
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    dataCw[i] = b;
  }

  // Pad remaining codewords with alternating 0xEC, 0x11
  let padToggle = true;
  for (let i = byteCount; i < totalDataCw; i++) {
    dataCw[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  // Split into blocks, compute Reed-Solomon EC, and interleave
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.g1Blocks; i++) {
    const blk = dataCw.subarray(offset, offset + spec.g1DataCw);
    offset += spec.g1DataCw;
    dataBlocks.push(blk);
    ecBlocks.push(computeReedSolomonEc(blk, spec.ecPerBlock));
  }
  for (let i = 0; i < spec.g2Blocks; i++) {
    const blk = dataCw.subarray(offset, offset + spec.g2DataCw);
    offset += spec.g2DataCw;
    dataBlocks.push(blk);
    ecBlocks.push(computeReedSolomonEc(blk, spec.ecPerBlock));
  }

  const totalBlocks = dataBlocks.length;
  const totalCw = totalDataCw + totalBlocks * spec.ecPerBlock;
  const finalCw = new Uint8Array(totalCw);
  let outPos = 0;

  const maxDataLen = Math.max(spec.g1DataCw, spec.g2DataCw);
  for (let col = 0; col < maxDataLen; col++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (col < dataBlocks[b].length) {
        finalCw[outPos++] = dataBlocks[b][col];
      }
    }
  }
  for (let col = 0; col < spec.ecPerBlock; col++) {
    for (let b = 0; b < totalBlocks; b++) {
      finalCw[outPos++] = ecBlocks[b][col];
    }
  }

  return finalCw;
}

function computeFormatBits(eclIndicator: number, mask: number): number {
  const data = (eclIndicator << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

export function buildQrMatrix(text: string): { size: number; modules: Uint8Array } {
  const utf8 = new TextEncoder().encode(text);
  const version = selectVersion(utf8.length);
  const size = 17 + version * 4;
  const codewords = encodeDataCodewords(utf8, version);

  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    const idx = r * size + c;
    modules[idx] = dark ? 1 : 0;
    isFunction[idx] = 1;
  };

  // 1. Finder patterns (7x7) + separators
  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // 3. Alignment patterns (5x5)
  const alignCoords = getAlignmentPositions(version);
  for (let i = 0; i < alignCoords.length; i++) {
    for (let j = 0; j < alignCoords.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === alignCoords.length - 1) ||
        (i === alignCoords.length - 1 && j === 0)
      ) {
        continue;
      }
      const cr = alignCoords[i];
      const cc = alignCoords[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  // 4. Reserve Format Info & Dark Module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(8, size - 1 - i, false);
    setFunctionModule(size - 1 - i, 8, false);
  }
  setFunctionModule(size - 8, 8, true); // Dark module

  // 5. Version Info (for version >= 7)
  if (version >= 7) {
    const vBits = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setFunctionModule(a, b, bit);
      setFunctionModule(b, a, bit);
    }
  }

  // 6. Place data + EC bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5; // Skip vertical timing pattern column
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        const idx = r * size + c;
        if (!isFunction[idx]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const cw = codewords[bitIdx >>> 3];
            dark = ((cw >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          modules[idx] = dark ? 1 : 0;
        }
      }
    }
    upward = !upward;
  }

  // 7. Apply mask pattern 0 ((r + c) % 2 === 0) and write Format Information (Level L = 0b01)
  const mask = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      if (!isFunction[idx] && (r + c) % 2 === 0) {
        modules[idx] ^= 1;
      }
    }
  }

  const formatBits = computeFormatBits(0b01, mask);
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) {
    setFunctionModule(size - 1 - i, 8, ((formatBits >>> i) & 1) === 1);
  }
  for (let i = 8; i < 15; i++) {
    setFunctionModule(8, size - 15 + i, ((formatBits >>> i) & 1) === 1);
  }
  setFunctionModule(size - 8, 8, true);

  return { size, modules };
}

/**
 * Generates a crisp, self-contained `<svg>` string for `text` with a 4-module quiet zone.
 */
export function generateQrSvg(text: string): string {
  const { size, modules } = buildQrMatrix(text);
  const quietZone = 4;
  const totalSize = size + quietZone * 2;

  const pathSegments: string[] = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (modules[r * size + c] === 1) {
        let run = 1;
        while (c + run < size && modules[r * size + c + run] === 1) {
          run++;
        }
        const x = c + quietZone;
        const y = r + quietZone;
        pathSegments.push(`M${x} ${y}h${run}v1h-${run}z`);
        c += run;
      } else {
        c++;
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges" role="img" aria-label="ShredBlocks Save QR Code">`,
    `<rect width="${totalSize}" height="${totalSize}" fill="#FFFFFF" rx="2"/>`,
    `<path d="${pathSegments.join('')}" fill="#0F172A"/>`,
    `</svg>`,
  ].join('');
}
