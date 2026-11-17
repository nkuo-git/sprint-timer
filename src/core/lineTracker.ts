/**
 * 終點線辨識與追蹤（手持用）。
 *
 * 使用者在畫面上點一下跑道上的終點白線，系統：
 *  1. detectLine：在點擊位置附近找「比兩側都亮的細長條」（白線在深色跑道上），
 *     沿著它往上、往下延伸，擬合出一條直線 x(y) = x0 + slope·(y − y0) 與上下端點。
 *  2. trackLine：之後每一格在上一格位置附近重新找線、重新擬合，
 *     所以手晃、慢慢平移都跟得上。跑者遮住線的時候用沒被遮到的部分擬合；
 *     整條被遮住就照原本的移動速度暫時外推，等線重新露出來。
 *
 * 影格必須是已轉正的直向畫面，終點線在畫面中大致是「直的」（允許傾斜約 ±30°）。
 * 所有函式都是純函式 + 純資料狀態，可在 frame processor worklet 中執行。
 */

export interface LineState {
  /** 線在 y = y0 處的 x（px） */
  x0: number;
  /** dx/dy */
  slope: number;
  y0: number;
  /** 線的上端（遠端）與下端（近端）y（px） */
  yTop: number;
  yBot: number;
  /** 找線用的尺度（px），略大於線寬 */
  h: number;
  /** 鎖定時的對比強度，用來判斷之後找到的是不是同一條線 */
  contrast: number;
  /** 線本身的亮度（會慢慢跟著曝光調整）。兩條腿中間露出的跑道也「比兩側亮」，但沒有線那麼亮 */
  level: number;
  locked: boolean;
  /** 連續幾格沒找到線 */
  lostFrames: number;
  /** 上一格擬合用到的列數 */
  inliers: number;
  /** x0 每格的移動量（px/格），遮蔽時外推用 */
  vx: number;
  // 暫存陣列（避免每格配置記憶體）
  sy: Float64Array;
  sx: Float64Array;
  sk: Uint8Array;
  /** 各追蹤列量到的線寬（px）與列編號 */
  sw: Float32Array;
  si: Uint8Array;
  /** 各追蹤列的參考線寬（線完整露出時學到的）。線被身體邊緣蓋住一半時會變窄，那種列不採用 */
  wRef: Float32Array;
}

const TRACK_ROWS = 28;

/** (x, y) 處「比左右 h px 都亮多少」。純白線回傳正值，單純的亮暗邊界回傳 ≤ 0 */
function ridge(luma: Uint8Array, stride: number, x: number, y: number, h: number): number {
  'worklet';
  const o = y * stride + x;
  const a = luma[o - h];
  const b = luma[o + h];
  return luma[o] - (a > b ? a : b);
}

/** 在第 y 列的 [xc−S, xc+S] 找最強的亮條，回傳次像素 x（找不到回傳 NaN）；out[0] = 強度 */
function rowPeak(luma: Uint8Array, stride: number, W: number, y: number, xc: number, S: number, h: number, minLevel: number, out: number[]): number {
  'worklet';
  let lo = Math.round(xc - S);
  let hi = Math.round(xc + S);
  if (lo < h) lo = h;
  if (hi > W - 1 - h) hi = W - 1 - h;
  let best = -1e9;
  let bx = -1;
  for (let x = lo; x <= hi; x++) {
    if (luma[y * stride + x] < minLevel) continue;
    const r = ridge(luma, stride, x, y, h);
    if (r > best) {
      best = r;
      bx = x;
    }
  }
  out[0] = best;
  if (bx < 0 || best <= 0) return NaN;
  out[1] = luma[y * stride + bx];
  // 線有寬度，強度是平頂的：取強度過半的範圍的重心當作線中心
  let sw = 0;
  let sxw = 0;
  let wid = 0;
  const a = bx - h < lo ? lo : bx - h;
  const b = bx + h > hi ? hi : bx + h;
  for (let x = a; x <= b; x++) {
    const r = ridge(luma, stride, x, y, h);
    if (r > best * 0.5) {
      sw += r;
      sxw += r * x;
      wid++;
    }
  }
  out[2] = wid;
  return sw > 0 ? sxw / sw : bx;
}

/**
 * 穩健直線擬合 x = a + b·(y − y0)。keep[i] 標記最後被採用的點。
 * 回傳 [a, b, 採用點數, 採用點的 y 範圍]；點太少回傳 null。
 */
