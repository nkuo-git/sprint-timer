/**
 * 手持、多人終點偵測（photo-finish 式）。
 *
 * 每一格沿著「追蹤到的終點線」取一小塊影像（patch）：列 = 沿著線的位置，欄 = 線左右的水平位移。
 * 因為 patch 是跟著線取的，手晃造成的左右位移已經被抵銷；上下位移另外用線兩側的直向亮度
 * 輪廓（跑道分道線是很好的特徵）對齊。所以 patch 等於是一段「穩定過的終點線影像」。
 *
 * 之後的流程：
 *  - 背景：待命前學 0.4 秒，記下每個取樣點亮度的最小/最大值（手晃時的自然變動也學進去）。
 *  - 前景：亮度超出背景範圍的點。
 *  - 終點攝影條（strip）：每格把線上那一欄存下來，橫軸就是時間——和正式比賽的終點攝影相同。
 *  - 跑者：線上的前景在「時間 × 位置」中連成一塊就是一位跑者（blob）。每一列記下身體前緣
 *    通過線的時間（用前後格前緣位置內插到次影格），最後取軀幹高度帶（身高 15%–50%）
 *    各列通過時間的第 25 百分位數，避開伸在前面的手臂。
 *  - 這個時間是自動建議值；介面上可以在終點攝影條上手動調整或補上被擋住的跑者。
 */
import type { LumaFrame } from './finishLine';
import { detectLine, lineTiltDeg, lineX, trackLine, type LineState } from './lineTracker';

export interface MultiConfig {
  /** 沿線取樣點數 */
  rows: number;
  /** 線左右取樣欄數（奇數） */
  cols: number;
  /** 欄間距（px） */
  colStep: number;
  /** 取樣範圍往線的遠端（畫面上方）延伸多少倍線長：近道跑者的上半身會高過跑道遠緣 */
  aboveFactor: number;
  /** 亮度差門檻 */
  diffThreshold: number;
  /** 線上連續幾個取樣點是前景才算數 */
  minRunRows: number;
  /** 跑者最小高度（佔取樣範圍的比例） */
  minBlobFrac: number;
  /** 線上沒有前景超過這麼久，該跑者就算通過完畢（秒） */
  closeGapSec: number;
  /** 跑者方向：+1 左→右，−1 右→左，0 自動判斷 */
  direction: 0 | 1 | -1;
  /** 背景學習時間（秒） */
  learnSec: number;
  /** 終點攝影條每幾格送出一次 */
  stripChunkFrames: number;
  /** 衝線截圖縮小倍率 */
  thumbScale: number;
  /** 超過這麼久還在線上的不是跑者（有人站在線上），丟棄（秒） */
  maxBlobSec: number;
}

export function defaultMultiConfig(): MultiConfig {
  'worklet';
  return {
    rows: 160,
    cols: 33,
    colStep: 3,
    aboveFactor: 1.0,
    diffThreshold: 26,
    minRunRows: 3,
    minBlobFrac: 0.07,
    closeGapSec: 0.012,
    direction: 0,
    learnSec: 0.4,
    stripChunkFrames: 30,
    thumbScale: 4,
    maxBlobSec: 1.5,
  };
}

export interface Thumb {
  w: number;
  h: number;
  /** 灰階像素，長度 w*h */
  data: number[];
  /** 終點線在截圖上端與下端的 x（截圖像素） */
  lineXTop: number;
  lineXBot: number;
  t: number;
}

interface Blob {
  id: number;
  lo: number;
  hi: number;
  startT: number;
  lastT: number;
  frames: number;
  mass: number;
  preT: Float64Array;
  preE: Float64Array;
  postT: Float64Array;
  postE: Float64Array;
  postSat: Uint8Array;
  adv: number[];
  thumb: Thumb | null;
}

