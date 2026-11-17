import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { grayToPng, toBase64 } from '../src/core/png';

describe('PNG 編碼', () => {
  it('產生可解碼的灰階 PNG（含超過 64KB 的影像）', () => {
    for (const [w, h] of [[3, 2], [400, 300]]) {
      const data = new Uint8Array(w * h).map((_, i) => (i * 7) % 256);
      const png = grayToPng(w, h, data);
      expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const dv = new DataView(png.buffer);
      expect(dv.getUint32(16)).toBe(w);
      expect(dv.getUint32(20)).toBe(h);
      const idatLen = dv.getUint32(33);
      const raw = inflateSync(png.subarray(41, 41 + idatLen)); // 會檢查 Adler-32
      expect(raw.length).toBe((w + 1) * h);
      expect(raw[1]).toBe(data[0]);
      expect(raw[(w + 1) * (h - 1) + w]).toBe(data[w * h - 1]);
    }
  });
  it('base64', () => {
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(toBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(toBase64(new Uint8Array([77]))).toBe('TQ==');
  });
});
