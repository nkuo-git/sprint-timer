/**
 * 終點線偵測（photo-finish 式），純 TypeScript，可在 Node 測試，也可在 frame processor 執行緒跑。
 *
 * 原理：
 *  1. 使用者在畫面上指定終點線位置 lineX，以及「軀幹高度帶」 y0..y1
 *     （大約肩膀到腰；把頭、手、腳排除，符合田徑規則以軀幹 torso 為準）。
 *  2. 只分析終點線左右 ±bandHalfWidth 的窄帶，比較每個像素與背景（空跑道）的亮度差。
 *  3. 每一欄算「佔有率」= 軀幹帶中變化像素的比例。手臂、手是細的，佔有率低；
 *     軀幹是粗的，佔有率高。佔有率超過門檻、且連續 minRunColumns 欄以上的區塊才算軀幹。
 *  4. 軀幹前緣位置 s（以跑者前進方向為正、終點線為 0，單位 px）每格都量得到。
 *     找到 s 由負轉正的那兩格之間，用前後幾格的 (t, s) 做線性擬合解 s = 0，
 *     得到「次影格」精度的衝線時間。240fps 一格 4.17ms，內插後誤差通常 < 1ms。
 */

export interface LumaFrame {
  /** 影格時間戳（秒），必須和 PrecisionClock 同時基 */
  t: number;
  width: number;
  height: number;
  /** 每列 byte 數（Y plane 的 bytesPerRow） */
  stride: number;
  /** Y（亮度）plane */
  luma: Uint8Array;
}

export interface FinishLineConfig {
  /** 終點線所在欄（px） */
  lineX: number;
  /** 軀幹高度帶（px，含 y0 不含 y1） */
  y0: number;
  y1: number;
  /** +1：跑者往 x 增加方向跑；-1：往 x 減少方向跑 */
  direction: 1 | -1;
  /** 分析帶半寬（px）。應 ≥ 跑者 2 格的位移量 */
  bandHalfWidth: number;
  /** 亮度差門檻（0–255） */
  diffThreshold: number;
  /** 一欄被視為「軀幹」的佔有率門檻（0–1） */
  occupancyThreshold: number;
  /** 軀幹最少連續欄數（排除手臂） */
  minRunColumns: number;
  /** 取樣列間距（效能） */
  rowStep: number;
  /** 固定時間修正（秒），例如 rolling shutter 中段列延遲，正值代表影格實際比 timestamp 晚 */
  timeOffset: number;
}

export function defaultFinishLineConfig(w: number, h: number): FinishLineConfig {
  'worklet';
  return {
  lineX: Math.round(w / 2),
  y0: Math.round(h * 0.3),
  y1: Math.round(h * 0.6),
  direction: 1,
  bandHalfWidth: Math.max(40, Math.round(w * 0.1)),
  diffThreshold: 28,
  occupancyThreshold: 0.45,
  minRunColumns: 6,
  rowStep: 2,
  timeOffset: 0,
  };
}

export interface Crossing {
  /** 衝線時間（秒，本機時鐘） */
  t: number;
  /** 影格間距（秒） */
  frameInterval: number;
  /** 用來擬合的點數 */
  points: number;
  /** 前緣速度（px/秒，正值） */
  speedPxPerSec: number;
  /** 內插方式 */
  method: 'interpolated' | 'extrapolated' | 'single-frame';
}

/**
 * 計算分析帶每一欄的佔有率。純函式，可加 'worklet' 在 frame processor 中執行。
 * bg 的排列是 [row][col]，只存分析帶範圍：cols = x1 - x0，rows = ceil((y1-y0)/rowStep)
 */
export function bandOccupancy(
  luma: Uint8Array,
  stride: number,
  bg: Float32Array,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  rowStep: number,
  diffThreshold: number,
  out: Float32Array,
): void {
  'worklet';
  const cols = x1 - x0;
  let rows = 0;
  for (let c = 0; c < cols; c++) out[c] = 0;
  let r = 0;
  for (let y = y0; y < y1; y += rowStep, r++) {
    const rowOff = y * stride;
    const bgOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const d = luma[rowOff + x0 + c] - bg[bgOff + c];
      if (d > diffThreshold || d < -diffThreshold) out[c] += 1;
    }
    rows++;
  }
  if (rows > 0) for (let c = 0; c < cols; c++) out[c] /= rows;
}

/**
 * 從佔有率陣列找軀幹前緣（以前進方向計）。回傳相對終點線的 s（px），找不到回傳 null。
 * 次像素：在前緣欄與下一欄之間，用佔有率對門檻做線性內插。
 */