export type FinishEvent =
  | {
      type: 'line';
      found: boolean;
      locked: boolean;
      /** 以下皆為 0–1 的畫面座標 */
      xTop: number;
      yTop: number;
      xBot: number;
      yBot: number;
      tiltDeg: number;
      /** 取樣範圍的上緣（0–1） */
      scanTop: number;
    }
  | { type: 'armed'; t: number }
  | { type: 'direction'; direction: 1 | -1 }
  | {
      type: 'runner';
      id: number;
      /** 軀幹通過終點線的時間（秒，本機時鐘） */
      t: number;
      /** 跑者在取樣範圍中的列範圍（對應 strip 的 y） */
      rowLo: number;
      rowHi: number;
      /** 跑者在畫面中的上下範圍（0–1） */
      yTop: number;
      yBot: number;
      speedPxPerSec: number;
      frameInterval: number;
      /** 用來估計的軀幹列數 */
      rowsUsed: number;
      thumb: Thumb | null;
    }
  | {
      type: 'strip';
      /** 每一欄（影格）的時間 */
      t: number[];
      /** 灰階像素，一格接一格，每格 rows 個（由上到下） */
      d: number[];
      rows: number;
    };

export type EnginePhase = 'idle' | 'aim' | 'learning' | 'armed';

export interface EngineState {
  cfg: MultiConfig;
  phase: EnginePhase;
  line: LineState | null;
  W: number;
  H: number;
  // patch 幾何（待命/瞄準時由線的端點決定）
  N: number;
  M: number;
  mid: number;
  yA: number;
  pitch: number;
  yTop0: number;
  yBot0: number;
  /** 上下位移（px），相對於點擊當下 */
  dy: number;
  lineHalfCols: number;
  // 直向輪廓（上下對齊用）
  profN: number;
  profRef: Float32Array;
  // 背景範圍、目前值、前景
  mn: Float32Array;
  mx: Float32Array;
  cur: Float32Array;
  fg: Uint8Array;
  rowOk: Uint8Array;
  cRow: Uint8Array;
  eRow: Float64Array;
  satRow: Uint8Array;
  prevE: Float64Array;
  prevT: number;
  dt: number;
  bright: number;
  learnStart: number;
  learnCount: number;
  dir: 0 | 1 | -1;
  blobs: Blob[];
  nextId: number;
  stripT: number[];
  stripD: number[];
  lastTel: number;
  out: FinishEvent[];
}

export function createEngine(cfg: Partial<MultiConfig> = {}): EngineState {
  'worklet';
  const d = defaultMultiConfig();
  const c: MultiConfig = { ...d, ...cfg };
  if (c.cols % 2 === 0) c.cols += 1;
  const N = c.rows;
  const M = c.cols;
  return {
    cfg: c,
    phase: 'idle',
    line: null,
    W: 0,
    H: 0,
    N,
    M,
    mid: (M - 1) / 2,
    yA: 0,
    pitch: 1,
    yTop0: 0,
    yBot0: 0,
    dy: 0,
    lineHalfCols: 1,
    profN: 0,
    profRef: new Float32Array(0),
    mn: new Float32Array(N * M),
    mx: new Float32Array(N * M),
    cur: new Float32Array(N * M),
    fg: new Uint8Array(N * M),
    rowOk: new Uint8Array(N),
    cRow: new Uint8Array(N),
    eRow: new Float64Array(N),
    satRow: new Uint8Array(N),
    prevE: new Float64Array(N),
    prevT: NaN,
    dt: NaN,
    bright: 0,
    learnStart: NaN,
    learnCount: 0,
    dir: c.direction,
    blobs: [],
    nextId: 1,
    stripT: [],
    stripD: [],
    lastTel: -1,
    out: [],
  };
}

