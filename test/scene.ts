import type { LumaFrame } from '../src/core/finishLine';

/**
 * 合成的手持終點場景：側拍跑道，終點白線在畫面中是（略傾斜的）直線，
 * 跑道上有橫向分道線，跑道遠緣以上是雜亂背景。每一格相機有上下左右的手晃位移。
 */
export interface Runner {
  /** 軀幹前緣通過終點線的真實時間（秒） */
  crossT: number;
  /** 腳底的世界 y（越大越靠近相機） */
  feetY: number;
  /** 身高（px） */
  height: number;
  /** px/秒 */
  speed: number;
  luma?: number;
}

export interface SceneOpts {
  W?: number;
  H?: number;
  fps: number;
  duration: number;
  t0?: number;
  lineX?: number;
  /** 終點線斜率 dx/dy */
  slope?: number;
  trackTop?: number;
  trackBot?: number;
  direction?: 1 | -1;
  /** 手晃振幅（px） */
  shakeX?: number;
  shakeY?: number;
  runners?: Runner[];
  seed?: number;
}

export interface Scene {
  frames: LumaFrame[];
  /** 第 k 格相機位移（影格 (x,y) = 世界 (x+dx, y+dy)） */
  shift: { dx: number; dy: number }[];
  lineXAt(worldY: number): number;
  W: number;
  H: number;
  trackTop: number;
  trackBot: number;
}

const MARGIN = 24;

export function makeScene(o: SceneOpts): Scene {
  const W = o.W ?? 360;
  const H = o.H ?? 640;
  const lineX0 = o.lineX ?? 180;
  const slope = o.slope ?? 0;
  const trackTop = o.trackTop ?? 250;
  const trackBot = o.trackBot ?? 610;
  const dir = o.direction ?? 1;
  const yMid = (trackTop + trackBot) / 2;
  const lineXAt = (y: number) => lineX0 + slope * (y - yMid);
  let seed = o.seed ?? 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // 世界影像（比影格大一圈，手晃時才有東西可看）
  const WW = W + 2 * MARGIN;
  const WH = H + 2 * MARGIN;
  const world = new Uint8Array(WW * WH);
  for (let wy = 0; wy < WH; wy++) {
    const y = wy - MARGIN;
    for (let wx = 0; wx < WW; wx++) {
      const x = wx - MARGIN;
      let v: number;
      if (y < trackTop) {
        // 背景：雜亂的方塊
        v = 50 + ((((x >> 4) * 7 + (y >> 4) * 13) % 5) * 22) + (rnd() - 0.5) * 10;
      } else if (y > trackBot) {
        v = 70 + (rnd() - 0.5) * 8;
      } else {
        v = 95 + (rnd() - 0.5) * 10; // 跑道
        if ((y - trackTop) % 45 < 3) v = 215; // 分道線
        const lx = lineXAt(y);
        if (Math.abs(x - lx) <= 2.5) v = 235; // 終點線（寬 5px）
      }
      world[wy * WW + wx] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

  const frames: LumaFrame[] = [];
  const shift: { dx: number; dy: number }[] = [];
  const n = Math.round(o.duration * o.fps);
  const t0 = o.t0 ?? 0;
  const ax = o.shakeX ?? 0;
  const ay = o.shakeY ?? 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + k / o.fps;
    const dx = Math.round(ax * Math.sin(2 * Math.PI * 3.1 * t) + ax * 0.5 * Math.sin(2 * Math.PI * 7.3 * t + 1));
    const dy = Math.round(ay * Math.sin(2 * Math.PI * 2.3 * t + 0.5) + ay * 0.5 * Math.sin(2 * Math.PI * 5.9 * t));
    shift.push({ dx, dy });
    const luma = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const src = (y + dy + MARGIN) * WW + dx + MARGIN;
      luma.set(world.subarray(src, src + W), y * W);
    }
    // 感光雜訊
    for (let i = 0; i < luma.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const nz = ((seed >> 16) & 7) - 3.5;
      const v = luma[i] + nz;
      luma[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    const rect = (wx0: number, wx1: number, wy0: number, wy1: number, val: number) => {
      // 世界座標的矩形（x 可為小數，邊緣像素按覆蓋率混色）
      const lo = Math.min(wx0, wx1) - dx;
      const hi = Math.max(wx0, wx1) - dx;
      for (let y = Math.max(0, Math.round(wy0 - dy)); y < Math.min(H, Math.round(wy1 - dy)); y++) {
        for (let x = Math.max(0, Math.floor(lo)); x <= Math.min(W - 1, Math.ceil(hi)); x++) {
          const cover = Math.max(0, Math.min(x + 0.5, hi) - Math.max(x - 0.5, lo));
          if (cover <= 0) continue;
          const c = Math.min(1, cover);
          luma[y * W + x] = Math.round(luma[y * W + x] * (1 - c) + val * c);
        }
      }
    };
    for (const r of o.runners ?? []) {
      const h = r.height;
      const top = r.feetY - h;
      const val = r.luma ?? 25;
      const torsoMid = top + h * 0.33;
      const front = lineXAt(torsoMid) + dir * (t - r.crossT) * r.speed;
      const tw = h * 0.2;
      rect(front, front - dir * tw, top + h * 0.14, top + h * 0.52, val); // 軀幹
      rect(front - dir * tw * 0.2, front - dir * tw * 0.85, top, top + h * 0.14, val); // 頭（在軀幹前緣後面一點）
      rect(front + dir * h * 0.16, front - dir * tw * 0.5, top + h * 0.3, top + h * 0.35, val); // 手臂（伸在軀幹前面）
      rect(front + dir * h * 0.12, front - dir * tw * 0.3, top + h * 0.52, top + h * 0.75, val); // 前腿大腿
      rect(front + dir * h * 0.2, front + dir * h * 0.08, top + h * 0.75, top + h, val); // 前腿小腿
      rect(front - dir * tw * 0.5, front - dir * tw * 1.6, top + h * 0.52, top + h * 0.95, val); // 後腿
    }
    frames.push({ t, width: W, height: H, stride: W, luma });
  }
  return { frames, shift, lineXAt, W, H, trackTop, trackBot };
}
