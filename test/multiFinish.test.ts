import { describe, expect, it } from 'vitest';
import { createEngine, engineArm, engineStep, engineStop, engineTap, type FinishEvent } from '../src/core/multiFinish';
import { StripRecorder } from '../src/core/stripRecorder';
import { makeScene, type Runner, type SceneOpts } from './scene';

type RunnerEv = Extract<FinishEvent, { type: 'runner' }>;

function run(opts: SceneOpts, tapY = 480) {
  const sc = makeScene(opts);
  const eng = createEngine();
  const events: FinishEvent[] = [];
  const f0 = sc.frames[0];
  const ok = engineTap(eng, f0, (sc.lineXAt(tapY) + 6) / sc.W, tapY / sc.H);
  let armedAt = NaN;
  sc.frames.forEach((f, k) => {
    if (k === 5) engineArm(eng);
    for (const e of engineStep(eng, f)) {
      events.push(e);
      if (e.type === 'armed') armedAt = e.t;
    }
  });
  engineStop(eng);
  for (const e of engineStep(eng, sc.frames[sc.frames.length - 1])) events.push(e);
  const runners = (events.filter((e) => e.type === 'runner') as RunnerEv[]).sort((a, b) => a.t - b.t);
  return { ok, events, runners, armedAt, eng, sc };
}

// 速度約為每秒 5 個身高（9 m/s、身高 1.75 m）
const near: Runner = { crossT: 1.2, feetY: 590, height: 330, speed: 1700 };

describe('手持多人終點偵測', () => {
  for (const fps of [240, 120, 60]) {
    it(`${fps}fps 手晃下單人衝線時間誤差 < 0.6 格`, () => {
      let worst = 0;
      for (const phase of [0, 0.37, 0.71]) {
        const { ok, runners, armedAt } = run({
          fps,
          duration: 1.6,
          shakeX: 4,
          shakeY: 3,
          slope: 0.03,
          runners: [{ ...near, crossT: 1.2 + phase / fps }],
        });
        expect(ok).toBe(true);
        expect(armedAt).toBeLessThan(0.7);
        expect(runners.length).toBe(1);
        worst = Math.max(worst, Math.abs(runners[0].t - (1.2 + phase / fps)));
      }
      expect(worst).toBeLessThan(0.6 / fps);
    });
  }

  it('三位跑者（不同跑道、不同時間）各自計時', () => {
    const rs: Runner[] = [
      { crossT: 1.0, feetY: 420, height: 190, speed: 970 },
      { crossT: 1.18, feetY: 590, height: 330, speed: 1700 },
      { crossT: 1.45, feetY: 500, height: 250, speed: 1280 },
    ];
    const { runners, events } = run({ fps: 120, duration: 2.0, shakeX: 4, shakeY: 3, runners: rs });
    expect(runners.length).toBe(3);
    runners.forEach((r, i) => expect(Math.abs(r.t - rs[i].crossT)).toBeLessThan(0.006));
    // 自動判斷方向
    expect(events.find((e) => e.type === 'direction')).toMatchObject({ direction: 1 });
    // 每位都有衝線截圖
    runners.forEach((r) => expect(r.thumb && r.thumb.data.length).toBe(90 * 160));
  });

  it('反方向（右→左）也能自動判斷並計時', () => {
    const { runners, events } = run({ fps: 120, duration: 1.6, shakeX: 3, shakeY: 2, direction: -1, runners: [near] });
    expect(events.find((e) => e.type === 'direction')).toMatchObject({ direction: -1 });
    expect(runners.length).toBe(1);
    expect(Math.abs(runners[0].t - 1.2)).toBeLessThan(0.005);
  });

  it('沒有人通過時，手晃不會產生假的跑者', () => {
    const { runners } = run({ fps: 120, duration: 2.0, shakeX: 6, shakeY: 5, slope: -0.05 });
    expect(runners.length).toBe(0);
  });

  it('終點攝影條：時間軸與影像', () => {
    const { events, runners } = run({ fps: 120, duration: 1.6, shakeX: 3, shakeY: 2, runners: [near] });
    const rec = new StripRecorder();
    for (const e of events) if (e.type === 'strip') rec.append(e);
    expect(rec.length).toBeGreaterThan(100);
    const col = rec.columnAtTime(runners[0].t);
    expect(rec.timeAtColumn(col)).toBeCloseTo(runners[0].t, 6);
    const img = rec.image(runners[0].t - 0.1, runners[0].t + 0.1, 2)!;
    expect(img.h).toBe(160);
    expect(img.data.length).toBe(img.w * img.h);
    // 跑者通過線的那幾欄，軀幹那幾列是暗的；通過前是亮的（白線）
    const r = runners[0];
    const row = Math.round(r.rowLo + (r.rowHi - r.rowLo) * 0.3);
    const cAfter = Math.round((rec.columnAtTime(r.t + 0.02) - img.firstCol) * 2);
    const cBefore = Math.round((rec.columnAtTime(r.t - 0.05) - img.firstCol) * 2);
    expect(img.data[row * img.w + cAfter]).toBeLessThan(80);
    expect(img.data[row * img.w + cBefore]).toBeGreaterThan(150);
  });
});
