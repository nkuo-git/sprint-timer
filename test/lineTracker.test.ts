import { describe, expect, it } from 'vitest';
import { detectLine, lineX, trackLine } from '../src/core/lineTracker';
import { makeScene } from './scene';

describe('終點線辨識與追蹤', () => {
  it('點一下就找到線、端點與傾斜', () => {
    const sc = makeScene({ fps: 60, duration: 0.05, slope: 0.06 });
    const f = sc.frames[0];
    // 點擊位置故意偏 12px
    const st = detectLine(f.luma, f.stride, f.width, f.height, sc.lineXAt(400) + 12, 400)!;
    expect(st).not.toBeNull();
    for (const y of [280, 400, 580]) expect(Math.abs(lineX(st, y) - sc.lineXAt(y))).toBeLessThan(1);
    expect(st.yTop).toBeLessThan(sc.trackTop + 25);
    expect(st.yBot).toBeGreaterThan(sc.trackBot - 25);
    expect(st.slope).toBeCloseTo(0.06, 2);
  });

  it('點在沒有線的地方回傳 null', () => {
    const sc = makeScene({ fps: 60, duration: 0.05 });
    const f = sc.frames[0];
    expect(detectLine(f.luma, f.stride, f.width, f.height, 60, 420)).toBeNull();
  });

  it('手晃時每一格都跟得上（誤差 < 1px）', () => {
    const sc = makeScene({ fps: 120, duration: 1, slope: -0.04, shakeX: 5, shakeY: 4 });
    const f0 = sc.frames[0];
    const st = detectLine(f0.luma, f0.stride, f0.width, f0.height, sc.lineXAt(430), 430)!;
    let worst = 0;
    sc.frames.forEach((f, k) => {
      trackLine(st, f.luma, f.stride, f.width, f.height);
      const { dx, dy } = sc.shift[k];
      // 影格 y=430 對應世界 y=430+dy，線在影格中的 x = 世界 x − dx
      const truth = sc.lineXAt(430 + dy) - dx;
      worst = Math.max(worst, Math.abs(lineX(st, 430) - truth));
    });
    expect(st.locked).toBe(true);
    expect(worst).toBeLessThan(1);
  });

  it('跑者遮住大半條線時仍維持鎖定', () => {
    const sc = makeScene({
      fps: 120,
      duration: 0.6,
      shakeX: 4,
      shakeY: 3,
      runners: [{ crossT: 0.3, feetY: 600, height: 330, speed: 900 }],
    });
    const f0 = sc.frames[0];
    const st = detectLine(f0.luma, f0.stride, f0.width, f0.height, 180, 500)!;
    let worst = 0;
    sc.frames.forEach((f, k) => {
      trackLine(st, f.luma, f.stride, f.width, f.height);
      const { dx, dy } = sc.shift[k];
      worst = Math.max(worst, Math.abs(lineX(st, 430) - (sc.lineXAt(430 + dy) - dx)));
    });
    expect(st.locked).toBe(true);
    expect(worst).toBeLessThan(2.5);
  });
});