export function leadingEdge(
  occ: Float32Array,
  x0: number,
  lineX: number,
  direction: 1 | -1,
  occThr: number,
  minRun: number,
): number | null {
  'worklet';
  const n = occ.length;
  // 依前進方向從最前面往回掃，找第一個長度 ≥ minRun 的連續區塊的前緣
  let run = 0;
  for (let k = 0; k < n; k++) {
    const c = direction === 1 ? n - 1 - k : k;
    if (occ[c] >= occThr) {
      run++;
      if (run >= minRun) {
        // 區塊前緣欄
        const front = direction === 1 ? c + run - 1 : c - run + 1;
        // 次像素：前緣欄（≥thr）到下一欄（<thr）之間內插
        const next = front + direction;
        let sub = 0;
        if (next >= 0 && next < n) {
          const a = occ[front];
          const b = occ[next];
          if (a !== b) sub = Math.max(0, Math.min(1, (a - occThr) / (a - b)));
        }
        // 座標以「欄中心」為準：欄 i 的中心 = x0 + i
        const xEdge = x0 + front + direction * sub;
        // 換成「前進方向座標」：0 = 終點線，正 = 已經過線
        return direction * (xEdge - lineX);
      }
    } else {
      run = 0;
    }
  }
  return null;
}

/** 線性回歸 s = a + b t，回傳 s=0 的 t */
function solveZero(ts: number[], ss: number[]): { t: number; speed: number } | null {
  'worklet';
  const n = ts.length;
  if (n < 2) return null;
  let mt = 0;
  let ms = 0;
  for (let i = 0; i < n; i++) {
    mt += ts[i];
    ms += ss[i];
  }
  mt /= n;
  ms /= n;
  let stt = 0;
  let sts = 0;
  for (let i = 0; i < n; i++) {
    stt += (ts[i] - mt) * (ts[i] - mt);
    sts += (ts[i] - mt) * (ss[i] - ms);
  }
  if (stt === 0) return null;
  const b = sts / stt;
  if (b <= 0) return null; // 前緣沒有往前動，不合理
  return { t: mt - ms / b, speed: b };
}

export type DetectorPhase = 'idle' | 'learning' | 'armed' | 'crossed';

/**
 * 偵測器狀態（純資料物件，沒有 class / closure），
 * 這樣可以整個放在 frame processor 的 worklet runtime 裡（globalThis 上）持續使用。
 */
export interface DetectorState {
  cfg: FinishLineConfig;
  x0: number;
  x1: number;
  cols: number;
  bg: Float32Array;
  bgCount: number;
  occ: Float32Array;
  histT: number[];
  /** NaN 代表該格沒有偵測到軀幹 */
  histS: number[];
  pendingCrossIdx: number;
  lastT: number;
  dtEstimate: number;
  phase: DetectorPhase;
  result: Crossing | null;
}

const HIST = 12;

export function createDetectorState(frameWidth: number, frameHeight: number, cfg: Partial<FinishLineConfig> = {}): DetectorState {
  'worklet';
  const d = defaultFinishLineConfig(frameWidth, frameHeight);
  const c: FinishLineConfig = { ...d, ...cfg };
  const x0 = Math.max(0, c.lineX - c.bandHalfWidth);
  const x1 = Math.min(frameWidth, c.lineX + c.bandHalfWidth + 1);
  const cols = x1 - x0;
  const rows = Math.ceil((c.y1 - c.y0) / c.rowStep);
  return {
    cfg: c,
    x0,
    x1,
    cols,
    bg: new Float32Array(cols * rows),
    bgCount: 0,
    occ: new Float32Array(cols),
    histT: [],
    histS: [],
    pendingCrossIdx: -1,
    lastT: NaN,
    dtEstimate: NaN,
    phase: 'idle',
    result: null,
  };
}

/** 開始學習背景（跑道上沒有人時，餵 ~15 格） */
export function startLearning(st: DetectorState): void {
  'worklet';
  st.bg.fill(0);
  st.bgCount = 0;
  st.phase = 'learning';
}

/** 背景學好後進入待命，回傳是否成功 */
export function armDetector(st: DetectorState): boolean {
  'worklet';
  if (st.bgCount === 0) return false;
  st.histT = [];
  st.histS = [];
  st.pendingCrossIdx = -1;
  st.result = null;
  st.phase = 'armed';
  return true;
}

function updateBackground(st: DetectorState, f: LumaFrame, rate: number, rowSkip: number): void {
  'worklet';
  const c = st.cfg;
  let r = 0;
  for (let y = c.y0; y < c.y1; y += c.rowStep * rowSkip, r += rowSkip) {
    const rowOff = y * f.stride + st.x0;
    const bgOff = r * st.cols;
    for (let col = 0; col < st.cols; col++) {
      const i = bgOff + col;
      st.bg[i] += (f.luma[rowOff + col] - st.bg[i]) * rate;
    }
  }
}

