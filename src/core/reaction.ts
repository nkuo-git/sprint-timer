/**
 * 起跑反應時間偵測（雙手機模式，起跑手機 A 的相機對著起跑線上的跑者）。
 *
 * 做法：在「預備」到鳴槍之間，跑者應該靜止，這段時間的影格差異量當作基準雜訊。
 * 鳴槍前後，當差異量連續 consecutive 格超過「基準平均 + k·標準差」且超過 minEnergy，
 * 就判定動作開始，起動時間取「上一格與第一個超標格之間」以能量做線性內插。
 *
 * 注意：正式比賽的反應時間是起跑器上的「力」感測，比肉眼/相機可見的動作早。
 * 相機量到的反應時間會系統性偏晚（推估 20–50ms），所以搶跑判定門檻可以調整，
 * 而 App 會把這個值標為「參考」。總成績不受影響：成績永遠是 衝線時間 − 鳴槍時間。
 */

export interface MotionConfig {
  k: number;
  consecutive: number;
  /** 絕對下限（平均每像素亮度差），避免基準雜訊極小時誤判 */
  minEnergy: number;
  /** 搶跑門檻（秒），規則為 0.100 */
  falseStartThreshold: number;
  /** 喇叭到跑者耳朵的距離（公尺），用於扣掉聲音傳遞時間 */
  speakerDistanceM: number;
}

export const defaultMotionConfig: MotionConfig = {
  k: 6,
  consecutive: 2,
  minEnergy: 2.5,
  falseStartThreshold: 0.1,
  speakerDistanceM: 1.5,
};

/** 兩張亮度圖在 ROI 內的平均絕對差（可加 'worklet'） */
export function diffEnergy(
  a: Uint8Array,
  b: Uint8Array,
  stride: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  step: number,
): number {
  'worklet';
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += step) {
    const off = y * stride;
    for (let x = x0; x < x1; x += step) {
      const d = a[off + x] - b[off + x];
      sum += d < 0 ? -d : d;
      n++;
    }
  }
  return n ? sum / n : 0;
}

export interface MotionOnset {
  t: number;
  energy: number;
  threshold: number;
}

export class MotionOnsetDetector {
  private baseline: number[] = [];
  private above: { t: number; e: number }[] = [];
  private prev: { t: number; e: number } | null = null;
  onset: MotionOnset | null = null;

  constructor(private cfg: MotionConfig = defaultMotionConfig) {}

  reset() {
    this.baseline = [];
    this.above = [];
    this.prev = null;
    this.onset = null;
  }

  private threshold(): number {
    const b = this.baseline;
    if (b.length < 5) return Infinity;
    const m = b.reduce((x, y) => x + y, 0) / b.length;
    const sd = Math.sqrt(b.reduce((x, y) => x + (y - m) ** 2, 0) / b.length);
    return Math.max(this.cfg.minEnergy, m + this.cfg.k * sd);
  }

  /**
   * 每格呼叫一次。phase = 'still'：預備口令後 ~0.5s 起到鳴槍前，用來建立基準；
   * phase = 'watch'：開始偵測（從預備後就開始，這樣鳴槍前的搶跑也抓得到）。
   */
  push(t: number, energy: number, phase: 'still' | 'watch'): MotionOnset | null {
    if (this.onset) return this.onset;
    if (phase === 'still') {
      this.baseline.push(energy);
      if (this.baseline.length > 240) this.baseline.shift();
      this.prev = { t, e: energy };
      return null;
    }
    const thr = this.threshold();
    if (energy > thr) {
      this.above.push({ t, e: energy });
      if (this.above.length >= this.cfg.consecutive) {
        const first = this.above[0];
        let tOn = first.t;
        if (this.prev && this.prev.e < thr && first.e > this.prev.e) {
          tOn = this.prev.t + ((thr - this.prev.e) / (first.e - this.prev.e)) * (first.t - this.prev.t);
        }
        this.onset = { t: tOn, energy: first.e, threshold: thr };
        return this.onset;
      }
    } else {
      this.above = [];
      this.prev = { t, e: energy };
    }
    return null;
  }
}