function lineEvent(eng: EngineState, found: boolean): FinishEvent {
  'worklet';
  const l = eng.line;
  if (!l) return { type: 'line', found: false, locked: false, xTop: 0, yTop: 0, xBot: 0, yBot: 0, tiltDeg: 0, scanTop: 0 };
  return {
    type: 'line',
    found,
    locked: l.locked,
    xTop: lineX(l, l.yTop) / eng.W,
    yTop: l.yTop / eng.H,
    xBot: lineX(l, l.yBot) / eng.W,
    yBot: l.yBot / eng.H,
    tiltDeg: lineTiltDeg(l),
    scanTop: Math.max(0, eng.yA + eng.dy) / eng.H,
  };
}

const REG_R = 4;

/**
 * 取上下對齊用的直向輪廓：線左右兩側各一欄，每 px 一點。
 * 第 i 點對應 y = yA + i − pad + dyInt。
 */
function sampleProfile(eng: EngineState, luma: Uint8Array, stride: number, dyInt: number, pad: number, out: Float32Array): void {
  'worklet';
  const l = eng.line!;
  const off = eng.mid * eng.cfg.colStep;
  const P = eng.profN + 2 * pad;
  const W = eng.W;
  const H = eng.H;
  const y0 = Math.round(eng.yA) - pad + dyInt;
  for (let i = 0; i < P; i++) {
    const y = y0 + i;
    if (y < 0 || y >= H) {
      out[i] = -1;
      out[P + i] = -1;
      continue;
    }
    const xl = l.x0 + l.slope * (y - l.y0);
    const xa = Math.round(xl - off);
    const xb = Math.round(xl + off);
    out[i] = xa >= 0 && xa < W ? luma[y * stride + xa] : -1;
    out[P + i] = xb >= 0 && xb < W ? luma[y * stride + xb] : -1;
  }
}

/** 設定 patch 幾何（點擊辨識到線之後） */
function setupGeometry(eng: EngineState, luma: Uint8Array, stride: number): void {
  'worklet';
  const l = eng.line!;
  const span = l.yBot - l.yTop;
  const top = Math.max(0, l.yTop - span * eng.cfg.aboveFactor);
  const bot = Math.min(eng.H - 2, l.yBot + span * 0.04);
  eng.yA = top;
  eng.pitch = (bot - top) / (eng.N - 1);
  eng.yTop0 = l.yTop;
  eng.yBot0 = l.yBot;
  eng.dy = 0;
  eng.lineHalfCols = Math.max(1, Math.ceil((l.h * 0.5 + 1) / eng.cfg.colStep));
  eng.profN = Math.max(8, Math.floor(bot - top));
  eng.profRef = new Float32Array(eng.profN * 2);
  sampleProfile(eng, luma, stride, 0, 0, eng.profRef);
}

/**
 * 估計這一格相對於點擊當下的上下位移，更新 eng.dy。
 * 在上一格的位移附近 ±REG_R px 逐一比對（差異有上限，被跑者擋住的點影響有限），再用拋物線取次像素。
 */
function registerVertical(eng: EngineState, luma: Uint8Array, stride: number): void {
  'worklet';
  const P = eng.profN;
  const R = REG_R;
  const PW = P + 2 * R;
  const ref = eng.profRef;
  const g = globalThis as any;
  let cur: Float32Array = g.__mfProf;
  if (!cur || cur.length !== PW * 2) {
    cur = new Float32Array(PW * 2);
    g.__mfProf = cur;
  }
  const dyInt = Math.round(eng.dy);
  sampleProfile(eng, luma, stride, dyInt, R, cur);
  let best = 1e18;
  let bestS = 0;
  let worst = 0;
  const sad: number[] = [];
  for (let s = -R; s <= R; s++) {
    let sum = 0;
    let cnt = 0;
    for (let c = 0; c < 2; c++) {
      const ro = c * P;
      const co = c * PW + R + s;
      for (let i = 0; i < P; i += 2) {
        const r = ref[ro + i];
        const v = cur[co + i];
        if (r < 0 || v < 0) continue;
        let d = v - r;
        if (d < 0) d = -d;
        sum += d > 45 ? 45 : d;
        cnt++;
      }
    }
    const m = cnt > P * 0.3 ? sum / cnt : 1e9;
    sad.push(m);
    if (m < best) {
      best = m;
      bestS = s;
    }
    if (m > worst && m < 1e8) worst = m;
  }
  // 沒有特徵（整片均勻）時各位移的差異都一樣：維持原值
  if (best < 1e8 && worst - best > 1.5) {
    let sub = 0;
    const k = bestS + R;
    if (k > 0 && k < 2 * R && sad[k - 1] < 1e8 && sad[k + 1] < 1e8) {
      const den = sad[k - 1] - 2 * sad[k] + sad[k + 1];
      if (den > 1e-6) sub = (0.5 * (sad[k - 1] - sad[k + 1])) / den;
    }
    eng.dy = dyInt + bestS + sub;
  }
  const l = eng.line!;
  l.yTop = eng.yTop0 + eng.dy;
  l.yBot = eng.yBot0 + eng.dy;
}

