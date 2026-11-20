import { encodePolyline, RunTracker, simplifyTrack, type GpsFix, type LatLon, type RunSummary } from '../core/gpsTrack';
import type { RunInput } from '../records/store';
import { finishAnnouncement, kmAnnouncement } from './format';

/** 手機給的一個定位點 */
export interface RawFix {
  /** 定位時間（epoch 毫秒，手機定位系統給的） */
  timestamp: number;
  latitude: number;
  longitude: number;
  /** 水平誤差（公尺） */
  accuracy: number | null;
  /** 速度（公尺／秒） */
  speed: number | null;
}

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

/** 定位來源（手機上是 src/run/location.ts，測試用假的） */
export interface LocationSource {
  permission(): Promise<LocationPermission>;
  /** 跳出系統的權限詢問，回傳結果 */
  request(): Promise<LocationPermission>;
  /** 開始收定位點（App 在前景時）。回傳停止的函式 */
  watch(onFix: (fix: RawFix) => void): Promise<() => void>;
  /**
   * 開始「螢幕關掉也繼續」的定位（Android 會出現常駐通知）。回傳停止的函式。
   * 做不到（例如系統不允許）時丟出錯誤，呼叫的人會退回只用 watch()。
   */
  track(onFix: (fix: RawFix) => void): Promise<() => void>;
}

export type RunPhase = 'setup' | 'running' | 'paused' | 'finished';
/** denied＝沒有定位權限；searching＝還沒定位到或訊號斷了；good＝可以用 */
export type GpsState = 'unknown' | 'denied' | 'searching' | 'good';

export interface RunSnapshot {
  phase: RunPhase;
  gps: GpsState;
  /** 最近定位點的誤差（公尺） */
  accuracyM: number | null;
  /** 目前位置（平滑後） */
  position: LatLon | null;
  targetM: number | null;
  distanceM: number;
  /** 最近幾秒的配速（秒／公里） */
  currentPace: number | null;
  /** 已經跑完的整公里：第幾公里、花了幾秒 */
  lastSplit: { km: number; seconds: number } | null;
  /** 到目前為止的路線 */
  track: LatLon[][];
  /** 螢幕關掉後能不能繼續記錄（false＝系統不允許背景定位，要保持 App 開著） */
  background: boolean;
  /** 結束後的成績；太短沒有存檔時 saved 是 false */
  result: (RunInput & { saved: boolean }) | null;
}

export interface RunSessionDeps {
  location: LocationSource;
  /** 現在時間（epoch 毫秒） */
  now(): number;
  /** 存檔（AccountService.saveRun） */
  save(run: RunInput): Promise<void>;
  /** 念出一句話（每公里報時）；沒給就不報 */
  speak?(text: string): void;
  newId(): string;
}

/** 超過這麼久沒有新的定位點，就當作訊號斷了 */
const GPS_STALE_MS = 10_000;
/** 比這個短的不存（按了開始馬上結束） */
const MIN_SAVE_M = 20;
/** 路線字串的總長度上限（雲端規則允許 30 萬） */
const TRACK_CHAR_LIMIT = 250_000;
const MAX_SEGMENTS = 200;

/**
 * 一次長跑從準備到結束的流程（不含畫面）：
 * setup（等 GPS、選目標）→ running ⇄ paused → finished（自動存檔）。
 * 畫面訂閱 snapshot；跑步時間每秒在變，畫面自己用 elapsed() 讀。
 */
export class RunSession {
  private tracker: RunTracker;
  private phase: RunPhase = 'setup';
  private permission: LocationPermission | 'unknown' = 'unknown';
  private targetM: number | null = null;
  private voice = true;
  private background = true;
  private stopSource: (() => void) | null = null;
  private lastFixAt = 0;
  private clockOffsetMs: number | null = null;
  private announcedKm = 0;
  private result: RunSnapshot['result'] = null;
  private startedAt = 0;
  private listeners = new Set<() => void>();
  private snap: RunSnapshot;
  private disposed = false;
  private busy = false;

  constructor(private readonly deps: RunSessionDeps) {
    this.tracker = new RunTracker();
    this.snap = this.compute();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): RunSnapshot => this.snap;

