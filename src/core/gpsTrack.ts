/**
 * 長跑計時：把 GPS 定位點變成距離、配速、每公里分段和路線（純計算，不含定位與畫面）。
 *
 * GPS 每個點都有幾公尺的誤差，直接把相鄰兩點的距離加起來會越加越多（站著不動也會「走」），所以：
 *  1. 誤差太大的點、不可能的瞬間移動（比人跑得快）丟掉。
 *  2. 依每個點回報的誤差做平滑（誤差越大越不相信新的點）。
 *  3. 離上一個計入的位置超過幾公尺才算一步，站著不動時的抖動不會累積。
 *  4. 手機回報的速度（都卜勒，很準）接近 0 時當作停下來，不累積距離。
 * 模擬 400m 跑道跑 5 公里（定位誤差 3–5m）距離誤差在 1.5% 內，見 test/gpsTrack.test.ts。
 */

export interface GpsFix {
  /** 這個定位點的時間（秒）。同一趟用同一個時鐘即可 */
  t: number;
  lat: number;
  lon: number;
  /** 水平誤差（公尺）；手機沒回報時給 null */
  acc: number | null;
  /** 手機回報的速度（公尺／秒）；沒有時給 null */
  speed?: number | null;
}

export type LatLon = [lat: number, lon: number];

export interface TrackerOptions {
  /** 目標距離（公尺）。跑到就自動結束，結束時間內插到剛好到達的那一刻；null = 自由跑 */
  targetM: number | null;
  /** 誤差比這個大的點不用（公尺） */
  maxAccuracyM: number;
  /** 比這個快的移動當作定位跳動（公尺／秒）。10 m/s = 百米 10 秒的速度 */
  maxSpeedMps: number;
  /** 平滑用：假設位置每秒最多這樣變動（公尺／秒）。越小越平滑，但轉彎會被削掉 */
  processNoiseMps: number;
  /** 至少移動這麼遠才算一步（公尺） */
  minStepM: number;
  /** 回報速度低於這個值當作靜止（公尺／秒） */
  stillSpeedMps: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  targetM: null,
  maxAccuracyM: 25,
  maxSpeedMps: 10,
  // 這兩個值是用模擬掃出來的平衡點：再平滑一點彎道會被削短，再不平滑雜訊會讓距離變長
  processNoiseMps: 4,
  minStepM: 8,
  stillSpeedMps: 0.4,
};

export type TrackerState = 'idle' | 'running' | 'paused' | 'finished';

export interface RunSummary {
  distanceM: number;
  /** 跑步時間（秒，不含暫停） */
  durationS: number;
  /** 每一公里花的時間（秒）；最後不滿一公里的不算 */
  splitsS: number[];
  /** 路線，暫停會分段 */
  track: LatLon[][];
  /** 有設定目標距離而且跑到了 */
  completed: boolean;
}

const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;
/** 目前配速看最近這幾秒 */
const PACE_WINDOW_S = 12;
/** 這麼久沒有前進就當作停下來，不顯示配速 */
const STOPPED_AFTER_S = 10;
/** 沒有回報誤差時假設的誤差（公尺） */
const UNKNOWN_ACC_M = 12;
const MIN_ACC_M = 3;

