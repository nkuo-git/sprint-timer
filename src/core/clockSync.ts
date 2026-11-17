/**
 * NTP 式時鐘同步（純邏輯，不依賴任何原生 API）。
 *
 * 所有時間單位：秒（float64）。在手機上用 PrecisionClock.now() 取得，
 * 它和相機影格 timestamp 是同一個時基（iOS host time / Android elapsedRealtime）。
 *
 * 一次 ping 交換：
 *   client 送出時刻 t0（client 時鐘）
 *   server 收到時刻 t1（server 時鐘）
 *   server 回覆時刻 t2（server 時鐘）
 *   client 收到時刻 t3（client 時鐘）
 *
 *   offset = ((t1 - t0) + (t2 - t3)) / 2     // server 時鐘 - client 時鐘
 *   rtt    = (t3 - t0) - (t2 - t1)
 *
 * 誤差上限是 rtt/2（路徑不對稱時）。所以只採用 rtt 最小的那幾筆，
 * 在 Wi-Fi 區網上通常可以做到 1ms 以內。
 */

export interface PingSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface OffsetEstimate {
  /** server 時鐘 - client 時鐘（秒） */
  offset: number;
  /** 估計值所在的 client 時刻（用來做漂移回歸） */
  at: number;
  /** 被採用的樣本中最大的 rtt（秒）。誤差上限 ≈ maxRtt / 2 */
  maxRtt: number;
  /** 被採用的樣本數 */
  used: number;
}

export function sampleOffset(s: PingSample): { offset: number; rtt: number } {
  const offset = (s.t1 - s.t0 + (s.t2 - s.t3)) / 2;
  const rtt = s.t3 - s.t0 - (s.t2 - s.t1);
  return { offset, rtt };
}

function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 從一輪 ping 樣本估計 offset：取 rtt 最小的 keepFraction 比例，再取 offset 中位數。
 */
export function estimateOffset(
  samples: PingSample[],
  keepFraction = 0.2,
  minKeep = 3,
): OffsetEstimate {
  if (samples.length === 0) throw new Error('沒有同步樣本');
  const rows = samples
    .map((s) => ({ ...sampleOffset(s), at: (s.t0 + s.t3) / 2 }))
    .filter((r) => r.rtt >= 0)
    .sort((a, b) => a.rtt - b.rtt);
  if (rows.length === 0) throw new Error('所有樣本 rtt 皆為負，時鐘讀值有誤');
  const keep = Math.min(rows.length, Math.max(minKeep, Math.round(rows.length * keepFraction)));
  const best = rows.slice(0, keep);
  return {
    offset: median(best.map((r) => r.offset)),
    at: median(best.map((r) => r.at)),
    maxRtt: best[best.length - 1].rtt,
    used: best.length,
  };
}

/**
 * 時鐘模型：offset(t) = offset0 + skew * (t - at0)
 * 手機石英振盪器漂移約 ±10–50 ppm，10 分鐘可差到 30ms，
 * 所以要嘛起跑前重新同步，要嘛用多輪結果估計 skew。
 */
export class ClockModel {
  private estimates: OffsetEstimate[] = [];
  /** 只保留最近這段時間（秒）內的估計值做回歸 */
  constructor(private windowSec = 600) {}

  add(e: OffsetEstimate) {
    this.estimates.push(e);
    const latest = e.at;
    this.estimates = this.estimates.filter((x) => latest - x.at <= this.windowSec);
  }

  get ready(): boolean {
    return this.estimates.length > 0;
  }

  /** 線性回歸（以 1/rtt² 加權）求 offset 與 skew */
  private fit(): { offset0: number; at0: number; skew: number } {
    const es = this.estimates;
    if (es.length === 0) throw new Error('時鐘尚未同步');
    const last = es[es.length - 1];
    if (es.length === 1) return { offset0: last.offset, at0: last.at, skew: 0 };
    const w = es.map((e) => 1 / Math.max(e.maxRtt, 1e-4) ** 2);
    const W = w.reduce((a, b) => a + b, 0);
    const mx = es.reduce((a, e, i) => a + w[i] * e.at, 0) / W;
    const my = es.reduce((a, e, i) => a + w[i] * e.offset, 0) / W;
    let sxx = 0;
    let sxy = 0;
    es.forEach((e, i) => {
      sxx += w[i] * (e.at - mx) ** 2;
      sxy += w[i] * (e.at - mx) * (e.offset - my);
    });
    // 時間跨度太短時 skew 不可靠，直接當 0
    const span = es[es.length - 1].at - es[0].at;
    const skew = sxx > 0 && span > 20 ? sxy / sxx : 0;
    // 物理上手機漂移不會超過 ±200ppm，超過代表資料有問題
    const clamped = Math.max(-200e-6, Math.min(200e-6, skew));
    return { offset0: my, at0: mx, skew: clamped };
  }

  /** 在 client 時刻 t 的 offset（server - client） */
  offsetAt(tClient: number): number {
    const f = this.fit();
    return f.offset0 + f.skew * (tClient - f.at0);
  }

  /** server 時刻 → client 時刻 */
  serverToClient(tServer: number): number {
    // tServer = tClient + offset(tClient)，offset 變化極慢，迭代兩次就收斂
    let t = tServer - this.offsetAt(tServer);
    t = tServer - this.offsetAt(t);
    return t;
  }

  /** 最近一次同步的誤差上限估計（秒） */
  get uncertainty(): number {
    const last = this.estimates[this.estimates.length - 1];
    return last ? last.maxRtt / 2 : Infinity;
  }

  get skewPpm(): number {
    return this.ready ? this.fit().skew * 1e6 : 0;
  }
}