  /** 現在的跑步時間（秒，不含暫停） */
  elapsed(): number {
    return this.tracker.elapsed(this.deps.now() / 1000);
  }

  /** 進到準備畫面時呼叫：有權限就開始定位，讓 GPS 先穩定 */
  async open(): Promise<void> {
    this.permission = await this.deps.location.permission().catch((): LocationPermission => 'denied');
    this.emit();
    if (this.permission === 'granted') await this.beginWatch();
  }

  /** 使用者按「允許定位」 */
  async requestPermission(): Promise<void> {
    this.permission = await this.deps.location.request().catch((): LocationPermission => 'denied');
    this.emit();
    if (this.permission === 'granted') await this.beginWatch();
  }

  /** 設定目標距離（公尺）；null = 自由跑。開始前才能改 */
  setTarget(targetM: number | null) {
    if (this.phase !== 'setup') return;
    this.targetM = targetM !== null && targetM > 0 ? targetM : null;
    this.emit();
  }

  setVoice(on: boolean) {
    this.voice = on;
  }

  /** 按「開始跑」 */
  async start(): Promise<void> {
    if (this.phase !== 'setup' || this.permission !== 'granted' || this.busy) return;
    this.busy = true;
    try {
      // 換一個帶著目標距離的計算器，並沿用已經穩定下來的位置
      const warm = this.tracker;
      this.tracker = new RunTracker({ targetM: this.targetM });
      const p = warm.position();
      if (p && warm.lastFixT !== null && warm.accuracyM !== null) this.tracker.addFix({ t: warm.lastFixT, lat: p[0], lon: p[1], acc: warm.accuracyM });
      this.startedAt = this.deps.now();
      this.tracker.start(this.startedAt / 1000);
      this.phase = 'running';
      this.emit();
      // 改用螢幕關掉也會繼續的定位；系統不允許時留在原本的定位方式
      try {
        const stop = await this.deps.location.track(this.onFix);
        this.stopSource?.();
        this.stopSource = stop;
        this.background = true;
      } catch {
        this.background = false;
        if (!this.stopSource) await this.beginWatch();
      }
      // 等待背景定位開啟的途中可能已經結束或離開畫面
      if (this.disposed || (this.phase as RunPhase) === 'finished') this.release();
      this.emit();
    } finally {
      this.busy = false;
    }
  }

  pause() {
    if (this.phase !== 'running') return;
    this.tracker.pause(this.deps.now() / 1000);
    this.phase = 'paused';
    this.emit();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.tracker.resume(this.deps.now() / 1000);
    this.phase = 'running';
    this.emit();
  }

  /** 手動結束（長按「結束」） */
  async finish(): Promise<void> {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    this.tracker.finish(this.deps.now() / 1000);
    await this.complete();
  }

  /** 離開畫面時呼叫：停止定位。跑到一半離開不會存檔 */
  dispose() {
    this.disposed = true;
    this.release();
    this.listeners.clear();
  }

  private async beginWatch() {
    if (this.stopSource || this.disposed) return;
    try {
      const stop = await this.deps.location.watch(this.onFix);
      if (this.disposed || this.stopSource) stop();
      else this.stopSource = stop;
    } catch {
      // 定位開不起來：畫面會停在「搜尋中」
    }
  }

  private release() {
    this.stopSource?.();
    this.stopSource = null;
  }

  private onFix = (raw: RawFix) => {
    if (this.disposed || this.phase === 'finished') return;
    const now = this.deps.now();
    // 定位點帶的是定位系統的時間，和手機時鐘可能差一點，而且送到 App 會有延遲。
    // 取「收到時間 − 定位時間」看過的最小值當作兩個時鐘的差，把定位時間換算到手機時鐘上。
    const lag = now - raw.timestamp;
    if (this.clockOffsetMs === null || lag < this.clockOffsetMs) this.clockOffsetMs = lag;
    const fix: GpsFix = { t: (raw.timestamp + this.clockOffsetMs) / 1000, lat: raw.latitude, lon: raw.longitude, acc: raw.accuracy, speed: raw.speed };
    const before = this.tracker.lastFixT;
    this.tracker.addFix(fix);
    if (this.tracker.lastFixT !== before) this.lastFixAt = now;

    if (this.phase === 'running') {
      this.announceSplits();
      if (this.tracker.state === 'finished') {
        if (this.voice && this.targetM !== null) this.deps.speak?.(finishAnnouncement(this.targetM, this.tracker.elapsed(0)));
        void this.complete();
        return;
      }
    }
    this.emit();
  };

