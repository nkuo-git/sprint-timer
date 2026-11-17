/**
 * 把灰階像素編成 PNG（不壓縮），給 <Image source={{ uri: grayToPngDataUri(...) }} /> 顯示
 * 終點攝影條與衝線截圖用。純 JS，不需要原生模組。
 */

let crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function put32(buf: Uint8Array, o: number, v: number) {
  buf[o] = (v >>> 24) & 0xff;
  buf[o + 1] = (v >>> 16) & 0xff;
  buf[o + 2] = (v >>> 8) & 0xff;
  buf[o + 3] = v & 0xff;
}

/** 8-bit 灰階 PNG。data 長度 = w*h，由左到右、由上到下 */
export function grayToPng(w: number, h: number, data: ArrayLike<number>): Uint8Array {
  const rawLen = (w + 1) * h; // 每列前面多一個 filter byte
  const blocks = Math.ceil(rawLen / 65535) || 1;
  const zLen = 2 + rawLen + blocks * 5 + 4;
  const total = 8 + (12 + 13) + (12 + zLen) + 12;
  const png = new Uint8Array(total);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let o = 8;
  // IHDR
  put32(png, o, 13);
  png.set([0x49, 0x48, 0x44, 0x52], o + 4);
  put32(png, o + 8, w);
  put32(png, o + 12, h);
  png[o + 16] = 8; // bit depth
  png[o + 17] = 0; // grayscale
  put32(png, o + 21, crc32(png, o + 4, o + 21));
  o += 25;
  // IDAT（zlib stored blocks）
  put32(png, o, zLen);
  png.set([0x49, 0x44, 0x41, 0x54], o + 4);
  let z = o + 8;
  png[z++] = 0x78;
  png[z++] = 0x01;
  let a = 1;
  let b = 0;
  let written = 0;
  let col = 0; // 目前列中的位置：0 = filter byte
  let src = 0;
  for (let blk = 0; blk < blocks; blk++) {
    const len = Math.min(65535, rawLen - written);
    png[z++] = blk === blocks - 1 ? 1 : 0;
    png[z++] = len & 0xff;
    png[z++] = len >>> 8;
    png[z++] = ~len & 0xff;
    png[z++] = (~len >>> 8) & 0xff;
    for (let i = 0; i < len; i++) {
      let v = 0;
      if (col !== 0) {
        v = data[src++] | 0;
        if (v < 0) v = 0;
        if (v > 255) v = 255;
      }
      col = col === w ? 0 : col + 1;
      png[z++] = v;
      a += v;
      if (a >= 65521) a -= 65521;
      b += a;
      if (b >= 65521) b -= 65521;
    }
    written += len;
  }
  put32(png, z, ((b << 16) | a) >>> 0);
  z += 4;
  put32(png, z, crc32(png, o + 4, z));
  o = z + 4;
  // IEND
  put32(png, o, 0);
  png.set([0x49, 0x45, 0x4e, 0x44], o + 4);
  put32(png, o + 8, crc32(png, o + 4, o + 8));
  return png;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const x = bytes[i];
    const y = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const z = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[x >> 2] + B64[((x & 3) << 4) | (y >> 4)];
    s += i + 1 < bytes.length ? B64[((y & 15) << 2) | (z >> 6)] : '=';
    s += i + 2 < bytes.length ? B64[z & 63] : '=';
    if (s.length >= 8192) {
      parts.push(s);
      s = '';
    }
  }
  parts.push(s);
  return parts.join('');
}

export function grayToPngDataUri(w: number, h: number, data: ArrayLike<number>): string {
  return 'data:image/png;base64,' + toBase64(grayToPng(w, h, data));
}
