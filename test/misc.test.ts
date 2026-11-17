import { describe, expect, it } from 'vitest';
import { officialTime, soundDelay, speedOfSound } from '../src/core/physics';
import { planStart } from '../src/core/startSequence';
import { MotionOnsetDetector } from '../src/core/reaction';
import { singlePhoneResult, twoPhoneResult } from '../src/core/result';
import { ClockModel } from '../src/core/clockSync';

describe('物理與規則', () => {
  it('20°C 音速 ≈ 343 m/s，100m 延遲 ≈ 0.291s', () => {
    expect(speedOfSound(20)).toBeCloseTo(343.2, 0);
    expect(soundDelay(100)).toBeCloseTo(0.2914, 3);
  });
  it('正式成績無條件進位到 0.01', () => {
    expect(officialTime(10.231)).toBe(10.24);
    expect(officialTime(10.23)).toBe(10.23);
    expect(officialTime(9.5800000001)).toBe(9.58);
  });
  it('預備到鳴槍間隔落在設定區間', () => {
    for (const r of [0, 0.5, 0.999]) {
      const s = planStart(undefined, () => r);
      expect(s.gun - s.set).toBeGreaterThanOrEqual(1.6);
      expect(s.gun - s.set).toBeLessThanOrEqual(2.6);
    }
  });
});

describe('反應時間', () => {
  function feed(onsetAt: number) {
    const d = new MotionOnsetDetector();
    let res = null;
    for (let t = 0; t < 1; t += 1 / 120) d.push(t, 1 + Math.sin(t * 50) * 0.2, 'still');
    for (let t = 1; t < 2; t += 1 / 120) {
      const e = t < onsetAt ? 1 + Math.sin(t * 50) * 0.2 : 1 + (t - onsetAt) * 400;
      res = d.push(t, e, 'watch') ?? res;
    }
    return res;
  }
  it('偵測到動作起點（誤差 < 1 格）', () => {
    const r = feed(1.3)!;
    expect(Math.abs(r.t - 1.3)).toBeLessThan(1 / 120);
  });
  it('雙手機成績與搶跑判定', () => {
    const clock = new ClockModel();
    clock.add({ offset: 100, at: 0, maxRtt: 0.002, used: 10 }); // A = B + 100
    const r = twoPhoneResult({ gunOnA: 1100, crossOnB: 1010.5, clock, frameInterval: 1 / 240, motionOnsetOnA: 1100.08, speakerDistanceM: 0 });
    expect(r.raw).toBeCloseTo(10.5, 9);
    expect(r.reaction).toBeCloseTo(0.08, 9);
    expect(r.falseStart).toBe(true);
  });
  it('單手機聲音模式扣掉聲音傳遞時間', () => {
    const r = singlePhoneResult({ signalAt: 0, crossAt: 11, signal: 'sound', distanceM: 100, frameInterval: 1 / 240 });
    expect(r.raw).toBeCloseTo(11 - 0.2914, 3);
  });
});