function computeCrossing(st: DetectorState): Crossing {
  'worklet';
  const H = st.histT.length;
  const ci = st.pendingCrossIdx;
  const bt: number[] = [];
  const bs: number[] = [];
  for (let i = ci - 1; i >= 0 && bt.length < 2; i--) {
    const s = st.histS[i];
    if (s !== s || s >= 0) break; // NaN 或已過線
    bt.unshift(st.histT[i]);
    bs.unshift(s);
  }
  const at: number[] = [];
  const as: number[] = [];
  for (let i = ci; i < H && at.length < 2; i++) {
    const s = st.histS[i];
    if (s !== s) break;
    at.push(st.histT[i]);
    as.push(s);
  }
  const dt = st.dtEstimate === st.dtEstimate ? st.dtEstimate : 0;

  if (bt.length >= 1) {
    const sol = solveZero(bt.concat(at), bs.concat(as));
    if (sol && sol.t >= bt[bt.length - 1] - 1e-9 && sol.t <= at[0] + 1e-9) {
      return { t: sol.t, frameInterval: dt, points: bt.length + at.length, speedPxPerSec: sol.speed, method: 'interpolated' };
    }
    // 擬合結果超出區間時，退回只用跨線的兩點做線性內插
    const ta = bt[bt.length - 1];
    const sa = bs[bs.length - 1];
    const tb = at[0];
    const sb = as[0];
    const tt = ta + ((0 - sa) / (sb - sa)) * (tb - ta);
    return { t: tt, frameInterval: dt, points: 2, speedPxPerSec: (sb - sa) / (tb - ta), method: 'interpolated' };
  }
  // 軀幹進入分析帶時已經過線（分析帶太窄或 fps 太低）：用過線後的點往回外插
  const sol = solveZero(at, as);
  if (sol && sol.t <= at[0] && at[0] - sol.t <= 2 * dt + 1e-9) {
    return { t: sol.t, frameInterval: dt, points: at.length, speedPxPerSec: sol.speed, method: 'extrapolated' };
  }
  return { t: at[0] - dt / 2, frameInterval: dt, points: 1, speedPxPerSec: 0, method: 'single-frame' };
}

/**
 * 每一格呼叫一次。偵測到衝線時回傳 Crossing（只回傳一次），否則 null。
 * 可在 frame processor worklet 中直接呼叫。
 */
export function processFrame(st: DetectorState, f: LumaFrame): Crossing | null {
  'worklet';
  if (st.lastT === st.lastT) {
    const dt = f.t - st.lastT;
    if (dt > 0) st.dtEstimate = st.dtEstimate !== st.dtEstimate ? dt : st.dtEstimate * 0.9 + dt * 0.1;
  }
  st.lastT = f.t;
  const c = st.cfg;

  if (st.phase === 'learning') {
    st.bgCount++;
    updateBackground(st, f, 1 / st.bgCount, 1);
    return null;
  }
  if (st.phase !== 'armed') return null;

  bandOccupancy(f.luma, f.stride, st.bg, st.x0, st.x1, c.y0, c.y1, c.rowStep, c.diffThreshold, st.occ);
  const edge = leadingEdge(st.occ, st.x0, c.lineX, c.direction, c.occupancyThreshold, c.minRunColumns);
  const s = edge === null ? NaN : edge;
  st.histT.push(f.t + c.timeOffset);
  st.histS.push(s);
  if (st.histT.length > HIST) {
    st.histT.shift();
    st.histS.shift();
    if (st.pendingCrossIdx >= 0) st.pendingCrossIdx--;
  }

  if (st.pendingCrossIdx < 0) {
    if (s === s && s >= 0) {
      st.pendingCrossIdx = st.histT.length - 1;
    } else if (s !== s) {
      // 沒有軀幹時，緩慢更新背景以適應光線變化（隔列更新省時間）
      updateBackground(st, f, 0.02, 2);
    }
    return null;
  }
  // 已偵測到過線，再等一格後計算（多一個點讓擬合更準）
  const sinceCross = st.histT.length - 1 - st.pendingCrossIdx;
  if (sinceCross < 1 && s === s) return null;
  st.result = computeCrossing(st);
  st.phase = 'crossed';
  return st.result;
}

/** 方便在 JS 執行緒 / 測試中使用的物件包裝 */
export class FinishLineDetector {
  readonly st: DetectorState;
  constructor(frameWidth: number, frameHeight: number, cfg: Partial<FinishLineConfig> = {}) {
    this.st = createDetectorState(frameWidth, frameHeight, cfg);
  }
  get cfg() {
    return this.st.cfg;
  }
  get state() {
    return this.st.phase;
  }
  get result() {
    return this.st.result;
  }
  get occupancy() {
    return this.st.occ;
  }
  get frameInterval() {
    return this.st.dtEstimate;
  }
  startLearning() {
    startLearning(this.st);
  }
  arm() {
    if (!armDetector(this.st)) throw new Error('尚未學習背景');
  }
  processFrame(f: LumaFrame) {
    return processFrame(this.st, f);
  }
}