/** 沿線取 patch 到 eng.cur */
function samplePatch(eng: EngineState, luma: Uint8Array, stride: number): void {
  'worklet';
  const l = eng.line!;
  const N = eng.N;
  const M = eng.M;
  const mid = eng.mid;
  const step = eng.cfg.colStep;
  const W = eng.W;
  const H = eng.H;
  const dyInt = Math.round(eng.dy);
  for (let i = 0; i < N; i++) {
    const y = Math.round(eng.yA + i * eng.pitch) + dyInt;
    const xl = l.x0 + l.slope * (y - l.y0);
    const xa = Math.round(xl - mid * step);
    if (y < 0 || y >= H - 1 || xa < 0 || xa + (M - 1) * step >= W) {
      eng.rowOk[i] = 0;
      continue;
    }
    eng.rowOk[i] = 1;
    const o = y * stride + xa;
    const o2 = o + stride;
    const p = i * M;
    for (let j = 0; j < M; j++) {
      const k = j * step;
      eng.cur[p + j] = (luma[o + k] + luma[o2 + k]) * 0.5;
    }
  }
}

/**
 * 背景範圍往左右各放寬一欄：線被跑者整條擋住的那幾格，線的位置是外推的，
 * 會有 1–3px 誤差，背景紋理的邊緣不能因此被當成前景。
 * 線本身那幾欄不放寬（否則白線旁邊的跑道會被併進白線的範圍）。
 */
function dilateBackground(eng: EngineState): void {
  'worklet';
  const N = eng.N;
  const M = eng.M;
  const zl = eng.mid - eng.lineHalfCols;
  const zr = eng.mid + eng.lineHalfCols;
  const a = new Float32Array(M);
  const b = new Float32Array(M);
  for (let i = 0; i < N; i++) {
    const p = i * M;
    for (let j = 0; j < M; j++) {
      a[j] = eng.mn[p + j];
      b[j] = eng.mx[p + j];
    }
    for (let j = 0; j < M; j++) {
      if (j >= zl && j <= zr) continue;
      for (let d = -1; d <= 1; d += 2) {
        const k = j + d;
        if (k < 0 || k >= M || (k >= zl && k <= zr)) continue;
        if (a[k] < eng.mn[p + j]) eng.mn[p + j] = a[k];
        if (b[k] > eng.mx[p + j]) eng.mx[p + j] = b[k];
      }
    }
  }
}

function median(a: number[]): number {
  'worklet';
  if (a.length === 0) return NaN;
  const s = a.slice().sort((p, q) => p - q);
  return s[s.length >> 1];
}

function newBlob(eng: EngineState, t: number): Blob {
  'worklet';
  const N = eng.N;
  const b: Blob = {
    id: eng.nextId++,
    lo: N,
    hi: -1,
    startT: t,
    lastT: NaN,
    frames: 0,
    mass: 0,
    preT: new Float64Array(N),
    preE: new Float64Array(N),
    postT: new Float64Array(N),
    postE: new Float64Array(N),
    postSat: new Uint8Array(N),
    adv: [],
    thumb: null,
  };
  for (let i = 0; i < N; i++) {
    b.preT[i] = NaN;
    b.postT[i] = NaN;
  }
  return b;
}