/** 兩點的地表距離（公尺） */
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class RunTracker {
  readonly opts: TrackerOptions;
  state: TrackerState = 'idle';
  /** 累積距離（公尺） */
  distanceM = 0;
  /** 每一公里花的時間（秒） */
  splitsS: number[] = [];
  /** 最近一個可用定位點的誤差（公尺）；還沒有可用的點是 null */
  accuracyM: number | null = null;
  /** 最近一個可用定位點的時間 */
  lastFixT: number | null = null;

  // 平滑後的位置
  private lat = 0;
  private lon = 0;
  private variance = -1;
  private filterT = 0;
  private still = false;

  // 上一個計入距離的位置，與當時的跑步時間
  private anchor: { lat: number; lon: number; run: number } | null = null;
  private segments: LatLon[][] = [];

  private startT = 0;
  private pausedS = 0;
  private pausedAt = 0;
  private endRun = 0;
  private lastSplitRun = 0;
  private recent: { run: number; dist: number }[] = [];

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER, ...opts };
  }

  /** 目前平滑後的位置；還沒定位到是 null */
  position(): LatLon | null {
    return this.variance < 0 ? null : [this.lat, this.lon];
  }

  /** 在時間 t 的跑步時間（秒，不含暫停） */
  elapsed(t: number): number {
    if (this.state === 'idle') return 0;
    if (this.state === 'finished') return this.endRun;
    if (this.state === 'paused') return this.pausedAt - this.startT - this.pausedS;
    return Math.max(0, t - this.startT - this.pausedS);
  }

  start(t: number) {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.startT = t;
    this.beginSegment(0);
  }

  pause(t: number) {
    if (this.state !== 'running') return;
    this.countTail(t);
    this.pausedAt = Math.max(t, this.startT + this.pausedS);
    this.state = 'paused';
    this.anchor = null;
    this.recent = [];
  }

  resume(t: number) {
    if (this.state !== 'paused') return;
    this.pausedS += Math.max(0, t - this.pausedAt);
    this.state = 'running';
    this.beginSegment(this.elapsed(t));
  }

  /** 手動結束 */
  finish(t: number) {
    if (this.state === 'idle' || this.state === 'finished') return;
    if (this.state === 'running') this.countTail(t);
    this.endRun = this.elapsed(t);
    this.state = 'finished';
    this.anchor = null;
  }

  /** 收到一個定位點（開始前也可以餵，讓位置先穩定下來） */
  addFix(fix: GpsFix) {
    if (this.state === 'finished') return;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t)) return;
    if (Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return;
    const acc = Math.max(MIN_ACC_M, fix.acc !== null && fix.acc > 0 ? fix.acc : UNKNOWN_ACC_M);
    if (acc > this.opts.maxAccuracyM) return;

    if (this.variance < 0) {
      this.lat = fix.lat;
      this.lon = fix.lon;
      this.variance = acc * acc;
    } else {
      const dt = fix.t - this.filterT;
      if (dt <= 0) return;
      // 瞬間移動：比人跑得快就不採用。訊號中斷很久之後 dt 變大，真的移動了就會被接受
      const jump = haversine(this.lat, this.lon, fix.lat, fix.lon);
      if (jump > this.opts.maxSpeedMps * dt + acc) return;
      this.variance += dt * this.opts.processNoiseMps ** 2;
      const k = this.variance / (this.variance + acc * acc);
      this.lat += k * (fix.lat - this.lat);
      this.lon += k * (fix.lon - this.lon);
      this.variance *= 1 - k;
    }
    this.filterT = fix.t;
    this.accuracyM = acc;
    this.lastFixT = fix.t;
    this.still = fix.speed !== null && fix.speed !== undefined && fix.speed >= 0 && fix.speed < this.opts.stillSpeedMps;

    if (this.state !== 'running') return;
    const run = this.elapsed(fix.t);
    if (!this.anchor) {
      this.anchor = { lat: this.lat, lon: this.lon, run };
      this.segments[this.segments.length - 1].push([this.lat, this.lon]);
      return;
    }
    if (this.still) return;
    const step = haversine(this.anchor.lat, this.anchor.lon, this.lat, this.lon);
    if (step < Math.max(this.opts.minStepM, acc * 0.5)) return;
    this.advance(this.lat, this.lon, step, run);
  }

  /** 在時間 t 看最近幾秒的配速（秒／公里）；停下來或資料不夠時是 null */
  currentPace(t: number): number | null {
    if (this.state !== 'running' || this.recent.length < 2) return null;
    const a = this.recent[0];
    const b = this.recent[this.recent.length - 1];
    // 好一陣子沒有前進：停下來了
    if (this.elapsed(t) - b.run > STOPPED_AFTER_S) return null;
    const d = b.dist - a.dist;
    const dt = b.run - a.run;
    if (d < 5 || dt <= 0) return null;
    return (dt / d) * 1000;
  }

  /** 路線（複製一份） */
  track(): LatLon[][] {
    return this.segments.filter((s) => s.length > 0).map((s) => s.map((p): LatLon => [p[0], p[1]]));
  }

  summary(t: number): RunSummary {
    const target = this.opts.targetM;
    return {
      distanceM: this.distanceM,
      durationS: this.elapsed(t),
      splitsS: [...this.splitsS],
      track: this.track(),
      completed: target !== null && this.distanceM >= target,
    };
  }

  private beginSegment(run: number) {
    this.segments.push([]);
    this.recent = [];
    if (this.variance >= 0) {
      this.anchor = { lat: this.lat, lon: this.lon, run };
      this.segments[this.segments.length - 1].push([this.lat, this.lon]);
      this.recent.push({ run, dist: this.distanceM });
    } else {
      this.anchor = null;
    }
  }

  /** 暫停或結束時，把上一步之後還沒計入的一小段補上 */
  private countTail(t: number) {
    if (!this.anchor || this.still || this.variance < 0) return;
    const step = haversine(this.anchor.lat, this.anchor.lon, this.lat, this.lon);
    if (step < 0.5) return;
    this.advance(this.lat, this.lon, step, Math.max(this.anchor.run, this.elapsed(t)));
  }

  /** 從 anchor 前進到 (lat, lon)，距離 step，抵達時的跑步時間 run */
  private advance(lat: number, lon: number, step: number, run: number) {
    const from = this.anchor!;
    const before = this.distanceM;
    let after = before + step;
    const target = this.opts.targetM;
    // 這一步裡走到累積距離 dist 時的跑步時間（線性內插）
    const perMeter = (run - from.run) / step;
    const at = (dist: number) => from.run + (dist - before) * perMeter;

    // 到達目標：時間和終點都內插到剛好到達的位置
    let reached = false;
    if (target !== null && after >= target) {
      const f = (target - before) / step;
      lat = from.lat + f * (lat - from.lat);
      lon = from.lon + f * (lon - from.lon);
      run = at(target);
      after = target;
      reached = true;
    }
    // 每跨過一個整公里記一次分段
    for (let km = Math.floor(before / 1000) + 1; km * 1000 <= after + 1e-9; km++) {
      const cross = at(Math.min(km * 1000, after));
      this.splitsS.push(cross - this.lastSplitRun);
      this.lastSplitRun = cross;
    }
    this.distanceM = after;
    this.anchor = { lat, lon, run };
    this.segments[this.segments.length - 1].push([lat, lon]);
    this.recent.push({ run, dist: after });
    while (this.recent.length > 2 && run - this.recent[1].run >= PACE_WINDOW_S) this.recent.shift();
    if (reached) {
      this.endRun = run;
      this.state = 'finished';
      this.anchor = null;
    }
  }
}