function fitLine(ys: Float64Array, xs: Float64Array, n: number, y0: number, keep: Uint8Array, tol: number, fixedSlope: number): number[] | null {
  'worklet';
  for (let i = 0; i < n; i++) keep[i] = 1;
  let a = 0;
  let b = 0;
  let cnt = 0;
  let yMin = 0;
  let yMax = 0;
  for (let pass = 0; pass < 3; pass++) {
    let sy = 0;
    let sx = 0;
    cnt = 0;
    yMin = 1e9;
    yMax = -1e9;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      sy += ys[i] - y0;
      sx += xs[i];
      cnt++;
      if (ys[i] < yMin) yMin = ys[i];
      if (ys[i] > yMax) yMax = ys[i];
    }
    if (cnt < 2) return null;
    const my = sy / cnt;
    const mx = sx / cnt;
    let syy = 0;
    let syx = 0;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      const dy = ys[i] - y0 - my;
      syy += dy * dy;
      syx += dy * (xs[i] - mx);
    }
    // fixedSlope 不是 NaN 時只估位置（可用的列太集中，斜率不可靠）
    b = fixedSlope === fixedSlope ? fixedSlope : syy > 0 ? syx / syy : 0;
    a = mx - b * my;
    if (pass === 2) break;
    // 剔除離群點（例如找到跑道分道線或跑者的白衣服）
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      const res = xs[i] - (a + b * (ys[i] - y0));
      if (res > tol || res < -tol) {
        keep[i] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return [a, b, cnt, yMax - yMin];
}

/**
 * 使用者點擊 (tapX, tapY)（影格像素座標）後辨識終點線。找不到回傳 null。
 */
export function detectLine(luma: Uint8Array, stride: number, W: number, H: number, tapX: number, tapY: number): LineState | null {
  'worklet';
  const out = [0, 0, 0];
  const R = Math.max(24, Math.round(W * 0.08));
  let y = Math.round(tapY);
  if (y < 3) y = 3;
  if (y > H - 4) y = H - 4;

  // 1. 決定線寬尺度：由小到大試，取「強度已達最大值 85%」的最小尺度
  const scales = [2, 3, 4, 6, 8, 12, 16, 24];
  const resp: number[] = [];
  const pos: number[] = [];
  let maxResp = 0;
  for (let s = 0; s < scales.length; s++) {
    const h = scales[s];
    let best = -1e9;
    let bestRaw = 0;
    let bx = -1;
    const lo = Math.max(h, Math.round(tapX) - R);
    const hi = Math.min(W - 1 - h, Math.round(tapX) + R);
    for (let x = lo; x <= hi; x++) {
      const r = (ridge(luma, stride, x, y - 2, h) + ridge(luma, stride, x, y, h) + ridge(luma, stride, x, y + 2, h)) / 3;
      // 離點擊位置越遠分數越低：使用者點的就是那條線
      const score = r * (1 - (0.5 * Math.abs(x - tapX)) / R);
      if (score > best) {
        best = score;
        bestRaw = r;
        bx = x;
      }
    }
    resp.push(bestRaw);
    pos.push(bx);
    if (bestRaw > maxResp) maxResp = bestRaw;
  }
  if (maxResp < 14) return null; // 點擊處附近沒有夠明顯的白線
  let h = scales[scales.length - 1];
  let xStart = pos[pos.length - 1];
  for (let s = 0; s < scales.length; s++) {
    if (resp[s] >= 0.85 * maxResp) {
      h = scales[s];
      xStart = pos[s];
      break;
    }
  }
  const contrast = maxResp;
  const minR = contrast * 0.4;

  // 2. 從點擊處沿線往上、往下延伸
  const rs = Math.max(2, Math.round(H / 160));
  const maxPts = Math.ceil(H / rs) + 2;
  const ys = new Float64Array(maxPts);
  const xs = new Float64Array(maxPts);
  const keep = new Uint8Array(maxPts);
  let n = 0;
  const x00 = rowPeak(luma, stride, W, y, xStart, h + 2, h, 0, out);
  if (x00 !== x00) return null;
  let level = out[1];
  let levelN = 1;
  const minLevel = level - contrast * 0.5;
  ys[n] = y;
  xs[n] = x00;
  n++;
  const missLimit = 6;
  for (let dir = -1; dir <= 1; dir += 2) {
    let lastX = x00;
    let lastY = y;
    let sl = 0;
    let got = 0;
    let miss = 0;
    for (let yy = y + dir * rs; yy >= 2 && yy <= H - 3 && miss < missLimit && n < maxPts; yy += dir * rs) {
      const pred = lastX + sl * (yy - lastY);
      const xf = rowPeak(luma, stride, W, yy, pred, 2 + h * 0.5 + miss, h, minLevel, out);
      if (xf === xf && out[0] >= minR) {
        level += out[1];
        levelN++;
        const slNew = (xf - lastX) / (yy - lastY);
        got++;
        sl = got <= 2 ? slNew : sl * 0.7 + slNew * 0.3;
        lastX = xf;
        lastY = yy;
        ys[n] = yy;
        xs[n] = xf;
        n++;
        miss = 0;
      } else {
        miss++;
      }
    }
  }
  if (n < 8) return null;
  const fit = fitLine(ys, xs, n, y, keep, 2.5, NaN);
  if (!fit || fit[2] < 8) return null;
  let yTop = 1e9;
  let yBot = -1e9;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    if (ys[i] < yTop) yTop = ys[i];
    if (ys[i] > yBot) yBot = ys[i];
  }
  if (yBot - yTop < H * 0.04) return null;
  return {
    x0: fit[0],
    slope: fit[1],
    y0: y,
    yTop,
    yBot,
    h,
    contrast,
    level: level / levelN,
    locked: true,
    lostFrames: 0,
    inliers: fit[2],
    vx: 0,
    sy: new Float64Array(TRACK_ROWS),
    sx: new Float64Array(TRACK_ROWS),
    sk: new Uint8Array(TRACK_ROWS),
    sw: new Float32Array(TRACK_ROWS),
    si: new Uint8Array(TRACK_ROWS),
    wRef: new Float32Array(TRACK_ROWS),
  };
}