function mergeBlobs(a: Blob, b: Blob, N: number): void {
  'worklet';
  for (let r = 0; r < N; r++) {
    const q = b.postT[r];
    if (q === q && !(a.postT[r] <= q)) {
      a.postT[r] = q;
      a.postE[r] = b.postE[r];
      a.postSat[r] = b.postSat[r];
      a.preT[r] = b.preT[r];
      a.preE[r] = b.preE[r];
    }
  }
  if (b.lo < a.lo) a.lo = b.lo;
  if (b.hi > a.hi) a.hi = b.hi;
  if (b.startT < a.startT) a.startT = b.startT;
  if (b.lastT > a.lastT) a.lastT = b.lastT;
  a.frames = Math.max(a.frames, b.frames);
  a.mass += b.mass;
  for (let i = 0; i < b.adv.length; i++) a.adv.push(b.adv[i]);
  if (!a.thumb) a.thumb = b.thumb;
}

function takeThumb(eng: EngineState, luma: Uint8Array, stride: number, t: number): Thumb {
  'worklet';
  const s = eng.cfg.thumbScale;
  const w = Math.floor(eng.W / s);
  const h = Math.floor(eng.H / s);
  const data: number[] = new Array(w * h);
  let k = 0;
  for (let y = 0; y < h; y++) {
    const o = y * s * stride;
    for (let x = 0; x < w; x++) data[k++] = luma[o + x * s];
  }
  const l = eng.line!;
  return { w, h, data, lineXTop: lineX(l, 0) / s, lineXBot: lineX(l, eng.H - 1) / s, t };
}

/** 某一列身體前緣通過終點線的時間（次影格） */
function rowTime(b: Blob, r: number, v: number, dt: number): number {
  'worklet';
  const q = b.postT[r];
  if (q !== q) return NaN;
  const p = b.preT[r];
  const sat = b.postSat[r] === 1;
  if (p === p && !sat) {
    // 過線前、後各有一個前緣位置：線性內插
    const e0 = b.preE[r];
    const e1 = b.postE[r];
    return p + ((0 - e0) / (e1 - e0)) * (q - p);
  }
  if (p === p && v > 0) {
    const tt = p - b.preE[r] / v;
    return tt > q ? q : tt;
  }
  if (!sat && v > 0) {
    const tt = q - b.postE[r] / v;
    return tt < q - dt ? q - dt : tt;
  }
  return q - dt / 2;
}

function finalizeBlob(eng: EngineState, b: Blob): void {
  'worklet';
  const N = eng.N;
  const hgt = b.hi - b.lo + 1;
  const minRows = Math.max(4, Math.round(N * eng.cfg.minBlobFrac));
  if (hgt < minRows || b.mass < minRows * 1.5) return;
  if (b.lastT - b.startT > eng.cfg.maxBlobSec) return;
  const dt = eng.dt === eng.dt ? eng.dt : 0;
  const v = median(b.adv);
  // 軀幹高度帶：身高的 15%–50%（頭約佔上面 13%，腰約在一半）
  const ta = b.lo + Math.floor(hgt * 0.15);
  const tb = b.lo + Math.ceil(hgt * 0.5);
  let times: number[] = [];
  for (let r = ta; r <= tb; r++) {
    const tt = rowTime(b, r, v, dt);
    if (tt === tt) times.push(tt);
  }
  if (times.length < 3) {
    times = [];
    for (let r = b.lo; r <= b.hi; r++) {
      const tt = rowTime(b, r, v, dt);
      if (tt === tt) times.push(tt);
    }
  }
  if (times.length === 0) return;
  times.sort((p, q) => p - q);
  // 第 25 百分位數：比軀幹早的少數幾列是伸在前面的手臂
  const t = times[Math.floor((times.length - 1) * 0.25)];
  const yPx = (r: number) => eng.yA + r * eng.pitch + eng.dy;
  eng.out.push({
    type: 'runner',
    id: b.id,
    t,
    rowLo: b.lo,
    rowHi: b.hi,
    yTop: yPx(b.lo) / eng.H,
    yBot: yPx(b.hi) / eng.H,
    speedPxPerSec: v === v ? v : 0,
    frameInterval: dt,
    rowsUsed: times.length,
    thumb: b.thumb,
  });
}

