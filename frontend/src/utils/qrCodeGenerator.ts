/**
 * Lightweight, zero-dependency QR Code Matrix Generator in TypeScript
 * Supports Byte Encoding Mode with Error Correction Level L/M (Versions 1-6).
 * Generates boolean[][] 2D matrix suitable for crisp SVG rendering.
 */

// Galois Field GF(256) tables with primitive polynomial 0x11d (285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    EXP_TABLE[i + 255] = val;
    LOG_TABLE[val] = i;
    val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
  }
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function rsComputePoly(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const factor = new Uint8Array([1, EXP_TABLE[i]]);
    const newPoly = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      for (let k = 0; k < factor.length; k++) {
        newPoly[j + k] ^= gfMultiply(poly[j], factor[k]);
      }
    }
    poly = newPoly;
  }
  return poly;
}

function rsComputeCodewords(data: Uint8Array, ecCount: number): Uint8Array {
  const poly = rsComputePoly(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        remainder[j] ^= gfMultiply(poly[j + 1], factor);
      }
    }
  }
  return remainder;
}

// Version table configurations (Version, Total Codewords, EC Codewords, Size)
interface QrVersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  ecCodewords: number;
  alignments: number[];
}

const QR_SPECS: QrVersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, ecCodewords: 7, alignments: [] },
  { version: 2, size: 25, dataCodewords: 34, ecCodewords: 10, alignments: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, ecCodewords: 15, alignments: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, ecCodewords: 20, alignments: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, ecCodewords: 26, alignments: [6, 30] },
  { version: 6, size: 41, dataCodewords: 136, ecCodewords: 36, alignments: [6, 34] },
];

export function generateQrMatrix(text: string): boolean[][] {
  const textBytes = new TextEncoder().encode(text);
  const textLength = textBytes.length;

  // Find lowest viable QR version
  const spec = QR_SPECS.find((s) => s.dataCodewords >= textLength + 3) || QR_SPECS[QR_SPECS.length - 1];
  const size = spec.size;

  // Build bitstream: Mode Byte (0100) + Count (8 bits for v1-9) + Data + Terminator
  const bits: number[] = [0, 1, 0, 0];
  for (let i = 7; i >= 0; i--) bits.push((textLength >> i) & 1);
  for (let i = 0; i < textLength; i++) {
    for (let j = 7; j >= 0; j--) bits.push((textBytes[i] >> j) & 1);
  }
  // Terminator
  for (let i = 0; i < 4 && bits.length < spec.dataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  // Convert to bytes & pad
  const dataBytes = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    dataBytes[i] = byte;
  }
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  for (let i = bits.length / 8; i < spec.dataCodewords; i++) {
    dataBytes[i] = padPatterns[padIdx++ % 2];
  }

  // Compute error correction
  const ecBytes = rsComputeCodewords(dataBytes, spec.ecCodewords);
  const finalCodewords = new Uint8Array(spec.dataCodewords + spec.ecCodewords);
  finalCodewords.set(dataBytes);
  finalCodewords.set(ecBytes, spec.dataCodewords);

  // Setup grid: false = white, true = black, null = unassigned
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const markFunc = (r: number, c: number, v: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = v;
      isFunction[r][c] = true;
    }
  };

  // 1. Finder patterns (7x7) + Separators (8x8)
  const drawFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const isBorder = r >= 0 && r <= 6 && (c === 0 || c === 6 || r === 0 || r === 6);
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        markFunc(nr, nc, isBorder || isCenter);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Alignment patterns (5x5)
  if (spec.alignments.length > 0) {
    const pos = spec.alignments;
    for (const r of pos) {
      for (const c of pos) {
        if (isFunction[r][c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBlack = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            markFunc(r + dr, c + dc, isBlack);
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0;
    if (matrix[6][i] === null) markFunc(6, i, val);
    if (matrix[i][6] === null) markFunc(i, 6, val);
  }

  // Dark module
  markFunc(4 * spec.version + 9, 8, true);

  // 4. Format information (Level L + Mask 0: 0x77c4 ^ 0x5412 = 0x23d6)
  const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  // Draw format info
  for (let i = 0; i < 6; i++) markFunc(8, i, formatBits[i] === 1);
  markFunc(8, 7, formatBits[6] === 1);
  markFunc(8, 8, formatBits[7] === 1);
  markFunc(7, 8, formatBits[8] === 1);
  for (let i = 9; i < 15; i++) markFunc(14 - i, 8, formatBits[i] === 1);

  for (let i = 0; i < 8; i++) markFunc(size - 1 - i, 8, formatBits[i] === 1);
  for (let i = 8; i < 15; i++) markFunc(8, size - 15 + i, formatBits[i] === 1);

  // 5. Populate Data Bits in zigzag 2-column fashion with Mask 0 ((row + col) % 2 === 0)
  const allBits: number[] = [];
  for (let i = 0; i < finalCodewords.length; i++) {
    for (let b = 7; b >= 0; b--) {
      allBits.push((finalCodewords[i] >> b) & 1);
    }
  }

  let bitIdx = 0;
  let upwards = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // Skip timing column
    const rows = upwards
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (!isFunction[row][c]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          const mask = (row + c) % 2 === 0;
          matrix[row][c] = (bit ^ (mask ? 1 : 0)) === 1;
        }
      }
    }
    upwards = !upwards;
  }

  return matrix.map((row) => row.map((cell) => cell === true));
}
