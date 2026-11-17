import type { LumaFrame } from '../src/core/finishLine';

/** 產生合成影格：灰色背景 + 雜訊，軀幹是一個實心矩形，手臂是細長條擺動，頭在帶外 */
export function makeRunnerFrames(opts: {
  fps: number;
  width?: number;
  height?: number;
  /** 軀幹前緣通過 lineX 的真實時間（秒） */
  crossT: number;
  lineX: number;
  speedPxPerSec: number;
  torsoWidth?: number;
  torsoY0: number;
  torsoY1: number;
  direction?: 1 | -1;
  noise?: number;
  phase?: number;
  duration?: number;
  armLength?: number;
  seed?: number;
}): LumaFrame[] {
  const W = opts.width ?? 320;
  const H = opts.height ?? 240;
  const dir = opts.direction ?? 1;
  const tw = opts.torsoWidth ?? 40;
  const noise = opts.noise ?? 6;
  const dt = 1 / opts.fps;
  const dur = opts.duration ?? 1.2;
  let seed = opts.seed ?? 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const frames: LumaFrame[] = [];
  const t0 = opts.crossT - dur / 2 + (opts.phase ?? 0) * dt;
  for (let t = t0; t < t0 + dur; t += dt) {
    const luma = new Uint8Array(W * H);
    for (let i = 0; i < luma.length; i++) luma[i] = 110 + Math.round((rnd() - 0.5) * 2 * noise) + ((i % W) % 37 === 0 ? 30 : 0);
    // 前緣位置（px，連續值）
    const front = opts.lineX + dir * (t - opts.crossT) * opts.speedPxPerSec;
    const back = front - dir * tw;
    const lo = Math.min(front, back);
    const hi = Math.max(front, back);
    for (let y = opts.torsoY0; y < opts.torsoY1; y++) {
      for (let x = Math.max(0, Math.floor(lo)); x <= Math.min(W - 1, Math.ceil(hi)); x++) {
        // 部分覆蓋的像素按比例混色（模擬真實感光元件）
        const cover = Math.max(0, Math.min(x + 0.5, hi) - Math.max(x - 0.5, lo));
        if (cover <= 0) continue;
        const v = 30;
        luma[y * W + x] = Math.round(luma[y * W + x] * (1 - cover) + v * cover);
      }
    }
    // 手臂：比軀幹前面 25px、只有 4px 高，用來測試不會被誤判
    const armLen = opts.armLength ?? 25;
    const ay = Math.round((opts.torsoY0 + opts.torsoY1) / 2);
    for (let y = ay; y < ay + 4; y++)
      for (let k = 0; k < armLen; k++) {
        const x = Math.round(front + dir * k);
        if (x >= 0 && x < W) luma[y * W + x] = 20;
      }
    frames.push({ t, width: W, height: H, stride: W, luma });
  }
  return frames;
}

export function emptyFrames(n: number, W = 320, H = 240, seed = 7): LumaFrame[] {
  const out: LumaFrame[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < n; k++) {
    const luma = new Uint8Array(W * H);
    for (let i = 0; i < luma.length; i++) luma[i] = 110 + Math.round((rnd() - 0.5) * 12) + ((i % W) % 37 === 0 ? 30 : 0);
    out.push({ t: -10 + k * 0.01, width: W, height: H, stride: W, luma });
  }
  return out;
}