function flushStrip(eng: EngineState): void {
  'worklet';
  if (eng.stripT.length === 0) return;
  eng.out.push({ type: 'strip', t: eng.stripT, d: eng.stripD, rows: eng.N });
  eng.stripT = [];
  eng.stripD = [];
}

/** 使用者點擊畫面（nx, ny 為 0–1 畫面座標）。下一格 engineStep 會用這一格影像辨識。 */
export function engineTap(eng: EngineState, f: LumaFrame, nx: number, ny: number): boolean {
  'worklet';
  eng.W = f.width;
  eng.H = f.height;
  const l = detectLine(f.luma, f.stride, f.width, f.height, nx * f.width, ny * f.height);
  if (!l) {
    eng.line = null;
    eng.phase = 'idle';
    eng.out.push(lineEvent(eng, false));
    return false;
  }
  eng.line = l;
  eng.phase = 'aim';
  eng.blobs = [];
  setupGeometry(eng, f.luma, f.stride);
  eng.out.push(lineEvent(eng, true));
  return true;
}

/** 開始學背景，學完自動進入待命（會送出 'armed' 事件）。需要先鎖定終點線。 */
export function engineArm(eng: EngineState): boolean {
  'worklet';
  if (!eng.line || !eng.line.locked) return false;
  flushStrip(eng);
  eng.phase = 'learning';
  eng.learnStart = NaN;
  eng.learnCount = 0;
  eng.blobs = [];
  eng.dir = eng.cfg.direction;
  eng.bright = 0;
  for (let i = 0; i < eng.N; i++) eng.prevE[i] = NaN;
  return true;
}

/** 停止記錄（保留終點線鎖定），把還沒送出的資料送出 */
export function engineStop(eng: EngineState): void {
  'worklet';
  if (eng.phase === 'armed') {
    for (let i = 0; i < eng.blobs.length; i++) finalizeBlob(eng, eng.blobs[i]);
    eng.blobs = [];
    flushStrip(eng);
  }
  if (eng.line) eng.phase = 'aim';
}

/**
 * 每一格呼叫一次。回傳這一格產生的事件（可能是空陣列）。
 */
