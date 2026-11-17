import { describe, expect, it } from 'vitest';
import { ClockModel, estimateOffset, type PingSample } from '../src/core/clockSync';

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** server 時鐘 = client 時鐘 × (1+skew) + offset；網路延遲不對稱且有長尾 */
function simulate(n: number, trueOffset: number, skew: number, start: number, rnd: () => number): PingSample[] {
  const out: PingSample[] = [];
  let t = start;
  const lat = () => 0.002 + (rnd() < 0.2 ? rnd() * 0.08 : rnd() * 0.004); // 2–6ms，20% 機率塞車到 80ms
  for (let i = 0; i < n; i++) {
    t += 0.05;
    const t0 = t;
    const up = lat();
    const down = lat();
    const srv = (c: number) => c * (1 + skew) + trueOffset;
    const t1 = srv(t0 + up);
    const t2 = t1 + 0.0003;
    const t3 = t0 + up + 0.0003 / (1 + skew) + down;
    out.push({ t0, t1, t2, t3 });
  }
  return out;
}

describe('時鐘同步', () => {
  it('Wi-Fi 等級雜訊下 offset 誤差 < 1ms', () => {
    const rnd = seeded(3);
    const est = estimateOffset(simulate(60, 1234.5678, 0, 100, rnd));
    expect(Math.abs(est.offset - 1234.5678)).toBeLessThan(0.001);
  });

  it('多輪同步可估出 30ppm 漂移，最後一次同步後 5 分鐘仍 < 1.5ms', () => {
    const rnd = seeded(9);
    const skew = 30e-6;
    const m = new ClockModel();
    for (let k = 0; k < 6; k++) m.add(estimateOffset(simulate(40, 50, skew, 100 + k * 60, rnd)));
    const tq = 100 + 300 + 300;
    const truth = tq * skew + 50; // srv(t) - t
    expect(Math.abs(m.offsetAt(tq) - truth)).toBeLessThan(0.0015);
    expect(Math.abs(m.skewPpm - 30)).toBeLessThan(5);
  });

  it('serverToClient 是 offset 的反函數', () => {
    const m = new ClockModel();
    m.add({ offset: 5, at: 100, maxRtt: 0.004, used: 10 });
    expect(m.serverToClient(205)).toBeCloseTo(200, 9);
  });
});
