import { describe, expect, it } from 'vitest';
import { FinishLineDetector } from '../src/core/finishLine';
import { emptyFrames, makeRunnerFrames } from './sim';

function run(fps: number, phase: number, dir: 1 | -1 = 1, speed = 1500) {
  const crossT = 10.0;
  const det = new FinishLineDetector(320, 240, { lineX: 160, y0: 80, y1: 160, direction: dir, bandHalfWidth: 70 });
  det.startLearning();
  for (const f of emptyFrames(15)) det.processFrame(f);
  det.arm();
  const frames = makeRunnerFrames({ fps, crossT, lineX: 160, speedPxPerSec: speed, torsoY0: 70, torsoY1: 170, direction: dir, phase, torsoWidth: 60 });
  for (const f of frames) {
    const r = det.processFrame(f);
    if (r) return { err: r.t - crossT, r };
  }
  throw new Error('沒有偵測到衝線');
}

describe('終點線偵測', () => {
  for (const fps of [240, 120, 60]) {
    it(`${fps}fps 次影格內插誤差 < 影格間距的 1/5`, () => {
      let worst = 0;
      for (const phase of [0, 0.13, 0.37, 0.5, 0.71, 0.93]) {
        const { err, r } = run(fps, phase);
        expect(r.method).toBe('interpolated');
        worst = Math.max(worst, Math.abs(err));
      }
      // 240fps → < 0.83ms
      expect(worst).toBeLessThan(1 / fps / 5);
    });
  }

  it('反方向跑也正確', () => {
    const { err } = run(240, 0.4, -1);
    expect(Math.abs(err)).toBeLessThan(0.001);
  });

  it('手臂伸在軀幹前面不會提早觸發', () => {
    // 手臂比軀幹前 25px，速度 1500px/s ⇒ 若被誤判會早 16ms
    const { err } = run(240, 0.2);
    expect(err).toBeGreaterThan(-0.002);
  });

  it('高速＋低 fps 時（進帶就已過線）改用外插，誤差仍 < 1 格', () => {
    const { err, r } = run(60, 0.5, 1, 5000);
    expect(Math.abs(err)).toBeLessThan(1 / 60);
    expect(['interpolated', 'extrapolated']).toContain(r.method);
  });
});