/** 線在第 y 列的 x */
export function lineX(st: LineState, y: number): number {
  'worklet';
  return st.x0 + st.slope * (y - st.y0);
}

/** 線相對於畫面垂直方向的傾斜角（度） */
export function lineTiltDeg(st: LineState): number {
  'worklet';
  return (Math.atan(st.slope) * 180) / Math.PI;
}

/**
 * 每一格呼叫：在上一格位置附近重新找線。回傳這一格是否有實際看到線。
 */
export function trackLine(st: LineState, luma: Uint8Array, stride: number, W: number, H: number): boolean {
  'worklet';
  const out = [0, 0, 0];
  const span = st.yBot - st.yTop;
  let S = Math.max(6, W * 0.014);
  if (st.lostFrames > 0) S *= 1 + Math.min(st.lostFrames, 6) * 0.5;
  const x0p = st.x0 + st.vx;
  const minR = st.contrast * 0.35;
  const minLevel = st.level - st.contrast * 0.5;
  let lev = 0;
  let n = 0;
  for (let i = 0; i < TRACK_ROWS; i++) {
    const y = Math.round(st.yTop + ((i + 0.5) * span) / TRACK_ROWS);
    if (y < 1 || y > H - 2) continue;
    const xc = x0p + st.slope * (y - st.y0);
    const xf = rowPeak(luma, stride, W, y, xc, S, st.h, minLevel, out);
    // 線寬明顯比平常窄 = 被身體邊緣蓋住一部分，量到的中心會偏，不採用
    if (xf === xf && out[0] >= minR && !(st.wRef[i] > 0 && out[2] < st.wRef[i] * 0.72)) {
      st.sy[n] = y;
      st.sx[n] = xf;
      st.sw[n] = out[2];
      st.si[n] = i;
      lev += out[1];
      n++;
    }
  }
  const need = 5;
  let fit: number[] | null = null;
  if (n >= need) {
    fit = fitLine(st.sy, st.sx, n, st.y0, st.sk, 2, NaN);
    // 看得到的部分太短（其他被跑者遮住）時斜率不可靠：沿用舊斜率，只更新位置
    if (fit && fit[3] < span * 0.35) fit = fitLine(st.sy, st.sx, n, st.y0, st.sk, 2, st.slope);
  }
  if (fit && fit[2] >= need) {
    const partial = fit[2] < TRACK_ROWS * 0.6;
    if (partial) {
      // 只看到一部分線（其他被跑者擋住）：這種時候的量測比較不可靠，每格最多修正 1.5px
      const lim = 1.5;
      const d = fit[0] - x0p;
      if (d > lim) fit[0] = x0p + lim;
      else if (d < -lim) fit[0] = x0p - lim;
    } else {
      // 線大致完整：更新各列的參考線寬
      for (let k = 0; k < n; k++) {
        if (!st.sk[k]) continue;
        const i = st.si[k];
        st.wRef[i] = st.wRef[i] > 0 ? st.wRef[i] * 0.9 + st.sw[k] * 0.1 : st.sw[k];
      }
    }
    const dv = fit[0] - st.x0;
    let vx = st.lostFrames > 0 ? 0 : st.vx * 0.5 + dv * 0.5;
    if (vx > S) vx = S;
    if (vx < -S) vx = -S;
    st.vx = vx;
    st.x0 = fit[0];
    st.slope = st.slope * 0.5 + fit[1] * 0.5;
    st.inliers = fit[2];
    st.level = st.level * 0.95 + (lev / n) * 0.05;
    st.locked = true;
    st.lostFrames = 0;
    return true;
  }
  // 沒看到線：照原本的移動速度外推，速度逐格衰減
  st.x0 += st.vx;
  st.vx *= 0.8;
  st.inliers = 0;
  st.lostFrames++;
  if (st.lostFrames > 90) st.locked = false;
  return false;
}
