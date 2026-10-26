// Minimal QR code encoder (ISO/IEC 18004): byte mode, error correction level M (falls back to
// L when the data is long), versions 1–40, automatic mask choice. A port of the Android app's
// Qr.java. qrEncode(bytes) returns the module grid as rows of booleans: true = dark.
"use strict";

const QR_ECC_PER_BLOCK = [  // [0] = level L, [1] = level M; per version 1..40 (index 0 unused)
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]];
const QR_NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]];
const QR_FORMAT_ECL = [1, 0];  // format bits for L, M

function qrEncode(data) {
  for (let ecl = 1; ecl >= 0; ecl--) {         // try M first, then L
    for (let ver = 1; ver <= 40; ver++) {
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + data.length * 8 <= qrDataCodewords(ver, ecl) * 8) return qrBuild(data, ver, ecl, ccBits);
    }
  }
  throw new Error("too much data for a QR code: " + data.length + " bytes");
}

function qrBuild(data, ver, ecl, ccBits) {
  const cap = qrDataCodewords(ver, ecl) * 8;
  const bits = [];
  const append = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  append(4, 4);                                // byte mode
  append(data.length, ccBits);
  for (const b of data) append(b, 8);
  append(0, Math.min(4, cap - bits.length));   // terminator
  append(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) append(pad, 8);
  const codewords = new Uint8Array(bits.length / 8);
  bits.forEach((b, i) => { if (b) codewords[i >>> 3] |= 1 << (7 - (i & 7)); });

  const g = new QrGrid(ver);
  g.drawFunctionPatterns();
  g.drawCodewords(qrInterleave(codewords, ver, ecl));
  let best = 0, bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    g.applyMask(m);
    g.drawFormat(QR_FORMAT_ECL[ecl], m);
    const p = g.penalty();
    if (p < bestPenalty) { best = m; bestPenalty = p; }
    g.applyMask(m);                            // undo (XOR)
  }
  g.applyMask(best);
  g.drawFormat(QR_FORMAT_ECL[ecl], best);
  return g.dark;
}

function qrRawModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function qrDataCodewords(ver, ecl) {
  return Math.floor(qrRawModules(ver) / 8) - QR_ECC_PER_BLOCK[ecl][ver] * QR_NUM_BLOCKS[ecl][ver];
}

function qrInterleave(data, ver, ecl) {
  const numBlocks = QR_NUM_BLOCKS[ecl][ver], eccLen = QR_ECC_PER_BLOCK[ecl][ver];
  const raw = Math.floor(qrRawModules(ver) / 8);
  const numShort = numBlocks - raw % numBlocks, shortLen = Math.floor(raw / numBlocks);
  const div = qrRsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const block = new Uint8Array(shortLen + 1);  // short blocks get a dummy byte at datLen
    block.set(dat, 0);
    block.set(qrRsRemainder(dat, div), block.length - eccLen);
    blocks.push(block);
  }
  const out = new Uint8Array(raw);
  let n = 0;
  for (let i = 0; i < blocks[0].length; i++)
    for (let j = 0; j < numBlocks; j++)
      if (i !== shortLen - eccLen || j >= numShort) out[n++] = blocks[j][i];
  return out;
}

function qrRsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = qrGfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = qrGfMul(root, 0x02);
  }
  return result;
}

function qrRsRemainder(data, div) {
  const result = new Uint8Array(div.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) result[i] ^= qrGfMul(div[i], factor);
  }
  return result;
}

function qrGfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

class QrGrid {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array(this.size).fill(false));      // [y][x]
    this.function = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, on) {
    this.dark[y][x] = on;
    this.function[y][x] = true;
  }

  drawFunctionPatterns() {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(size - 4, 3);
    this.finder(3, size - 4);
    const pos = this.alignmentPositions(), n = pos.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (!(i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0)) this.alignment(pos[i], pos[j]);
    this.drawFormat(0, 0);  // reserve the format areas
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = this.ver * 4096 + rem;  // ver << 12 | rem, 18 bits
      for (let i = 0; i < 18; i++) {
        const b = Math.floor(bits / 2 ** i) % 2 === 1;
        const a = size - 11 + i % 3, c = Math.floor(i / 3);
        this.set(a, c, b);
        this.set(c, a, b);
      }
    }
  }

  finder(x, y) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, d !== 2 && d !== 4);
      }
  }

  alignment(x, y) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  alignmentPositions() {
    const ver = this.ver;
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.floor((ver * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
    const result = new Array(numAlign);
    result[0] = 6;
    for (let i = numAlign - 1, pos = this.size - 7; i >= 1; i--, pos -= step) result[i] = pos;
    return result;
  }

  drawFormat(ecl, mask) {
    const size = this.size, data = ecl << 3 | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = (data << 10 | rem) ^ 0x5412;
    const bit = i => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);  // always dark
  }

  drawCodewords(data) {
    const size = this.size;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.function[y][x] && i < data.length * 8) {
            this.dark[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
    }
  }

  applyMask(m) {
    const masks = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
      (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const inv = masks[m];
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (!this.function[y][x] && inv(x, y)) this.dark[y][x] = !this.dark[y][x];
  }

  /** Penalty rules 1, 2 and 4 of the standard (runs, 2x2 blocks, balance). */
  penalty() {
    const size = this.size, dark = this.dark;
    let p = 0;
    for (let pass = 0; pass < 2; pass++)
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b <= size; b++) {
          const same = b < size && (pass === 0 ? dark[a][b] === dark[a][b - 1] : dark[b][a] === dark[b - 1][a]);
          if (same) run++;
          else {
            if (run >= 5) p += run - 2;
            run = 1;
          }
        }
      }
    let darkCount = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (dark[y][x]) darkCount++;
        if (x + 1 < size && y + 1 < size && dark[y][x] === dark[y][x + 1]
            && dark[y][x] === dark[y + 1][x] && dark[y][x] === dark[y + 1][x + 1]) p += 3;
      }
    const total = size * size;
    const k = Math.floor((Math.abs(darkCount * 20 - total * 10) + total - 1) / total) - 1;
    return p + Math.max(0, k) * 10;
  }
}