// ───────────── 路線的簡化與壓縮（存檔、上傳用） ─────────────

/**
 * 把幾乎在同一直線上的點拿掉（Douglas–Peucker）。toleranceM 是允許偏離原路線的距離。
 * 一秒一個點的馬拉松約 1.5 萬點，簡化後剩一兩千點，畫出來看不出差別。
 */
export function simplifyTrack(points: LatLon[], toleranceM = 3): LatLon[] {
  // Douglas–Peucker 最差情況是點數平方，所以分成一段一段做（每段頭尾都保留，接起來不會斷）
  if (points.length > SIMPLIFY_CHUNK) {
    const out: LatLon[] = [];
    for (let i = 0; i < points.length - 1; i += SIMPLIFY_CHUNK) {
      const part = simplifyChunk(points.slice(i, Math.min(points.length, i + SIMPLIFY_CHUNK + 1)), toleranceM);
      out.push(...(out.length ? part.slice(1) : part));
    }
    return out;
  }
  return simplifyChunk(points, toleranceM);
}

const SIMPLIFY_CHUNK = 1000;

function simplifyChunk(points: LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return points.slice();
  const lat0 = points[0][0];
  const mx = EARTH_R * RAD * Math.cos(lat0 * RAD);
  const my = EARTH_R * RAD;
  const xy = points.map((p) => [(p[1] - points[0][1]) * mx, (p[0] - lat0) * my]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const [ax, ay] = xy[a];
    const dx = xy[b][0] - ax;
    const dy = xy[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = toleranceM * toleranceM;
    for (let i = a + 1; i < b; i++) {
      const px = xy[i][0] - ax;
      const py = xy[i][1] - ay;
      const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const d2 = (px - f * dx) ** 2 + (py - f * dy) ** 2;
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** 路線長度（公尺） */
export function trackLength(points: LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  return d;
}

/**
 * 把路線壓成一個字串（Google encoded polyline 格式，精度 1e-5 度，約 1 公尺）。
 * 每個點平均 4 個字元左右，比存一串數字小很多，也能直接丟給多數地圖工具。
 */
export function encodePolyline(points: LatLon[]): string {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  for (const [lat, lon] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lon * 1e5);
    out += encodeSigned(a - pLat) + encodeSigned(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

function encodeSigned(v: number): string {
  // 緯度差最多 ±1.8e7，左移一位後仍在 32 位元整數範圍內
  let u = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (u >= 0x20) {
    s += String.fromCharCode((0x20 | (u & 0x1f)) + 63);
    u >>>= 5;
  }
  return s + String.fromCharCode(u + 63);
}

/** encodePolyline 的反向。格式不對的字串回傳到壞掉之前的點 */
export function decodePolyline(text: string): LatLon[] {
  const out: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (i >= text.length || shift > 30) return null;
      const c = text.charCodeAt(i++) - 63;
      if (c < 0 || c > 63) return null;
      result |= (c & 0x1f) << shift;
      shift += 5;
      if (c < 0x20) break;
    }
    return result & 1 ? ~(result >>> 1) : result >>> 1;
  };
  while (i < text.length) {
    const a = next();
    const b = a === null ? null : next();
    if (a === null || b === null) break;
    lat += a;
    lon += b;
    if (Math.abs(lat) > 90e5 || Math.abs(lon) > 180e5) break;
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