export function engineStep(eng: EngineState, f: LumaFrame): FinishEvent[] {
  'worklet';
  const out = eng.out;
  eng.out = [];
  eng.W = f.width;
  eng.H = f.height;
  const t = f.t;
  if (eng.prevT === eng.prevT) {
    const d = t - eng.prevT;
    if (d > 0) eng.dt = eng.dt === eng.dt ? eng.dt * 0.9 + d * 0.1 : d;
  }
  const l = eng.line;
  if (!l || eng.phase === 'idle') {
    eng.prevT = t;
    return out;
  }
  const luma = f.luma;
  const stride = f.stride;
  const wasLocked = l.locked;
  trackLine(l, luma, stride, f.width, f.height);
  registerVertical(eng, luma, stride);
  eng.out = out;
  if (t - eng.lastTel >= 0.1 || l.locked !== wasLocked) {
    eng.lastTel = t;
    out.push(lineEvent(eng, true));
  }
  if (eng.phase === 'aim') {
    eng.prevT = t;
    eng.out = [];
    return out;
  }

  samplePatch(eng, luma, stride);
  const N = eng.N;
  const M = eng.M;
  const mid = eng.mid;
  const cur = eng.cur;
  const mn = eng.mn;
  const mx = eng.mx;

  if (eng.phase === 'learning') {
    if (eng.learnStart !== eng.learnStart) eng.learnStart = t;
    const first = eng.learnCount === 0;
    for (let i = 0; i < N; i++) {
      if (!eng.rowOk[i]) continue;
      const p = i * M;
      for (let j = 0; j < M; j++) {
        const v = cur[p + j];
        if (first || v < mn[p + j]) mn[p + j] = v;
        if (first || v > mx[p + j]) mx[p + j] = v;
      }
    }
    eng.learnCount++;
    if (t - eng.learnStart >= eng.cfg.learnSec && eng.learnCount >= 8) {
      dilateBackground(eng);
      eng.phase = 'armed';
      out.push({ type: 'armed', t });
    }
    eng.prevT = t;
    eng.out = [];
    return out;
  }

  // ---- armed：前景 ----
  const thr = eng.cfg.diffThreshold;
  const fg = eng.fg;
  const br = eng.bright;
  let bsum = 0;
  let bcnt = 0;
  for (let i = 0; i < N; i++) {
    const p = i * M;
    if (!eng.rowOk[i]) {
      for (let j = 0; j < M; j++) fg[p + j] = 0;
      continue;
    }
    for (let j = 0; j < M; j++) {
      const v = cur[p + j] - br;
      const lo = mn[p + j];
      const hi = mx[p + j];
      if (v > hi + thr || v < lo - thr) {
        fg[p + j] = 1;
      } else {
        fg[p + j] = 0;
        // 背景範圍：超出就立刻放寬，否則慢慢收窄，跟上光線變化
        if (v < lo) mn[p + j] = v;
        else mn[p + j] = lo + (v - lo) * 0.002;
        if (v > hi) mx[p + j] = v;
        else mx[p + j] = hi + (v - hi) * 0.002;
        bsum += cur[p + j] - (lo + hi) * 0.5;
        bcnt++;
      }
    }
  }
  // 整體亮度偏移（自動曝光在跑者經過時會變）
  if (bcnt > N * M * 0.3) eng.bright = eng.bright * 0.8 + (bsum / bcnt) * 0.2;

  // 白衣服蓋在白線上看不出差異：線兩側都是前景時，線上也算前景
  const lhc = eng.lineHalfCols;
  const jL = mid - lhc - 1;
  const jR = mid + lhc + 1;
  if (jL >= 0 && jR < M) {
    for (let i = 0; i < N; i++) {
      const p = i * M;
      if (fg[p + jL] && fg[p + jR]) for (let j = jL + 1; j < jR; j++) fg[p + j] = 1;
    }
  }

  // ---- 自動判斷跑者方向：前景先出現在哪一側 ----
  if (eng.dir === 0) {
    let left = 0;
    let right = 0;
    let center = 0;
    for (let i = 0; i < N; i++) {
      const p = i * M;
      let a = 0;
      let b = 0;
      for (let j = 0; j < jL; j++) a += fg[p + j];
      for (let j = jR + 1; j < M; j++) b += fg[p + j];
      if (a >= 2) left++;
      if (b >= 2) right++;
      if (fg[p + mid]) center++;
    }
    const need = eng.cfg.minRunRows + 1;
    if (left >= need && right * 3 <= left) eng.dir = 1;
    else if (right >= need && left * 3 <= right) eng.dir = -1;
    else if (center >= need) eng.dir = left >= right ? 1 : -1;
    if (eng.dir !== 0) out.push({ type: 'direction', direction: eng.dir });
  }
  const dir = eng.dir;

  // ---- 每一列：線上是否有前景、身體前緣相對於線的位置 ----
  const step = eng.cfg.colStep;
  const cRow = eng.cRow;
  const eRow = eng.eRow;
  const satRow = eng.satRow;
  for (let i = 0; i < N; i++) {
    const p = i * M;
    // 線上是前景，而且旁邊至少一欄也是（單獨一欄多半是對位誤差造成的）
    cRow[i] = fg[p + mid] && (fg[p + mid - 1] || fg[p + mid + 1]) ? 1 : 0;
    satRow[i] = 0;
    if (dir === 0) {
      eRow[i] = NaN;
      continue;
    }
    if (cRow[i]) {
      let j = mid;
      while (j + dir >= 0 && j + dir < M && fg[p + j + dir]) j += dir;
      eRow[i] = (j - mid) * dir * step;
      if (j + dir < 0 || j + dir >= M) satRow[i] = 1;
    } else {
      let e = NaN;
      for (let k = 1; k <= mid; k++) {
        const j = mid - dir * k;
        if (fg[p + j] && (k === mid || fg[p + j - dir])) {
          e = -k * step;
          break;
        }
      }
      eRow[i] = e;
    }
  }

  // ---- 終點攝影條 ----
  eng.stripT.push(t);
  for (let i = 0; i < N; i++) eng.stripD.push(eng.rowOk[i] ? Math.round(cur[i * M + mid]) : 0);
  if (eng.stripT.length >= eng.cfg.stripChunkFrames) flushStrip(eng);

  // ---- 線上的前景連成段，歸到跑者 ----
  if (dir !== 0) {
    const minRun = eng.cfg.minRunRows;
    let i = 0;
    while (i < N) {
      if (!cRow[i]) {
        i++;
        continue;
      }
      let a = i;
      let b = i;
      let count = 0;
      let gap = 0;
      let k = i;
      while (k < N && gap <= 2) {
        if (cRow[k]) {
          b = k;
          count++;
          gap = 0;
        } else {
          gap++;
        }
        k++;
      }
      i = b + 1;
      if (count < minRun) continue;
      let blob: Blob | null = null;
      for (let q = eng.blobs.length - 1; q >= 0; q--) {
        const B = eng.blobs[q];
        if (B.lo - 2 <= b && a <= B.hi + 2) {
          if (!blob) {
            blob = B;
          } else {
            mergeBlobs(B, blob, N);
            eng.blobs.splice(eng.blobs.indexOf(blob), 1);
            blob = B;
          }
        }
      }
      if (!blob) {
        blob = newBlob(eng, t);
        eng.blobs.push(blob);
      }
      if (a < blob.lo) blob.lo = a;
      if (b > blob.hi) blob.hi = b;
      if (blob.lastT !== t) blob.frames++;
      blob.lastT = t;
      blob.mass += count;
      const pt = eng.prevT;
      for (let r = a; r <= b; r++) {
        if (!cRow[r]) continue;
        const e = eRow[r];
        const pe = eng.prevE[r];
        if (blob.postT[r] !== blob.postT[r]) {
          blob.postT[r] = t;
          blob.postE[r] = e;
          blob.postSat[r] = satRow[r];
          if (pe === pe && pe < 0 && pt === pt) {
            blob.preT[r] = pt;
            blob.preE[r] = pe;
            if (!satRow[r] && blob.adv.length < 400) blob.adv.push((e - pe) / (t - pt));
          }
        } else if (!satRow[r] && pe === pe && e > pe && pt === pt && blob.adv.length < 400) {
          blob.adv.push((e - pe) / (t - pt));
        }
      }
      if (!blob.thumb && blob.frames >= (eng.dt > 0.012 ? 1 : 2)) blob.thumb = takeThumb(eng, luma, stride, t);
    }
    // 通過完畢的跑者
    const closeGap = Math.max(eng.cfg.closeGapSec, (eng.dt === eng.dt ? eng.dt : 0) * 1.6);
    for (let q = eng.blobs.length - 1; q >= 0; q--) {
      const B = eng.blobs[q];
      if (t - B.lastT > closeGap) {
        eng.blobs.splice(q, 1);
        finalizeBlob(eng, B);
      }
    }
  }
  for (let r = 0; r < N; r++) eng.prevE[r] = eRow[r];
  eng.prevT = t;
  eng.out = [];
  return out;
}