  private announceSplits() {
    const splits = this.tracker.splitsS;
    while (this.announcedKm < splits.length) {
      this.announcedKm++;
      // 到達目標的那一公里由「到達目標」的語音負責
      if (this.tracker.state === 'finished' && this.announcedKm === splits.length) break;
      if (!this.voice) continue;
      const total = splits.slice(0, this.announcedKm).reduce((a, b) => a + b, 0);
      this.deps.speak?.(kmAnnouncement(this.announcedKm, total, splits[this.announcedKm - 1]));
    }
  }

  private async complete() {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.release();
    const run = toRunInput(this.deps.newId(), this.startedAt, this.targetM, this.tracker.summary(0));
    const worthSaving = run.distanceM >= MIN_SAVE_M;
    this.result = { ...run, saved: false };
    this.emit();
    if (!worthSaving) return;
    try {
      await this.deps.save(run);
      this.result = { ...run, saved: true };
    } catch {
      // 存檔失敗（手機空間滿了之類）：成績仍顯示在畫面上，saved 維持 false
    }
    this.emit();
  }

  private compute(): RunSnapshot {
    const now = this.deps.now();
    const fresh = this.lastFixAt > 0 && now - this.lastFixAt <= GPS_STALE_MS;
    const gps: GpsState = this.permission === 'unknown' ? 'unknown' : this.permission !== 'granted' ? 'denied' : fresh ? 'good' : 'searching';
    const splits = this.tracker.splitsS;
    return {
      phase: this.phase,
      gps,
      accuracyM: fresh ? this.tracker.accuracyM : null,
      position: this.tracker.position(),
      targetM: this.targetM,
      distanceM: this.tracker.distanceM,
      currentPace: this.tracker.currentPace(now / 1000),
      lastSplit: splits.length ? { km: splits.length, seconds: splits[splits.length - 1] } : null,
      track: this.phase === 'setup' ? [] : this.tracker.track(),
      background: this.background,
      result: this.result,
    };
  }

  /** 畫面每秒呼叫一次也可以：讓「訊號斷了」「停下來沒有配速」這類隨時間變化的狀態更新 */
  refresh() {
    this.emit();
  }

  private emit() {
    this.snap = this.compute();
    for (const fn of this.listeners) fn();
  }
}

/** 把跑完的結果整理成要存的樣子：路線簡化、壓成字串，數字取到小數一位 */
export function toRunInput(id: string, startedAtMs: number, targetM: number | null, s: RunSummary): RunInput {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const segments = s.track.filter((seg) => seg.length >= 2).slice(0, MAX_SEGMENTS);
  const size = (t: string[]) => t.reduce((n, x) => n + x.length, 0);
  let tolerance = 3;
  let simple = segments.map((seg) => simplifyTrack(seg, tolerance));
  let track = simple.map(encodePolyline);
  // 極長的路線：先放寬簡化程度，還是太大就平均地少存一些點
  while (size(track) > TRACK_CHAR_LIMIT && tolerance < 48) {
    tolerance *= 2;
    simple = segments.map((seg) => simplifyTrack(seg, tolerance));
    track = simple.map(encodePolyline);
  }
  for (let step = 2; size(track) > TRACK_CHAR_LIMIT; step *= 2) {
    track = simple.map((seg) => encodePolyline(seg.filter((_, i) => i % step === 0 || i === seg.length - 1)));
  }
  return {
    id,
    ranAt: new Date(startedAtMs).toISOString(),
    distanceM: r1(s.distanceM),
    durationS: r1(s.durationS),
    targetM,
    completed: s.completed,
    splitsS: s.splitsS.slice(0, 1000).map(r1),
    track,
  };
}
