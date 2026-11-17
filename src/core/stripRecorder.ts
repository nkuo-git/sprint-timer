import { grayToPngDataUri } from './png';

/**
 * 終點攝影條（JS 執行緒端）：把引擎送來的 strip 片段接起來。
 * 影像的橫軸是時間（每一欄 = 一格影格），縱軸是沿著終點線的位置（上 = 遠端）。
 * 跑者方向是右→左時，時間軸照樣由左到右（較早的在左邊）。
 */
export class StripRecorder {
  rows = 0;
  /** 每一欄的時間（秒） */
  times: number[] = [];
  private chunks: Uint8Array[] = [];
  private chunkStart: number[] = [];

  reset() {
    this.rows = 0;
    this.times = [];
    this.chunks = [];
    this.chunkStart = [];
  }

  get length(): number {
    return this.times.length;
  }

  append(chunk: { t: number[]; d: number[]; rows: number }) {
    if (this.rows !== 0 && this.rows !== chunk.rows) this.reset();
    this.rows = chunk.rows;
    this.chunkStart.push(this.times.length);
    this.chunks.push(Uint8Array.from(chunk.d));
    for (const t of chunk.t) this.times.push(t);
  }

  /** 時間 → 欄（含小數，線性內插）；範圍外回傳最近的端點 */
  columnAtTime(t: number): number {
    const ts = this.times;
    const n = ts.length;
    if (n === 0) return 0;
    if (t <= ts[0]) return 0;
    if (t >= ts[n - 1]) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    return lo + (t - ts[lo]) / (ts[hi] - ts[lo]);
  }

  /** 欄（可含小數）→ 時間。手動在條上標記跑者時用 */
  timeAtColumn(col: number): number {
    const ts = this.times;
    const n = ts.length;
    if (n === 0) return NaN;
    if (col <= 0) return ts[0];
    if (col >= n - 1) return ts[n - 1];
    const i = Math.floor(col);
    return ts[i] + (col - i) * (ts[i + 1] - ts[i]);
  }

  private column(i: number): Uint8Array {
    let c = this.chunkStart.length - 1;
    while (c > 0 && this.chunkStart[c] > i) c--;
    const off = (i - this.chunkStart[c]) * this.rows;
    return this.chunks[c].subarray(off, off + this.rows);
  }

  /**
   * 取 [fromT, toT] 的影像。colRepeat：每一欄重複幾次（把影像拉寬，跑者才不會被壓扁）。
   * 回傳像素與尺寸；沒有資料回傳 null。
   */
  image(fromT: number, toT: number, colRepeat = 1): { w: number; h: number; data: Uint8Array; firstCol: number; lastCol: number } | null {
    if (this.times.length === 0) return null;
    const a = Math.max(0, Math.floor(this.columnAtTime(fromT)));
    const b = Math.min(this.times.length - 1, Math.ceil(this.columnAtTime(toT)));
    if (b < a) return null;
    const cols = b - a + 1;
    const w = cols * colRepeat;
    const h = this.rows;
    const data = new Uint8Array(w * h);
    for (let c = 0; c < cols; c++) {
      const src = this.column(a + c);
      for (let r = 0; r < h; r++) {
        const v = src[r];
        const o = r * w + c * colRepeat;
        for (let k = 0; k < colRepeat; k++) data[o + k] = v;
      }
    }
    return { w, h, data, firstCol: a, lastCol: b };
  }

  /** 同 image()，直接回傳可給 <Image> 用的 data URI */
  imageUri(fromT: number, toT: number, colRepeat = 1): { uri: string; w: number; h: number; firstCol: number; lastCol: number } | null {
    const img = this.image(fromT, toT, colRepeat);
    if (!img) return null;
    return { uri: grayToPngDataUri(img.w, img.h, img.data), w: img.w, h: img.h, firstCol: img.firstCol, lastCol: img.lastCol };
  }
}
